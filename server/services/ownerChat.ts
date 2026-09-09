/**
 * 主人云端档案 · 聊天卷（跨设备同步「我与 DJ 的历史对话」）
 *
 * 与 owner-settings.json（设置卷）同属主人档案体系，但**刻意独立成文件**：
 *   1. 聊天是高频追加数据；设置是低频全量覆盖（last-write-wins）。
 *      混在一起会导致：一端改头像全量覆盖时把另一端刚聊的话冲掉。
 *   2. 本卷用「指纹幂等 append」而非 updatedAt 覆盖：
 *      - 客户端每次全量推送最近对话（重复无害）
 *      - 服务端按 fp = role|kind|time|en|zh 去重后合并 → 双设备并发不丢消息
 *      - 各端启动时「并集合并」本地 + 远端 → 最终一致
 *
 * 隐私边界（用户硬性要求）：只有验签通过的主人设备能读写本卷；
 * 客人设备前端根本不请求，后端对 guest 一律 403；DJ 的跨会话聊天
 * 上下文也不再向 guest 连接回填（见 index.ts chat 分支）。
 *
 * 稳定优先（与 ownerStore 同风格）：
 *   - 同步读写（无 await 间隙 → 事件循环内天然原子，无双写交错）
 *   - 写失败只 warn 绝不抛 → 降级为单设备体验
 *   - 上限 CHAT_MAX 条，超出删最旧
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_FILE = path.resolve(__dirname, "../../data/owner-chat.json");
const CHAT_MAX = 300; // 保留最近 300 条对话（客户端 UI 上限 100，留富余防两端并集溢出）
const TEXT_MAX = 2000; // 单条 en/zh 截断，防超大文本撑爆文件

export interface OwnerChatItem {
  role: "user" | "dj";
  /** user 消息统一记 "user"；DJ 真回复记 "reply"（auto 话术不参与云同步） */
  kind: "user" | "reply";
  en: string;
  zh: string;
  /** 客户端展示时间 HH:mm（保留原文，跨设备看到的时钟与源设备一致） */
  time: string;
  /** 服务端落库时间戳 */
  ts: number;
}

interface OwnerChatFile {
  items: OwnerChatItem[];
  updatedAt: number;
}

let cache: OwnerChatFile = { items: [], updatedAt: 0 };
let loaded = false;

/** 消息指纹：同 role+time+双语文本 → 视为同一条（幂等去重） */
function fp(it: Pick<OwnerChatItem, "role" | "kind" | "time" | "en" | "zh">): string {
  return [it.role, it.kind, it.time, it.en, it.zh].join("\u0001");
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const j = JSON.parse(raw) as OwnerChatFile;
      if (j && Array.isArray(j.items)) {
        cache = {
          items: j.items.filter((x) => x && (x.role === "user" || x.role === "dj")),
          updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : 0,
        };
        console.log(`[ownerChat] 已加载聊天档案 ${cache.items.length} 条`);
      }
    }
  } catch (err) {
    cache = { items: [], updatedAt: 0 };
    console.warn("[ownerChat] 聊天档案加载失败(按空档案继续):",
      err instanceof Error ? err.message : String(err));
  }
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.warn("[ownerChat] 聊天档案写入失败(可忽略,降级单设备):",
      err instanceof Error ? err.message : String(err));
  }
}

/** 读取聊天档案（正序返回；读失败/空返回空数组） */
export function getOwnerChat(): { items: OwnerChatItem[]; updatedAt: number } {
  load();
  return { items: cache.items, updatedAt: cache.updatedAt };
}

/**
 * 幂等追加：按指纹去重合并新消息（客户端可能重复全量推送）。
 * 返回最新档案的 { updatedAt, total }；失败也返回当前状态（不抛）。
 */
export function appendOwnerChat(rawItems: unknown[]): { updatedAt: number; total: number } {
  load();
  const seen = new Set(cache.items.map(fp));
  let added = 0;
  const now = Date.now();
  for (const x of rawItems) {
    if (!x || typeof x !== "object") continue;
    const it = x as Record<string, unknown>;
    const role = it.role === "dj" ? "dj" : it.role === "user" ? "user" : null;
    if (!role) continue;
    const kind = role === "dj" ? "reply" : "user"; // 服务端只收对话消息，kind 由 role 推导
    const en = String(it.en ?? "").slice(0, TEXT_MAX);
    const zh = String(it.zh ?? "").slice(0, TEXT_MAX);
    const time = String(it.time ?? "").slice(0, 8);
    if (!en && !zh) continue; // 双空没意义
    const item: OwnerChatItem = { role, kind, en, zh, time, ts: now + added };
    const key = fp(item);
    if (seen.has(key)) continue;
    seen.add(key);
    cache.items.push(item);
    added += 1;
  }
  if (added === 0) return { updatedAt: cache.updatedAt, total: cache.items.length };
  // 超限删最旧（按 ts 升序移除）
  if (cache.items.length > CHAT_MAX) {
    const drop = cache.items.length - CHAT_MAX;
    cache.items = cache.items.sort((a, b) => a.ts - b.ts).slice(drop);
  }
  cache.updatedAt = now;
  persist();
  return { updatedAt: cache.updatedAt, total: cache.items.length };
}
