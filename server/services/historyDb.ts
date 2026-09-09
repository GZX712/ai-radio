/**
 * [2026-09-09] 电台历史持久化（SQLite · better-sqlite3）
 *
 * 辛老师需求(#3):DJ 要有真实历史——播过什么歌、说过什么话、聊过什么,
 * 服务重启/页面刷新后不再"失忆"。配合 dj.ts 内存 onAirLog 双层:
 *   - 内存 onAirLog:热路径秒读(prompt 注入用)
 *   - 本模块 SQLite:启动回填内存 + 兜底注入跨会话聊天历史
 *
 * 稳定优先设计(少 BUG):
 *   1. 初始化失败(权限/只读盘/原生模块异常)→ 降级 no-op 模式 + warn 一次,
 *      主流程(广播/切歌/聊天)零影响 —— 历史是增强不是依赖
 *   2. 写入同步且极快(<1ms),广播路径可接受;仍包 try/catch 兜底
 *   3. 防无限膨胀:超上限删最旧
 *
 * Render 免费版说明:每次 Deploy 全新实例,data/ 会重置 → 历史库跨 Deploy 丢失,
 * 但防"进程级重启失忆"完全够用(本地开发则永久保留)。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export type HistoryKind = "song" | "dj" | "chat_user" | "chat_dj";
export interface HistoryEvent {
  id: number;
  kind: HistoryKind;
  text: string;
  ts: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../data/history.db");
const MAX_ROWS = 3000; // 保留最近 ~3000 条(约几天的播出+对话量)
const TRIM_BATCH = 500; // 超限一次删 500,避免频繁触发

let db: Database.Database | null = null;
let degraded = false; // no-op 降级模式

/** 供 initHistoryDb 判断:当前是降级(失败)还是可用 */
export function historyHealthy(): boolean {
  return db !== null;
}

/** 初始化:建 data/ 目录 + 建表。失败 → 降级 no-op,不抛错。 */
export function initHistoryDb(): void {
  if (db) return;
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    `);
    console.log(`[historyDb] 就绪: ${DB_PATH}`);
  } catch (err) {
    db = null;
    degraded = true;
    console.warn("[historyDb] 初始化失败,历史记忆降级 no-op(不影响主流程):",
      err instanceof Error ? err.message : String(err));
  }
}

/** 记录一条事件(播出/台词/对话)。同步写,失败静默。 */
export function recordEvent(kind: HistoryKind, text: string): void {
  if (!db || degraded) return;
  const clean = String(text ?? "").trim();
  if (!clean) return;
  try {
    db!.prepare("INSERT INTO events (kind, text, ts) VALUES (?, ?, ?)")
      .run(kind, clean.slice(0, 500), Date.now());
    // 防膨胀(低频触发,不阻塞主路径)
    const { c } = db!.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
    if (c > MAX_ROWS) {
      db!.prepare("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY ts ASC LIMIT ?)")
        .run(TRIM_BATCH);
    }
  } catch (err) {
    console.warn("[historyDb] 写入失败:", err instanceof Error ? err.message : String(err));
  }
}

/** 取最近 N 条指定类型事件(时间正序返回) */
export function recentEvents(kinds: HistoryKind[], limit = 10): HistoryEvent[] {
  if (!db || degraded) return [];
  try {
    const marks = kinds.map(() => "?").join(",");
    const rows = db!.prepare(
      `SELECT id, kind, text, ts FROM events
       WHERE kind IN (${marks})
       ORDER BY ts DESC LIMIT ?`
    ).all(...kinds, limit) as { id: number; kind: string; text: string; ts: number }[];
    return rows.reverse().map((r) => ({ id: r.id, kind: r.kind as HistoryKind, text: r.text, ts: r.ts }));
  } catch {
    return [];
  }
}

/** 取最近对话轮次 → LLM messages(前端无 history 时兜底注入,跨会话记忆) */
export function recentChatTurns(limit = 8): { role: "user" | "assistant"; content: string }[] {
  const rows = recentEvents(["chat_user", "chat_dj"], limit * 2);
  // 配对:user 原样;assistant 标记为中文回复(存的是 zh||en)
  return rows
    .map((e) => ({
      role: e.kind === "chat_user" ? ("user" as const) : ("assistant" as const),
      content: e.text,
    }))
    .slice(-limit);
}

/** 诊断:当前事件总数 */
export function countEvents(): number {
  if (!db || degraded) return -1;
  try {
    const { c } = db!.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
    return c;
  } catch {
    return -1;
  }
}
