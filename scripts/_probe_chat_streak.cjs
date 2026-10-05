/**
 * 连发压测探针：模拟真实客户端在**同一条 WS**上连发 5 条聊天，
 * 每条都按真实格式带累积 history（user=中文原文, assistant=DJ 的 en），
 * 记录每条的：耗时 / provider / 是否 fallback / 文本开头。
 * 用来复现辛老师报告的「只能说两句，后面就卡壳」。
 */
"use strict";

const WS_URL = process.env.WS_URL || "wss://ai-radio-server.onrender.com/ws";
const TEXTS = [
  "在嘛？",
  "现在放的这首歌叫什么名字？",
  "这歌谁唱的，有什么背景吗？",
  "你觉得我今天适合听点什么？",
  "再来首类似的吧",
];
const PER_MSG_TIMEOUT = 60_000;

const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(7) + "ms";
const history = [];
let idx = 0;
let ws;
let currentTimer = null;

function sendNext() {
  if (idx >= TEXTS.length) {
    console.log(ts(), "🏁 全部完成");
    try { ws.close(); } catch {}
    process.exit(0);
  }
  const text = TEXTS[idx];
  const n = idx + 1;
  console.log(ts(), `📤 [${n}/5] 发送: "${text}" (history=${history.length} 条)`);
  const sendAt = Date.now();
  ws.send(JSON.stringify({ type: "chat", text, history: history.slice(-10) }));

  currentTimer = setTimeout(() => {
    console.log(ts(), `⏰ [${n}/5] ${PER_MSG_TIMEOUT / 1000}s 无回复 —— 卡壳复现!`);
    process.exit(4);
  }, PER_MSG_TIMEOUT);

  const onMsg = (ev) => {
    let m;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.type !== "chat-reply") return;
    ws.removeEventListener("message", onMsg);
    clearTimeout(currentTimer);
    const cost = ((Date.now() - sendAt) / 1000).toFixed(1);
    const isFallback = m.provider === "fallback";
    console.log(
      ts(),
      `💬 [${n}/5] ${cost}s provider=${m.provider}${isFallback ? " ⚠️FALLBACK" : ""} hasAudio=${!!m.audioUrl}`,
    );
    console.log("        zh:", (m.zh || "").slice(0, 80));
    // 累积 history（仿真实客户端：user 存原文，assistant 存 en）
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: m.en || "" });
    idx++;
    setTimeout(sendNext, 800); // 间隔 0.8s 像真人
  };
  ws.addEventListener("message", onMsg);
}

ws = new WebSocket(WS_URL);
ws.onopen = () => {
  console.log(ts(), "✅ WS open");
  sendNext();
};
ws.onerror = (e) => console.log(ts(), "❌ WS error:", e.message || String(e));
ws.onclose = (e) => {
  console.log(ts(), `🔌 WS close code=${e.code} (第 ${idx + 1} 条进行中)`);
  process.exit(3);
};
