// 封面 v3 桌面 canvas「像素显影」验证 v2 —— 用格内方差判断"马赛克 vs 原图切片"
// 原理：马赛克态格子是整格同色(方差≈0)；显影后格子显示原图局部(方差>0，因有细节)
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const URL = "http://127.0.0.1:8899/";
const path = require("node:path");
const OUT = path.join(__dirname, "..", "shots", "cover_v3");

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const pageErrors = [];
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".cover-wrapper .pixel-canvas", { timeout: 10000 });
  await page.waitForTimeout(2500);

  // guest（无 bond）会先看到「开始电台」引导层 —— 必须点掉它才能跟封面交互
  if (await page.locator(".start-overlay").count()) {
    await page.locator(".start-btn").first().click();
    await page.waitForTimeout(800);
  }
  const cw = page.locator(".cover-wrapper");
  const box = await cw.boundingBox();

  // 返回每个格子(远离圆点的 4 角采样)的方差总和 的矩阵
  const cellStats = () =>
    page.evaluate(() => {
      const cvs = document.querySelector(".pixel-canvas");
      const ctx = cvs.getContext("2d");
      const W = cvs.width, H = cvs.height;
      const cw = W / 12, ch = H / 12;
      const out = { high: 0, avgVar: 0, cells: [] };
      let total = 0;
      for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 12; c++) {
          // 每格采样 4 个角点(避开中心圆点)
          const pts = [
            [0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78],
          ].map(([fx, fy]) => {
            const x = Math.floor(c * cw + fx * cw);
            const y = Math.floor(r * ch + fy * ch);
            const d = ctx.getImageData(x, y, 1, 1).data;
            return [d[0], d[1], d[2]];
          });
          // 4 点 RGB 方差均值
          const mean = [0, 0, 0];
          pts.forEach((p) => { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; });
          mean[0] /= 4; mean[1] /= 4; mean[2] /= 4;
          let v = 0;
          pts.forEach((p) => {
            v += Math.abs(p[0] - mean[0]) + Math.abs(p[1] - mean[1]) + Math.abs(p[2] - mean[2]);
          });
          v = Math.round(v);
          out.cells.push(v);
          if (v > 24) out.high++;
          total += v;
        }
      }
      out.avgVar = Math.round(total / 144);
      return out;
    });

  const s0 = await cellStats(); // mosaic 初始：大多数格子方差小（同色）
  console.log("[mosaic] high=" + s0.high + " avgVar=" + s0.avgVar);
  await page.screenshot({ path: `${OUT}_1_desktop_mosaic.png` });

  // hover 中心一小片
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(700);
  const s1 = await cellStats();
  console.log("[hover]  high=" + s1.high + " avgVar=" + s1.avgVar);
  await page.screenshot({ path: `${OUT}_2_desktop_hover.png` });

  // 沿封面扫一圈（把大部分格显影）
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    await page.mouse.move(box.x + box.width * t, box.y + box.height * 0.5, { steps: 4 });
    await page.waitForTimeout(40);
  }
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * t, { steps: 4 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(600);
  const s2 = await cellStats();
  console.log("[扫过]  high=" + s2.high + " avgVar=" + s2.avgVar);

  // click 全显
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  const s3 = await cellStats();
  console.log("[click]  high=" + s3.high + " avgVar=" + s3.avgVar);
  await page.screenshot({ path: `${OUT}_3_desktop_full.png` });

  const summary = {
    mosaic_lowVar: s0.high < 30,                 // 初始绝大多数格还是同色块
    hover_created_highVar: s1.high > s0.high + 3, // hover 让中心格出现原图细节
    sweep_highVar: s2.high > 60,                  // 扫过后大多数格子已显影
    click_allHighVar: s3.high > 110,              // 点击后近全格显影
    pageErrors,
  };
  console.log("\n=== 汇总 ===\n" + JSON.stringify(summary, null, 2));
  await browser.close();
  const ok = summary.mosaic_lowVar && summary.hover_created_highVar && summary.sweep_highVar && summary.click_allHighVar && pageErrors.length === 0;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
