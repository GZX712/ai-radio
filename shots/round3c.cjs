/**
 * 测试 6 预设壁纸 grid 在窄视口能看见滚动条
 * 把 viewport 缩到 iPhone 13 mini + portrait，让 grid 必溢出
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "round3-shots");
fs.mkdirSync(OUT_DIR, { recursive: true });
const URL = "http://127.0.0.1:8790/";

(async () => {
  // 极窄视口高度（接近手机安全区）
  const ctx = await chromium.launchPersistentContext("", {
    channel: "msedge",
    headless: true,
    viewport: { width: 380, height: 600 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.pages()[0] || await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app");
  await page.waitForTimeout(500);
  await page.evaluate(() => { const s = document.querySelector(".start-overlay"); if (s) s.style.display="none"; });

  await page.locator(".wallpaper-btn").click();
  await page.waitForSelector(".wallpaper-picker");
  await page.waitForTimeout(400);

  // 强制 overflow 检测
  const dim1 = await page.evaluate(() => {
    const body = document.querySelector(".wallpaper-picker-body");
    return {
      hasScroll: body?.scrollHeight > body?.clientHeight,
      scrollH: body?.scrollHeight,
      clientH: body?.clientHeight,
      pickerH: document.querySelector(".wallpaper-picker")?.offsetHeight,
    };
  });
  console.log("Picker body dim:", dim1);

  await page.screenshot({ path: path.join(OUT_DIR, "14-narrow-picker-top.png") });

  // 滚动 300px 看是否生效
  await page.evaluate(() => {
    document.querySelector(".wallpaper-picker-body").scrollTo({ top: 300 });
  });
  await page.waitForTimeout(300);
  const dim2 = await page.evaluate(() => {
    const body = document.querySelector(".wallpaper-picker-body");
    return { scrollTop: body?.scrollTop, scrollH: body?.scrollHeight };
  });
  console.log("After scroll:", dim2);
  await page.screenshot({ path: path.join(OUT_DIR, "15-narrow-picker-scrolled.png") });

  // 切到 custom，让设计器展开（更长内容）
  await page.locator(".wallpaper-card[data-wallpaper='custom']").click();
  await page.waitForTimeout(400);
  const dim3 = await page.evaluate(() => {
    const body = document.querySelector(".wallpaper-picker-body");
    return { hasScroll: body?.scrollHeight > body?.clientHeight, scrollH: body?.scrollHeight, clientH: body?.clientHeight };
  });
  console.log("Custom dim:", dim3);
  await page.screenshot({ path: path.join(OUT_DIR, "16-narrow-picker-custom.png") });

  await page.evaluate(() => {
    document.querySelector(".wallpaper-picker-body").scrollTo({ top: 600 });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, "17-narrow-picker-custom-scrolled.png") });

  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
