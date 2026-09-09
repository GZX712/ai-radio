/**
 * 主人云端档案 · 聊天卷 —— 前端同步模块
 *
 * 目标（辛老师需求）：把"我与 DJ 的历史对话"并入主人档案体系，
 *   只在绑定了主人的设备出现；其他设备（客人）看不见。
 *
 * 协议（与服务端 server/services/ownerChat.ts 对应）：
 *   - pullChat()：主人设备启动时 GET /api/owner/chat → 取云端全量
 *   - pushChat()：本地有新对话后 POST /api/owner/chat 全量推送
 *   - 服务端按 指纹(role|kind|time|en|zh) 幂等去重 → 重复推送无害
 *   - mergeChat(local, remote)：指纹并集 → 双设备并发不丢消息
 *
 * 隐私：本模块只应在 isOwnerDevice() 为真时调用；客人设备不请求
 * （服务端对 guest 也一律 403，双保险）。
 */
import { getDeviceId, getOwnerBond } from "./deviceIdentity";
import type { ChatHistoryItem } from "@/store/useRadioStore";

export const CHAT_MAX = 100; // 与 store HISTORY_MAX 保持一致

/** 与后端 ownerChat.ts 完全一致的指纹算法（跨端去重必须同构） */
function chatFp(it: Pick<ChatHistoryItem, "role" | "kind" | "time" | "en" | "zh">): string {
  return [it.role, it.kind, it.time, it.en, it.zh].join("\u0001");
}

/** 只保留会参与云同步的消息（user 消息 + DJ reply；auto 丢弃） */
export function filterChatItems(items: ChatHistoryItem[]): ChatHistoryItem[] {
  return items
    .filter((x) => x && (x.role === "user" || (x.role === "dj" && x.kind === "reply")))
    .slice(-CHAT_MAX);
}

/**
 * 并集合并本地 + 云端历史（指纹去重，按本地顺序保持；云端独有的补在后面）。
 * 双端任何一端的消息都不会因另一端全量推送而丢失。
 */
export function mergeChat(local: ChatHistoryItem[], remote: ChatHistoryItem[]): ChatHistoryItem[] {
  const merged: ChatHistoryItem[] = [];
  const seen = new Set<string>();
  for (const it of [...local, ...remote]) {
    if (!it || (it.role !== "user" && !(it.role === "dj" && it.kind === "reply"))) continue;
    const f = chatFp(it);
    if (seen.has(f)) continue;
    seen.add(f);
    merged.push(it);
  }
  return merged.slice(-CHAT_MAX);
}

/** 读云端聊天历史（仅主人设备调用；非主人/失败返回 null） */
export async function pullChat(): Promise<{ items: ChatHistoryItem[]; updatedAt: number } | null> {
  const bond = getOwnerBond();
  if (!bond) return null;
  try {
    const deviceId = getDeviceId();
    const res = await fetch(`/api/owner/chat?deviceId=${encodeURIComponent(deviceId)}&bond=${encodeURIComponent(bond)}`);
    const j = (await res.json()) as {
      code?: number;
      data?: { items?: ChatHistoryItem[]; updatedAt?: number };
    };
    if (res.ok && j.code === 0 && Array.isArray(j.data?.items)) {
      return { items: filterChatItems(j.data.items as ChatHistoryItem[]), updatedAt: j.data.updatedAt ?? 0 };
    }
    return null;
  } catch {
    return null;
  }
}

/** 全量推送本地对话上云（服务端指纹幂等，重复推送无害）。成功 true */
export async function pushChat(items: ChatHistoryItem[]): Promise<boolean> {
  const bond = getOwnerBond();
  if (!bond) return false;
  const clean = filterChatItems(items);
  if (clean.length === 0) return false;
  try {
    const res = await fetch("/api/owner/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId(), bond, items: clean }),
    });
    const j = (await res.json()) as { code?: number };
    return res.ok && j.code === 0;
  } catch {
    return false;
  }
}
