// 封面 v3（双端分离）e2e 验证：
// - 桌面：single-canvas 像素显影（初始马赛克 → 鼠标显影 → 点击全显），
//   断言 DOM 无 pixel-cell/flipper（不再有 144 3D 合成层）
// - 手机(coarse)：img.full-cover 整图，无 canvas
// - 全程监听 console error / pageerror
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const URL = "http://127.0.0.1:8791/";
const OUT = "/d/Workspace/AI工作空间仓库/ai-radio/shots/cover_v3";

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const results = {};

  // ============ 桌面端 ============
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const errors = [];
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text().slice(0, 200)); });
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForSelector(".cover-wrapper .pixel-canvas", { timeout: 10000 });
    await page.waitForTimeout(1200); // 等 SVG 解码 + 首帧 mosaic

    const snap = (name) => page.screenshot({ path: `${OUT}_${name}.png`, fullPage: false });
    await snap("desktop_initial");

    const cw = page.locator(".cover-wrapper");
    results.desktop_canvas = await cw.locator("canvas.pixel-canvas").count();
    results.desktop_noOldGrid = (await cw.locator(".pixel-cell, .pixel-flipper").count()) === 0;
    results.desktop_coarseOff = await page.evaluate(() => matchMedia("(pointer: coarse)").matches === false);

    // 读 canvas 数据（SVG data URL 同源 → 不 taint，可读）
    const read = () => page.evaluate(() => {
      const cvs = document.querySelector(".cover-wrapper canvas.pixel-canvas");
      if (!cvs) return "no-canvas";
      try { return cvs.toDataURL().slice(0, 40); } catch { return "tainted"; }
    });
    const before = await read();
    // 鼠标扫过中心区域（触发显影）
    const box = await cw.boundingBox();
    for (let i = 0; i < 12; i++) {
      const x = box.x + box.width * (0.25 + (i / 12) * 0.5);
      const y = box.y + box.height * 0.55;
      await page.mouse.move(x, y, { steps: 5 });
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(600);
    const afterHover = await read();
    results.desktop_hoverChanged = before !== afterHover;
    await snap("desktop_hover");
    // 点击全显影
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600);
    const afterClick = await read();
    results.desktop_clickChanged = afterHover !== afterClick || before !== afterClick;
    results.desktop_errors = errors;
    await snap("desktop_full");
    console.log("[desktop]", JSON.stringify(results, null, 2));
    await ctx.close();
  }

  // ============ 手机端（coarse） ============
  {
    const ctx = await browser.newContext({
      viewport: { width: 480, height: 900 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true,
    });
    const errors = [];
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    // guest → 弹开始页，点开始进电台
    if (await page.locator(".start-overlay").count()) {
      await page.locator(".start-btn").first().click();
    }
    await page.waitForSelector(".cover-wrapper", { timeout: 10000 });
    await page.waitForTimeout(800);
    const cw = page.locator(".cover-wrapper");
    results.mobile_fullImg = await cw.locator("img.full-cover").count();
    results.mobile_noCanvas = (await cw.locator("canvas.pixel-canvas").count()) === 0;
    results.mobile_noGrid = (await cw.locator(".pixel-cell, .pixel-flipper").count()) === 0;
    results.mobile_errors = errors;
    await page.screenshot({ path: `${OUT}_mobile_full.png`, fullPage: false });
    console.log("[mobile]", JSON.stringify(results, null, 2));
    await ctx.close();
  }

  const fail = Object.entries(results)
    .filter(([k, v]) => k.endsWith("Errors") ? v.length > 0 : v === false)
    .map(([k]) => k);
  console.log("\n=== 汇总 ===");
  console.log(fail.length === 0 ? "ALL PASS" : "FAIL: " + fail.join(", "));
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
