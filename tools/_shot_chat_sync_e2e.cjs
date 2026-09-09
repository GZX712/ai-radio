/**
 * 端到端验证「主人云端档案 · 聊天卷」跨设备历史对话同步：
 *   PART A PC 主人：本地塞 5 条对话历史 → 启动自动 push 上云
 *   PART B 手机主人（全新 profile）：claim → reload → 自动 pull → ChatPanel hydrate 显示历史
 *   PART C 客人（无 bond）：打开 → 看不到任何主人历史对话
 * 隐私断言：PART C 的 ChatPanel 无 .chat-msg（历史）元素
 */
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const URL = "http://127.0.0.1:8899";
const OUT = "D:\\Workspace\\AI工作空间仓库\\ai-radio\\shots";
const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";

// 模拟 5 条真实对话（user + DJ reply 交替）
const SEED_HISTORY = [
  { id: 1, role: "user", kind: "user", en: "今天深圳天气怎么样？", zh: "今天深圳天气怎么样？", time: "09:01" },
  { id: 2, role: "dj", kind: "reply", en: "Shenzhen is sunny, 31 degrees — perfect for staying indoors with good music.", zh: "深圳今天晴天，31 度——适合窝在家里听歌。", time: "09:02" },
  { id: 3, role: "user", kind: "user", en: "来一首周杰伦的歌", zh: "来一首周杰伦的歌", time: "09:05" },
  { id: 4, role: "dj", kind: "reply", en: "Here comes Jay Chou — 七里香, enjoy!", zh: "周杰伦的《七里香》来了，请享用！", time: "09:06" },
  { id: 5, role: "user", kind: "user", en: "这歌有什么故事吗？", zh: "这歌有什么故事吗？", time: "09:07" },
];

async function claim(page, deviceId) {
  return page.evaluate(async (did) => {
    localStorage.setItem("radio_device_id", did);
    const res = await fetch("/api/device/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "xradio-master-2026", deviceId: did }),
    });
    const j = await res.json();
    if (j.code !== 0) return "CLAIM_FAIL:" + JSON.stringify(j);
    localStorage.setItem("radio_owner_bond", j.data.bond);
    return "OK:" + j.data.bond.slice(0, 12);
  }, deviceId);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });

  // ================= PART A：PC 主人（桌面） =================
  const pcCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const pc = await pcCtx.newPage();
  await pc.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  const pcDiag = await pc.evaluate(async (seed) => {
    document.querySelector(".start-overlay")?.remove();
    // 清空之前测试残留的同步状态，模拟一台"已绑定但从未同步聊天"的 PC
    localStorage.removeItem("ai-radio-sync-meta");
    localStorage.removeItem("ai-radio-chat-history");
    localStorage.setItem("ai-radio-chat-history", JSON.stringify(seed));
    return await fetch("/api/device/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "xradio-master-2026", deviceId: "chat-e2e-pc-001" }),
    }).then(async (r) => {
      const j = await r.json();
      if (j.code !== 0) return "CLAIM_FAIL:" + JSON.stringify(j);
      localStorage.setItem("radio_owner_bond", j.data.bond);
      localStorage.setItem("radio_device_id", "chat-e2e-pc-001");
      return "CLAIM_OK:" + j.data.bond.slice(0, 12);
    });
  }, SEED_HISTORY);
  console.log("[A-PC-DIAG]", pcDiag);
  // reload 触发 App 启动同步：pullChat(remote空) → merge(本地5) → saveChatHistory → pushChat(5) 上云
  await pc.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await pc.waitForTimeout(3000);
  const cloudCheck = await pc.evaluate(async () => {
    const bond = localStorage.getItem("radio_owner_bond");
    const did = localStorage.getItem("radio_device_id");
    const r = await fetch(`/api/owner/chat?deviceId=${encodeURIComponent(did)}&bond=${encodeURIComponent(bond)}`);
    const j = await r.json();
    if (j.code !== 0) return "CLOUD_FAIL:" + JSON.stringify(j);
    return "CLOUD_ITEMS=" + j.data.items.length + "|last=" + (j.data.items.at(-1)?.zh ?? "");
  });
  console.log("[A-PC-CLOUD]", cloudCheck);
  await pc.screenshot({ path: OUT + "\\chat_pc_owner.png" });
  console.log("[A-PC] saved chat_pc_owner.png");

  // ================= PART B：手机主人（全新 profile 首次打开） =================
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const phone = await phoneCtx.newPage();
  await phone.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await phone.evaluate(() => document.querySelector(".start-overlay")?.remove());
  console.log("[B-PHONE-DIAG]", await claim(phone, "chat-e2e-phone-002"));
  await phone.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  // 时序：mount → pullChat(云端5) → merge(本地0+5) → saveChatHistory → ChatPanel hydrate
  await phone.waitForTimeout(3500);
  const phoneDiag = await phone.evaluate(() => {
    const hist = JSON.parse(localStorage.getItem("ai-radio-chat-history") || "[]");
    const bubbles = document.querySelectorAll(".chat-msg").length;
    return `storeHist=${hist.length}|bubbles=${bubbles}|first=${hist[0]?.zh ?? ""}`;
  });
  console.log("[B-PHONE-DIAG]", phoneDiag);
  await phone.screenshot({ path: OUT + "\\chat_phone_owner_pull.png" });
  console.log("[B-PHONE] saved chat_phone_owner_pull.png");

  // ================= PART C：客人设备（无 bond，隐私断言） =================
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const guest = await guestCtx.newPage();
  await guest.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await guest.evaluate(() => document.querySelector(".start-overlay")?.remove());
  await guest.waitForTimeout(2500); // 让可能存在的错误 pull 尝试结束（客人前端不应发起）
  const guestDiag = await guest.evaluate(() => {
    const hist = localStorage.getItem("ai-radio-chat-history");
    const bubbles = document.querySelectorAll(".chat-msg").length;
    const bond = localStorage.getItem("radio_owner_bond");
    return `bond=${bond ?? "none"}|storeHist=${hist ?? "none"}|bubbles=${bubbles}`;
  });
  console.log("[C-GUEST-DIAG]", guestDiag); // 期望 bond=none storeHist=none bubbles=0
  await guest.screenshot({ path: OUT + "\\chat_guest_private.png" });
  console.log("[C-GUEST] saved chat_guest_private.png");

  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
