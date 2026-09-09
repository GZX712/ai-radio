/**
 * 主人个性化设置跨设备云同步（PC ↔ 手机）
 *
 * 原理：主人所有设备的 bond 由同一密钥签发 → 任何验签通过的主机共享同一份
 * 「云端档案」。本模块负责：
 *
 *   - pushSettings()：本地某设置变更后调用 → 收集「本端存在的键」全量推送
 *     （只带存在的键，避免把另一台设备已配好的 DJ 头像等冲成 null）
 *   - pullSettings()：主人设备启动时调用 → 比对 updatedAt：
 *       · 云端新（R > L）→ 应用远端到 localStorage → reload 生效
 *       · 本地新（L > R）→ 上次推送失败 → 补推一次（种子/续传）
 *       · 云端无档案但本端有配置 → 自动种子推送（第一台设备成为权威）
 *
 * 键语义：localStorage 中值为 ""（空串）表示"显式清除"（收集/应用都认）；
 * 键不存在表示"本端从未设置"（不参与推送，防止覆盖云端）。
 *
 * 冲突策略：last-write-wins（低频双设备同时改，后写者赢）。
 */
import { getDeviceId, getOwnerBond } from "./deviceIdentity";

const KEY = {
  wallpaper: "ai-radio-wallpaper",
  personality: "ai-radio-dj-personality",
  djAvatar: "ai-radio-dj-avatar",
  userAvatar: "ai-radio-user-avatar",
  playerBg: "ai-radio-player-bg",
  meta: "ai-radio-sync-meta",
} as const;

/** 参与同步的键（顺序无关，值均为 string | 显式清除 ""） */
const SYNC_KEYS = ["wallpaper", "personality", "djAvatar", "userAvatar", "playerBg"] as const;
type SyncKey = (typeof SYNC_KEYS)[number];

interface SyncMeta {
  lastModified: number; // 本端已吸收到的云端 updatedAt（0 = 从未同步）
}

function readMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(KEY.meta);
    if (raw) {
      const m = JSON.parse(raw) as Partial<SyncMeta>;
      if (typeof m.lastModified === "number") return { lastModified: m.lastModified };
    }
  } catch { /* ignore */ }
  return { lastModified: 0 };
}

function writeMeta(lastModified: number): void {
  try {
    localStorage.setItem(KEY.meta, JSON.stringify({ lastModified } satisfies SyncMeta));
  } catch { /* ignore */ }
}

/** 收集本端「存在」的设置（键不存在 → 跳过；空串 = 显式清除） */
function collectLocal(): Partial<Record<SyncKey, string>> {
  const out: Partial<Record<SyncKey, string>> = {};
  for (const k of SYNC_KEYS) {
    try {
      const v = localStorage.getItem(KEY[k]);
      if (v !== null) out[k] = v;
    } catch { /* ignore */ }
  }
  return out;
}

/** 本端是否已有任何设置（判断是否做种子推送） */
function hasLocalSettings(): boolean {
  return Object.keys(collectLocal()).length > 0;
}

/** 应用云端快照到本地（空串即清除；不存在的键不动） */
function applyRemote(s: Partial<Record<SyncKey, string>>): void {
  for (const k of SYNC_KEYS) {
    if (typeof s[k] !== "string") continue;
    try {
      if (s[k] === "") localStorage.removeItem(KEY[k]);
      else localStorage.setItem(KEY[k], s[k] as string);
    } catch { /* ignore */ }
  }
}

/** 读远端档案（返回 null = 无档案 / 非主人 / 网络失败） */
async function fetchRemote(): Promise<Partial<Record<SyncKey, string>> & { updatedAt?: number } | null> {
  const bond = getOwnerBond();
  if (!bond) return null;
  try {
    const deviceId = getDeviceId();
    const res = await fetch(`/api/owner/settings?deviceId=${encodeURIComponent(deviceId)}&bond=${encodeURIComponent(bond)}`);
    const j = (await res.json()) as { code?: number; data?: { settings?: { updatedAt?: number } & Partial<Record<SyncKey, string>> | null } };
    if (res.ok && j.code === 0 && j.data?.settings) return j.data.settings;
    return null;
  } catch {
    return null;
  }
}

/** 推送本端设置到云端（只带存在的键）。成功返回云端 updatedAt，失败返回 0 */
export async function pushSettings(): Promise<number> {
  const bond = getOwnerBond();
  if (!bond) return 0;
  const local = collectLocal();
  if (Object.keys(local).length === 0) return 0;
  try {
    const res = await fetch("/api/owner/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId(), bond, settings: local }),
    });
    const j = (await res.json()) as { code?: number; data?: { settings?: { updatedAt?: number } } };
    if (res.ok && j.code === 0 && typeof j.data?.settings?.updatedAt === "number") {
      writeMeta(j.data.settings.updatedAt);
      return j.data.settings.updatedAt;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * 启动同步（主人设备）：
 * - 云端无档案（从未建 / Render Deploy 重置丢失）→ 本端有设置则无条件种子推送
 *   （权威自愈：meta 无论新旧都补推，杜绝"云端空了但本端以为同步过 → 永不推"的僵死）
 * - meta=0 从未同步过 → 本端作权威，种子推送（覆盖云端旧脏数据）→ 首次拥有者赢
 * - meta=0 但本端无任何配置（手机全新首次打开）→ 反向从远端拉（PC 已配过的跟过来）
 * - meta>0 已同步过：
 *     · 远端比本端新（R > L）→ 应用远端 + reload
 *     · 本端比远端新（L > R）→ 上次推送失败 → 补推
 *
 * 返回 true 表示"已应用远端并触发 reload"（调用方无需再操作）
 */
export async function pullSettings(): Promise<boolean> {
  const bond = getOwnerBond();
  if (!bond) return false;
  const remote = await fetchRemote();
  const meta = readMeta();

  // —— 云端无档案（从未建过 / Deploy 重置丢档）——
  // 本端只要有任何设置就无条件重新种子推送：这是"云端被重置后自愈"的唯一入口，
  // 否则 meta>0 会让本端误以为"同步过了"而永不补推 → 两端永久僵死（辛老师遇到的正是这个）
  if (!remote || typeof remote.updatedAt !== "number") {
    if (hasLocalSettings()) await pushSettings();
    return false;
  }

  // —— 首次同步：meta=0 —— 本端作权威（避免被任何旧脏数据蒙骗）
  if (meta.lastModified === 0) {
    if (hasLocalSettings()) {
      // 本端有配（PC 已精心调好壁纸头像）→ 推一次作为权威
      await pushSettings();
      return false;
    }
    // 本端没任何配置（手机全新首次打开）→ 远端有就拉过来
    applyRemote(remote);
    writeMeta(remote.updatedAt);
    setTimeout(() => location.reload(), 60);
    return true;
  }

  // —— 已同步过：双向比对（last-write-wins）——
  const R = remote.updatedAt;
  const L = meta.lastModified;
  if (R > L) {
    applyRemote(remote);
    writeMeta(R);
    setTimeout(() => location.reload(), 60);
    return true;
  }
  if (L > R) void pushSettings();
  return false;
}
