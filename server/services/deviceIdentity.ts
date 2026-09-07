/**
 * 设备身份识别（主人 / 客人 彩蛋）
 *
 * 背景：辛老师要"认出我的设备"，其他设备接入时 DJ 语音欢迎（首次隆重、再来低调）。
 *
 * 设计要点：
 * 1. 前端每个浏览器生成稳定 deviceId（localStorage），WS 连接时带上。
 * 2. 主人 = 持有 bond 的设备。bond 由 HMAC(deviceId) 无状态签发/验签
 *    → Render 免费版重启"失忆"也不怕：bond 验签不依赖内存/磁盘，永久认得主人。
 *    （secret/token 均可 env 覆盖：EGG_OWNER_SECRET / EGG_OWNER_TOKEN）
 * 3. 主人绑定：访问 /?claim=<口令> 一次 → POST /api/device/claim 换 bond → 存前端。
 * 4. 客人记忆（谁来过）尽力持久化 data/devices.json——免费盘重启会丢，
 *    丢后同一台客人再接入会被当"新客"再隆重欢迎一次，低频事件可接受。
 */
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 主人绑定口令：/?claim=<这里>。env 可覆盖 */
export const CLAIM_TOKEN = process.env.EGG_OWNER_TOKEN || "xradio-master-2026";
/** bond 签名密钥（无状态验签，重启不失忆）。env 可覆盖 */
const OWNER_SECRET = process.env.EGG_OWNER_SECRET || "ai-radio-xin-owner-secret-2026";

const DATA_FILE = path.resolve(__dirname, "../../data/devices.json");

export type DeviceRole = "owner" | "guest-new" | "guest-known" | "no-id";

interface GuestRecord {
  ua: string;
  firstSeenAt: number;
  lastSeenAt: number;
  /** 上次被语音欢迎的时刻（控制"再来低调"不轰炸） */
  lastGreetedAt: number;
}

const seenGuests = new Map<string, GuestRecord>();
let dataLoaded = false;

// ================= bond：主人凭证（HMAC 无状态验签） =================
export function signBond(deviceId: string): string {
  return crypto.createHmac("sha256", OWNER_SECRET).update(`owner:${deviceId}`).digest("hex");
}

export function verifyBond(deviceId: string, bond?: string | null): boolean {
  if (!deviceId || !bond) return false;
  const expect = Buffer.from(signBond(deviceId), "utf8");
  const got = Buffer.from(bond, "utf8");
  return expect.length === got.length && crypto.timingSafeEqual(expect, got);
}

/** 一次接入的角色判定（副作用：记录客人档案） */
export function resolveRole(
  deviceId?: string | null,
  bond?: string | null,
): { role: DeviceRole; isOwner: boolean; isNewGuest: boolean } {
  if (!deviceId) return { role: "no-id", isOwner: false, isNewGuest: false };
  if (verifyBond(deviceId, bond)) {
    return { role: "owner", isOwner: true, isNewGuest: false };
  }
  const now = Date.now();
  const rec = seenGuests.get(deviceId);
  if (rec) {
    rec.lastSeenAt = now;
    rec.ua = rec.ua || ""; // ua 由 connection 层另外记，见 noteGuestDevice
    return { role: "guest-known", isOwner: false, isNewGuest: false };
  }
  seenGuests.set(deviceId, { ua: "", firstSeenAt: now, lastSeenAt: now, lastGreetedAt: 0 });
  persist().catch(() => {});
  return { role: "guest-new", isOwner: false, isNewGuest: true };
}

/** 补记客人 UA（resolveRole 之后调用，避免 map 遍历时反复写盘） */
export function noteGuestDevice(deviceId: string | undefined, ua: string | undefined): void {
  if (!deviceId) return;
  const rec = seenGuests.get(deviceId);
  if (rec && ua && rec.ua !== ua) {
    rec.ua = ua;
    persist().catch(() => {});
  }
}

/** 该客人距离上次语音欢迎是否已 ≥ 10 分钟（够久才再低调问候一次） */
export function shouldGreetAgain(deviceId: string): boolean {
  const rec = seenGuests.get(deviceId);
  if (!rec) return true;
  return Date.now() - rec.lastGreetedAt >= 10 * 60 * 1000;
}

/** 标记已语音欢迎过 */
export function markGreeted(deviceId: string): void {
  const rec = seenGuests.get(deviceId);
  if (rec) {
    rec.lastGreetedAt = Date.now();
    persist().catch(() => {});
  }
}

export function guestCount(): number {
  return seenGuests.size;
}

/** UA → 设备种类（log / 在线面板展示用） */
export function classifyDevice(ua: string | undefined): string {
  if (!ua) return "未知设备";
  const u = ua.toLowerCase();
  if (u.includes("iphone") || u.includes("ipod")) return "iPhone";
  if (u.includes("ipad") || (u.includes("mac os") && u.includes("mobile"))) return "iPad";
  if (u.includes("android")) return "Android";
  if (u.includes("windows")) return "Windows";
  if (u.includes("mac os") || u.includes("macintosh")) return "Mac";
  if (u.includes("linux")) return "Linux";
  return "其他设备";
}

// ================= data/devices.json 尽力持久化 =================
export async function loadGuests(): Promise<void> {
  if (dataLoaded) return;
  dataLoaded = true;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const j = JSON.parse(raw) as { guests?: Record<string, GuestRecord> };
    if (j.guests) {
      for (const [id, rec] of Object.entries(j.guests)) {
        if (typeof rec?.firstSeenAt === "number") seenGuests.set(id, rec);
      }
    }
    console.log(`[deviceIdentity] 已加载客人档案 ${seenGuests.size} 条`);
  } catch {
    /* 首次启动无文件，静默 */
  }
}

async function persist(): Promise<void> {
  try {
    const obj: Record<string, GuestRecord> = {};
    for (const [id, rec] of seenGuests) obj[id] = rec;
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify({ guests: obj }, null, 2), "utf8");
  } catch (err) {
    console.warn("[deviceIdentity] 客人档案写入失败(可忽略):", err instanceof Error ? err.message : String(err));
  }
}
