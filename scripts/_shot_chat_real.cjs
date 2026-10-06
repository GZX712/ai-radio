/* 真实环境聊天气泡截图：本地后端 + 真 LLM 回复，手机视口 */
const path = require("path");
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";
const SHOTS = path.resolve(__dirname, "..", "shots");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 120)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // 客人模式：点「开始电台」
  const startBtn = page.locator("text=开始电台").first();
  if (await startBtn.count()) {
    await startBtn.click().catch(() => {});
    console.log("clicked 开始电台");
    await page.waitForTimeout(4000);
  }

  // 发两条消息，让 DJ/用户气泡都出现
  const input = page.locator(".chat-input");
  await input.waitFor({ state: "visible", timeout: 15000 });

  await input.fill("今天上班好累啊");
  await page.locator(".chat-send").click();
  console.log("sent #1, waiting reply...");
  // 等 DJ 回复气泡出现（用户气泡 1 + DJ 回复 1）
  await page.waitForFunction(
    () => document.querySelectorAll(".chat-msg.dj").length >= 1,
    { timeout: 60000 }
  );
  await page.waitForTimeout(1500);

  await input.fill("那讲个笑话吧");
  await page.locator(".chat-send").click();
  console.log("sent #2, waiting reply...");
  await page.waitForFunction(
    () => document.querySelectorAll(".chat-msg.dj").length >= 2,
    { timeout: 60000 }
  );
  await page.waitForTimeout(2000);

  const out = path.join(SHOTS, "chat_real_bubble.png");
  await page.screenshot({ path: out, fullPage: false });
  console.log("saved:", out);

  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
