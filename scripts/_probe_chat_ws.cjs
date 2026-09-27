/**
 * 生产环境 WS 聊天链路探针
 * 连 wss://ai-radio-server.onrender.com/ws，发一条聊天，观察:
 *  - WS 能否连上
 *  - chat-reply 是否回来、耗时多久
 *  - 中途有没有 error / 其他事件
 * 用法: node scripts/_probe_chat_ws.cjs [消息文本]
 */
"use strict";

const WS_URL = "wss://ai-radio-server.onrender.com/ws";
const TEXT = process.argv[2] || "在嘛？";
const TIMEOUT_MS = 90_000;

const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(6) + "ms";
const log = (...a) => console.log(ts(), ...a);

// node 22 内置 WebSocket (undici)
const ws = new WebSocket(WS_URL);
let replied = false;

const killer = setTimeout(() => {
  log("⏰ 超时", TIMEOUT_MS / 1000 + "s 未收到 chat-reply");
  try { ws.close(); } catch {}
  process.exit(2);
}, TIMEOUT_MS);

ws.onopen = () => {
  log("✅ WS open, readyState=", ws.readyState);
  const msg = {
    type: "chat",
    text: TEXT,
    history: [],
    // 客人身份：不带 bond / personality（避免污染全局音色）
  };
  ws.send(JSON.stringify(msg));
  log("📤 已发送 chat:", JSON.stringify(TEXT));
};

ws.onmessage = (ev) => {
  let m;
  try { m = JSON.parse(String(ev.data)); } catch { return log("📥 非JSON:", String(ev.data).slice(0, 200)); }
  if (m.type === "chat-reply") {
    replied = true;
    log("💬 chat-reply:", JSON.stringify({
      scene: m.scene, action: m.action,
      text: (m.text || "").slice(0, 120),
      audioUrl: m.audioUrl ? String(m.audioUrl).slice(0, 80) : null,
      hasTts: !!m.audioUrl,
    }));
    clearTimeout(killer);
    try { ws.close(); } catch {}
    process.exit(0);
  }
  log("📥", m.type, JSON.stringify(m).slice(0, 200));
};

ws.onerror = (e) => log("❌ WS error:", e.message || String(e));
ws.onclose = (e) => {
  log("🔌 WS close code=", e.code, "reason=", e.reason || "(none)", "replied=", replied);
  if (!replied) process.exit(3);
};
