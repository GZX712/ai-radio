/** 探针2: dump chat-reply 完整 JSON */
"use strict";
const WS_URL = "wss://ai-radio-server.onrender.com/ws";
const TEXT = process.argv[2] || "你有心嘛？";
const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(6) + "ms";
const ws = new WebSocket(WS_URL);
const killer = setTimeout(() => { console.log(ts(), "⏰ 超时"); process.exit(2); }, 90_000);
ws.onopen = () => {
  console.log(ts(), "✅ open");
  ws.send(JSON.stringify({ type: "chat", text: TEXT, history: [] }));
};
ws.onmessage = (ev) => {
  let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
  if (m.type === "chat-reply") {
    console.log(ts(), "💬 FULL chat-reply:");
    console.log(JSON.stringify(m, null, 2));
    clearTimeout(killer); process.exit(0);
  }
  console.log(ts(), "📥", m.type);
};
ws.onerror = (e) => console.log(ts(), "❌", e.message || String(e));
ws.onclose = (e) => console.log(ts(), "🔌 close", e.code);
