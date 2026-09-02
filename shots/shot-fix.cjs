/* 修复后截图验证：3 个主题 x 窄屏，注入测试消息 */
const { chromium } = require("playwright-core");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://localhost:8787/?testMsgs=1";

const THEMES = ["glass", "pop", "comic", "cyber"];
const TEST_MSGS = [
  { id: 1, role: "dj", kind: "auto", en: "Good evening! Tonight we start with Ed Sheeran.", zh: "晚上好！今晚第一首是 Ed Sheeran。", time: "21:30" },
  { id: 2, role: "user", kind: "auto", en: "今天天气怎么样？", zh: "今天天气怎么样？", time: "21:31" },
  { id: 3, role: "dj", kind: "reply", en: "Sunny 26°C here. Perfect for a drive with the windows down.", zh: "晴天 26 度，适合开窗兜风。", time: "21:31", audioUrl: "/audio/x.mp3" },
];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const theme of THEMES) {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(({ t, msgs }) => {
      try {
        localStorage.setItem("ai-radio-wallpaper-id", t);
        localStorage.setItem("wallpaperId", JSON.stringify(t));
        localStorage.setItem("ai-radio-wallpaper", JSON.stringify({ id: t }));
        localStorage.setItem("ai-radio-test-messages", JSON.stringify(msgs));
      } catch (e) {}
    }, { t: theme, msgs: TEST_MSGS });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `D:/Workspace/AI工作空间仓库/ai-radio/shots/_fix_${theme}_390.png`, fullPage: false });
    console.log("shot", theme);
  }
  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
