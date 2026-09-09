/**
 * 手机主人「看到与 DJ 历史对话」专项截图：直接进主界面（已绑定 + 跳过开始页）
 * 复用后端已写入的 5 条聊天历史。
 */
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const URL = "http://127.0.0.1:8899";
const OUT = "D:\\Workspace\\AI工作空间仓库\\ai-radio\\shots";
const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const phone = await phoneCtx.newPage();
  await phone.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await phone.evaluate(() => document.querySelector(".start-overlay")?.remove());

  // claim → reload → 等 pull 拉云端 5 条 → 再次 remove start-overlay（reload 后会重生）→ 等 hydrate
  await phone.evaluate(async () => {
    const did = "chat-e2e-phone-002";
    localStorage.setItem("radio_device_id", did);
    const res = await fetch("/api/device/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "xradio-master-2026", deviceId: did }),
    });
    const j = await res.json();
    if (j.code === 0) localStorage.setItem("radio_owner_bond", j.data.bond);
  });
  await phone.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await phone.waitForTimeout(3500);
  // pull 完成后再移除一次覆盖层，让 ChatPanel hydrate 的 5 条历史气泡可见
  await phone.evaluate(() => document.querySelector(".start-overlay")?.remove());
  await phone.waitForTimeout(800); // 给 hydrate setTimeout 0 + 渲染一点时间
  const diag = await phone.evaluate(() => {
    const bubbles = document.querySelectorAll(".chat-msg").length;
    const userBubbles = document.querySelectorAll(".chat-msg.user").length;
    const djBubbles = document.querySelectorAll(".chat-msg.dj").length;
    return `bubbles=${bubbles}|user=${userBubbles}|dj=${djBubbles}`;
  });
  console.log("[PHONE-IN]", diag);
  await phone.screenshot({ path: OUT + "\\chat_phone_owner_history.png" });
  console.log("[PHONE-IN] saved chat_phone_owner_history.png");
  await browser.close();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
