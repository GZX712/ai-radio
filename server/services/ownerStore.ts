/**
 * 主人云端档案（跨设备同步个性化设置）
 *
 * 背景：辛老师的 PC 配了自定义壁纸 / DJ 头像 / DJ 性格，但手机端 localStorage
 * 各自独立 → 两端永远不同步。本模块让所有"验签通过的主人设备"共享同一份配置：
 *
 *   - 任何主人设备改设置 → PUT /api/owner/settings 推全量快照
 *   - 任何主人设备启动 → GET /api/owner/settings 比对 updatedAt，远端新则覆盖本地
 *
 * 设计要点：
 * 1. 全量快照（不是 diff）：小体量配置，冲突策略 last-write-wins，简单可靠
 * 2. 头像 dataURL 可能数百 KB → express.json limit 已放宽
 * 3. data/owner-settings.json 尽力持久化：写失败绝不炸服务（降级为单设备体验）
 * 4. Render 免费版 Deploy 重建实例会丢文件（与 history.db 同级，接受）
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_FILE = path.resolve(__dirname, "../../data/owner-settings.json");

/** 云端档案结构（全量快照）。各键允许 null = 该端显式清除 */
export interface OwnerSettings {
  wallpaper?: string | null;
  personality?: string | null; // JSON 字符串（ai-radio-dj-personality 原文）
  djAvatar?: string | null; // dataURL
  userAvatar?: string | null; // dataURL
  playerBg?: string | null; // dataURL（播放器自定义背景）
  updatedAt: number;
}

let cache: OwnerSettings | null = null;
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const j = JSON.parse(raw) as OwnerSettings;
    if (j && typeof j.updatedAt === "number") cache = j;
    console.log("[ownerStore] 已加载主人云端档案 (updatedAt=" + cache?.updatedAt + ")");
  } catch {
    /* 首次启动无文件，静默 */
  }
}

/** 读取档案（无档案返回 null；读失败返回 null） */
export async function getOwnerSettings(): Promise<OwnerSettings | null> {
  await load();
  return cache;
}

/** 合并写入档案，返回最新档案（失败返回 null，不抛） */
export async function saveOwnerSettings(
  patch: Partial<OwnerSettings>,
): Promise<OwnerSettings | null> {
  await load();
  const next: OwnerSettings = {
    ...(cache ?? {}),
    ...patch,
    updatedAt: Date.now(),
  };
  // 清理未知键（只留白名单字段）
  const clean: OwnerSettings = { updatedAt: next.updatedAt };
  for (const k of ["wallpaper", "personality", "djAvatar", "userAvatar", "playerBg"] as const) {
    if (k in next && next[k] !== undefined) clean[k] = next[k];
  }
  cache = clean;
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(clean, null, 2), "utf8");
  } catch (err) {
    console.warn("[ownerStore] 档案写入失败(可忽略):", err instanceof Error ? err.message : String(err));
  }
  return cache;
}
