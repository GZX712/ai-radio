# -*- coding: utf-8 -*-
"""一次性替换脚本：设备隔离（owner 直达电台 + 聊天本地化/客人无痕）
仅在 old 恰好出现 1 次时替换；全部通过才写盘。用法: python _apply_device_iso.py
"""
import io, sys

BASE = r"D:\Workspace\AI工作空间仓库\ai-radio"

def patch(rel, pairs):
    p = BASE + "\\" + rel.replace("/", "\\")
    with io.open(p, "r", encoding="utf-8") as f:
        s = f.read()
    done = 0
    for i, (old, new) in enumerate(pairs):
        n = s.count(old)
        if n == 0:
            print(f"[SKIP] {rel} #{i}: 已应用或不存在")
            continue
        s = s.replace(old, new)
        done += 1
    if done == 0:
        print(f"[NOOP] {rel}: 全部已应用")
        return
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    print(f"[OK] {rel}: {done} 处替换")

# ---------- server/index.ts ----------
patch("server/index.ts", [
    # import 收敛
    ('import { initHistoryDb, recordEvent, recentEvents, recentChatTurns } from "./services/historyDb";',
     'import { initHistoryDb, recentEvents } from "./services/historyDb";'),
    ('import { getOwnerSettings, saveOwnerSettings } from "./services/ownerStore";\nimport { getOwnerChat, appendOwnerChat } from "./services/ownerChat";',
     'import { getOwnerSettings, saveOwnerSettings } from "./services/ownerStore";'),
    # 删除聊天云档案 API
    ('''// ============== 主人云端档案 · 聊天卷：跨设备同步「我与 DJ 的历史对话」 ==============
// 隐私边界：以下两个接口与设置卷同验签 —— 只有主人设备能读写；客人一律 403。

/** 读聊天历史：?deviceId=&bond= → { items[], updatedAt }（仅主人可读，客人不可见） */
app.get("/api/owner/chat", (req, res) => {
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : "";
  const bond = typeof req.query.bond === "string" ? req.query.bond : "";
  if (!verifyBond(deviceId, bond)) {
    res.status(403).json({ code: 403, message: "仅主人可访问历史对话" });
    return;
  }
  try {
    const { items, updatedAt } = getOwnerChat();
    res.json({ code: 0, data: { items, updatedAt } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err instanceof Error ? err.message : "读取历史对话失败" });
  }
});

/** 追加聊天历史：body { deviceId, bond, items[] } → 指纹幂等合并，重复推送无害 */
app.post("/api/owner/chat", (req, res) => {
  const { deviceId, bond, items } = (req.body ?? {}) as {
    deviceId?: unknown;
    bond?: unknown;
    items?: unknown;
  };
  const did = typeof deviceId === "string" ? deviceId : "";
  const bd = typeof bond === "string" ? bond : null;
  if (!verifyBond(did, bd)) {
    res.status(403).json({ code: 403, message: "仅主人可写入历史对话" });
    return;
  }
  try {
    const list = Array.isArray(items) ? items : [];
    if (list.length > 50) list.length = 50; // 单次最多 50 条，防异常客户端撑爆
    const r = appendOwnerChat(list);
    res.json({ code: 0, data: { updatedAt: r.updatedAt, total: r.total } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err instanceof Error ? err.message : "写入历史对话失败" });
  }
});

/** 在线设备概览（供主人查看：现在谁在听，是主人还是客人） */''',
     '/** 在线设备概览（供主人查看：现在谁在听，是主人还是客人） */'),
    # ws chat: 删除用户问题全局落库
    ('''        // 3. 闲聊：DJ 直接回应话题（不跑题）
        try {
          // [2026-09-09] 历史库：#3 SQLite —— 用户问题落库(跨会话记忆的"问"半边)
          recordEvent("chat_user", String(msg.text).slice(0, 500));
          const personality = (msg.personality && typeof msg.personality === "object")''',
     '''        // 3. 闲聊：DJ 直接回应话题（不跑题）
        try {
          const personality = (msg.personality && typeof msg.personality === "object")'''),
    # ws chat: history 只取本设备会话历史
    ('''          // 前端 send chat 时会带历史对话 (history: [{role, content}])
          // 交给 LLM 让 DJ 看到上文，避免"答非所问"
          // [2026-09-09] 前端没带 history(新会话/刷新后首次) → 从 SQLite 兜底注入最近对话,
          //   DJ 记得"上一会话"聊过什么(不再刷新即失忆)。
          // [2026-09-09·隐私] 主人聊天史只回填给主人连接 —— 客人会话不带主人跨会话历史，
          //   避免"客人在 DJ 面前看到主人聊过什么"(辛老师：历史对话仅主人设备可见)。
          const sessionHistory = Array.isArray(msg.history)
            ? (msg.history as { role?: unknown; content?: unknown }[])
                .filter((x) =>
                  (x.role === "user" || x.role === "assistant") &&
                  typeof x.content === "string" &&
                  (x.content as string).trim().length > 0
                )
                .slice(-10)
                .map((x) => ({ role: x.role as "user" | "assistant", content: x.content as string }))
            : [];
          const history = sessionHistory.length > 0
            ? sessionHistory
            : (role === "owner" ? recentChatTurns(8) : []);''',
     '''          // 前端 send chat 时会带本设备的会话历史 (history: [{role, content}]) 交给 LLM，
          // 让 DJ 看到上文、避免"答非所问"。
          // [2026-09-09·设备隔离] 上下文只取该设备自己带过来的会话历史 —— 服务端不再
          //   注入任何跨会话/跨设备聊天记忆。每个设备与 DJ 的对话彼此独立、不可见不共享：
          //   新设备接入不会带上别的设备聊过什么；刷新后 DJ 只记得本设备最近聊过的 10 条。
          const history = Array.isArray(msg.history)
            ? (msg.history as { role?: unknown; content?: unknown }[])
                .filter((x) =>
                  (x.role === "user" || x.role === "assistant") &&
                  typeof x.content === "string" &&
                  (x.content as string).trim().length > 0
                )
                .slice(-10)
                .map((x) => ({ role: x.role as "user" | "assistant", content: x.content as string }))
            : [];'''),
    # ws chat: 删除 DJ 回复全局落库（正常 + fallback）
    ('''          ws.send(JSON.stringify({ type: "chat-reply", ...dj }));
          // [2026-09-09] 历史库：DJ 回复落库(跨会话记忆的"答"半边)
          try { recordEvent("chat_dj", (dj.zh || dj.en || "").slice(0, 500)); } catch { /* noop */ }
        } catch (err) {''',
     '''          ws.send(JSON.stringify({ type: "chat-reply", ...dj }));
        } catch (err) {'''),
    ('''          try { recordEvent("chat_dj", "抱歉，DJ 出去抽烟了——换个话题试试？"); } catch { /* noop */ }
          console.error("[WS-chat] 失败:", err);''',
     '''          console.error("[WS-chat] 失败:", err);'''),
])

