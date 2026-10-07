/* 验证：① cream 主题 + 真实古风图 playerBg 的 scrim/气泡效果 ② 拖进度条 20 次抓崩溃 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";
const SHOTS = path.resolve(__dirname, "..", "shots");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const WP = "C:\\Users\\hxaka\\xwechat_files\\wxid_06e5fphl2ika22_d0f7\\temp\\RWTemp\\2026-10\\9e20f478899dc29eb19741386f9343c8\\08ed4da2dd1cc0ea26cdc0245f356e97.jpg";

(async () => {
  const dataUrl = "data:image/jpeg;base64," + fs.readFileSync(WP).toString("base64");
  console.log("wallpaper bytes:", fs.statSync(WP).size);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 200));
  });

  // 预置：cream 主题 + 辛老师真实古风图 playerBg
  await page.addInitScript((wp) => {
    localStorage.setItem("ai-radio-wallpaper", "cream");
    localStorage.setItem("ai-radio-player-bg", wp);
  }, dataUrl);

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const startBtn = page.locator("text=开始电台").first();
  if (await startBtn.count()) {
    await startBtn.click().catch(() => {});
    await page.waitForTimeout(4000);
  }

  // ① 截图：scrim + 气泡效果（先造一条 DJ 气泡）
  try {
    const input = page.locator(".chat-input");
    await input.waitFor({ state: "visible", timeout: 10000 });
    await input.fill("测试一下可读性");
    await page.locator(".chat-send").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".chat-msg.dj").length >= 1,
      { timeout: 60000 }
    );
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log("chat warmup skipped:", e.message.slice(0, 80));
  }
  await page.screenshot({ path: path.join(SHOTS, "_scrim_cream_fixed.png") });
  console.log("scrim shot saved");

  // ② 拖进度条 20 次（模拟手指横拖），抓崩溃
  const bar = page.locator(".progress-bar");
  await bar.waitFor({ state: "visible", timeout: 10000 });
  const box = await bar.boundingBox();
  console.log("progress bar at", JSON.stringify(box));
  for (let i = 0; i < 20; i++) {
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 5, y);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) {
      await page.mouse.move(box.x + (box.width - 10) * (s / 8), y, { steps: 2 });
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
    // 页面黑屏检测：root 是否还有内容渲染
    const visible = await page.evaluate(() => {
      const el = document.querySelector(".player");
      if (!el) return "PLAYER_GONE";
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? "ok" : "ZERO_SIZE";
    });
    if (visible !== "ok") {
      console.log(`drag #${i + 1}: ${visible} ← 页面异常!`);
      break;
    }
  }
  console.log("20 drags done");
  await page.screenshot({ path: path.join(SHOTS, "_after_20_drags.png") });

  console.log("=== errors ===");
  console.log(errors.length ? errors.join("\n") : "(none)");
  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
