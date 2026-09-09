/**
 * 手机端封面崩溃修复验证：
 *   iPhone viewport（hasTouch + pointer:coarse）→ 打开电台 → 点开始 → 等待歌曲就绪
 *   断言：封面区渲染的是单张 <img class="full-cover">，而不是 144 cell 的 .pixel-grid；
 *   全程监听 pageerror / console.error 确认无 JS 崩溃。
 */
const { chromium, devices } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const URL = "http://127.0.0.1:8899";
const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";
const OUT = "D:\\Workspace\\AI工作空间仓库\\ai-radio\\shots";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  // 点「开始电台」（若有引导页）
  const startBtn = await page.$(".start-btn");
  if (startBtn) { await startBtn.click(); await page.waitForTimeout(2000); }

  // 等待歌曲或封面出现（最多 15s）
  let hasCover = false;
  for (let i = 0; i < 15; i++) {
    const grid = await page.$(".pixel-grid");
    const full = await page.$(".cover-wrapper img.full-cover, .cover-wrapper .full-cover");
    const ph = await page.$(".cover-placeholder");
    if (grid || full || ph) { hasCover = true; break; }
    await page.waitForTimeout(1000);
  }

  const gridCount = await page.$$eval(".pixel-grid .pixel-cell", (els) => els.length).catch(() => -1);
  const fullCount = await page.$$eval(".cover-wrapper .full-cover", (els) => els.length).catch(() => -1);
  const placeholder = (await page.$(".cover-placeholder")) !== null;

  console.log("=== 手机端封面渲染状态 ===");
  console.log("cover wrapper 出现:", hasCover);
  console.log(".pixel-grid .pixel-cell 数量:", gridCount, gridCount === 0 ? "(触摸端不渲染网格 ✓)" : "(✗ 仍在渲染 144 cell!)");
  console.log(".full-cover <img> 数量:", fullCount, fullCount === 1 ? "(单张整图 ✓)" : "");
  console.log("cover-placeholder:", placeholder);

  if (placeholder) {
    console.log("NOTE: 本地后端暂无歌（placeholder）→ 封面组件未挂载，无法直接断言 img；改查组件逻辑正确性");
  }

  if (errors.length) {
    console.log("=== 页面错误 ===");
    errors.slice(0, 8).forEach((e) => console.log(e));
  } else {
    console.log("=== 无任何 JS 错误 ✓ ===");
  }

  // 截图留档
  await page.screenshot({ path: OUT + "\\phone_cover_mobile_check.png" });
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
