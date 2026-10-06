/* 配色候选 mockup 截图：对 _palette_mock.html 的 v=a/b/c/d 各拍一张手机尺寸图 */
const path = require("path");
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";
const SHOTS = path.resolve(__dirname, "..", "shots");

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const v of ["a", "b", "c", "d"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 760 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(`file:///${SHOTS.replace(/\\/g, "/")}/_palette_mock.html?v=${v}`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SHOTS, `palette_${v}.png`) });
    console.log(`palette_${v}.png ✓`);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
