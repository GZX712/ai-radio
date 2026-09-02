/**
 * 验证 WallpaperPicker 滚动条：截 viewport 让滚动条可见
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "round3-shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const URL = process.env.SHOT_URL || "http://127.0.0.1:8790/";

(async () => {
  const browser = await chromium.launchPersistentContext("", {
    channel: "msedge",
    headless: true,
    viewport: { width: 414, height: 720 }, // 移动视口 + 较低高度，让 grid 溢出
    deviceScaleFactor: 2,
  });
  const page = await browser.pages()[0] || await browser.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".app", { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = document.querySelector(".start-overlay");
    if (s) s.style.display = "none";
  });

  // 打开壁纸选择器
  await page.locator(".wallpaper-btn").click();
  await page.waitForSelector(".wallpaper-picker", { timeout: 5000 });
  await page.waitForTimeout(500);

  // 整 viewport 截图 —— 应该能看到模态框的滚动条
  const v1 = path.join(OUT_DIR, "10-viewport-picker-default.png");
  await page.screenshot({ path: v1, fullPage: false });
  console.log("  saved", v1);

  // 再点 custom 让设计器展开 → 内容更长 → 必现滚动
  await page.locator(".wallpaper-card[data-wallpaper='custom']").click();
  await page.waitForTimeout(500);
  const v2 = path.join(OUT_DIR, "11-viewport-picker-custom.png");
  await page.screenshot({ path: v2, fullPage: false });
  console.log("  saved", v2);

  // 向下滚动 wallpaper-picker-body 看下半部分（色轮设计器）
  await page.evaluate(() => {
    const body = document.querySelector(".wallpaper-picker-body");
    if (body) body.scrollTo({ top: 200, behavior: "instant" });
  });
  await page.waitForTimeout(400);
  const v3 = path.join(OUT_DIR, "12-viewport-picker-scrolled.png");
  await page.screenshot({ path: v3, fullPage: false });
  console.log("  saved", v3);

  // 强烈一点的滚动，证明真的有滚动
  await page.evaluate(() => {
    const body = document.querySelector(".wallpaper-picker-body");
    if (body) body.scrollTo({ top: 1000, behavior: "instant" });
  });
  await page.waitForTimeout(400);
  const v4 = path.join(OUT_DIR, "13-viewport-picker-scrolled-max.png");
  await page.screenshot({ path: v4, fullPage: false });
  console.log("  saved", v4);

  await browser.close();
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