# ---------- src/components/ChatPanel.tsx ----------
patch("src/components/ChatPanel.tsx", [
    ('''import { pushSettings } from "@/lib/settingsSync";
import { pushChat } from "@/lib/chatSync";
import { isOwnerDevice } from "@/lib/deviceIdentity";''',
     '''import { pushSettings } from "@/lib/settingsSync";
import { isOwnerDevice } from "@/lib/deviceIdentity";'''),
    ('''  // 启动时把持久化历史里的 user/reply 灌入 messages（首次挂载；云端聊天档案
  // 拉取完成后 store.chatHistory 更新也会再次触发本段 → 自动 hydrate 显示）
  const historyHydrated = useRef(false);
  if (!historyHydrated.current && persistedChat.length > 0) {''',
     '''  // 启动时把本机持久化历史里的 user/reply 灌入 messages（首次挂载）。
  // 仅主人设备 hydrate（客人设备无痕：启动时历史已被清空，也绝不回灌历史）
  const historyHydrated = useRef(false);
  if (!historyHydrated.current && persistedChat.length > 0 && isOwnerDevice()) {'''),
    ('''  // 持久化：messages 变化时把 user + DJ reply 写入 localStorage（debounce 500ms）
  // - 用户消息（role==="user"，kind 这里当成 "user"）— 全部保存
  // - DJ 真回复（role==="dj" && kind==="reply"）— 保存
  // - DJ 自动话术（kind==="auto"）— 不保存（辛老师要的："切歌话术不需要保存"）
  // 上限 100 条（store loadChatHistory 同样限制）
  // [2026-09-09] 主人设备：同步并入主人云端档案·聊天卷（服务端指纹幂等去重，
  //   重复全量推送无害；内容没变时跳过避免无意义请求）。客人设备不推送。
  const lastPushedRef = useRef("");
  useEffect(() => {
    const t = window.setTimeout(() => {
      const persisted = messages
        .filter((m) => m.role === "user" || (m.role === "dj" && m.kind === "reply"))
        .slice(-100)
        .map((m) => ({
          id: m.id,
          role: m.role,
          kind: (m.role === "user" ? "user" : "reply") as "user" | "reply",
          en: m.en,
          zh: m.zh,
          time: m.time,
        }));
      saveChatHistory(persisted);
      const sig = JSON.stringify(persisted);
      if (isOwnerDevice() && sig !== lastPushedRef.current) {
        lastPushedRef.current = sig;
        void pushChat(persisted);
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [messages, saveChatHistory]);''',
     '''  // 持久化：messages 变化时把 user + DJ reply 写入本机 localStorage（debounce 500ms）
  // - 用户消息（role==="user"）— 全部保存
  // - DJ 真回复（role==="dj" && kind==="reply"）— 保存
  // - DJ 自动话术（kind==="auto"）— 不保存（辛老师要的："切歌话术不需要保存"）
  // 上限 100 条（store loadChatHistory 同样限制）
  // [2026-09-09·设备隔离] 只在本机保存、不做任何云同步 → 每台设备的对话彼此独立、
  //   不可见不共享。仅主人设备落盘（刷新/重开历史还在）；
  //   其他新接入设备（客人）不保存任何记录 → 无痕，刷新即消失。
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!isOwnerDevice()) return; // 客人设备：聊天只在会话内存里，不留痕
      const persisted = messages
        .filter((m) => m.role === "user" || (m.role === "dj" && m.kind === "reply"))
        .slice(-100)
        .map((m) => ({
          id: m.id,
          role: m.role,
          kind: (m.role === "user" ? "user" : "reply") as "user" | "reply",
          en: m.en,
          zh: m.zh,
          time: m.time,
        }));
      saveChatHistory(persisted);
    }, 500);
    return () => window.clearTimeout(t);
  }, [messages, saveChatHistory]);'''),
])

# ---------- src/store/useRadioStore.ts ----------
patch("src/store/useRadioStore.ts", [
    ('''  // 聊天对话历史（最近 user + DJ reply；DJ auto 不存）；启动时从 localStorage 加载
  chatHistory: loadChatHistory(),
  saveChatHistory: (items) => {
    try { localStorage.setItem("ai-radio-chat-history", JSON.stringify(items)); } catch { /* ignore */ }
    // 同时更新 state —— 主人聊天档案云端 pull 合并后需要触发 ChatPanel hydrate 显示
    set({ chatHistory: items });
  },''',
     '''  // 聊天对话历史（最近 user + DJ reply；DJ auto 不存）；启动时从 localStorage 加载。
  // [2026-09-09·设备隔离] 仅主人设备调用（本地档案，无云同步）；客人设备不落盘 → 无痕。
  chatHistory: loadChatHistory(),
  saveChatHistory: (items) => {
    try { localStorage.setItem("ai-radio-chat-history", JSON.stringify(items)); } catch { /* ignore */ }
    // 同时更新 state → ChatPanel hydrate 显示
    set({ chatHistory: items });
  },'''),
])

print("ALL DONE")
