/**
 * 验证三处改动：
 * 1) DJ 头像点击直接打开设置弹窗（新的 UI）
 * 2) DJ 设置弹窗跟随当前壁纸底色（pulse/cream/pop 三种）
 * 3) WallpaperPicker 加纵向滚动条
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "round3-shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const URL = process.env.SHOT_URL || "http://127.0.0.1:8790/";

async function settle(page, ms = 400) { await page.waitForTimeout(ms); }

(async () => {
  const browser = await chromium.launchPersistentContext("", {
    channel: "msedge",
    headless: true,
    viewport: { width: 414, height: 820 }, // 模拟 iPhone 宽度
    deviceScaleFactor: 2,
  });
  const page = await browser.pages()[0] || await browser.newPage();
  await page.addInitScript(() => {
    // 屏蔽开始电台引导层
    window.__forceStarted = true;
  });

  console.log(">> goto", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".app", { timeout: 10000 });
  await settle(page, 600);

  // 强制跳过 start overlay
  await page.evaluate(() => {
    const startOverlay = document.querySelector(".start-overlay");
    if (startOverlay) startOverlay.style.display = "none";
  });

  // ===== 截图 1：当前 chat header（DJ 头像按钮 + 用户头像，无 ⚙️）=====
  const headerShot = path.join(OUT_DIR, "01-chat-header.png");
  await page.locator(".chat-header").screenshot({ path: headerShot });
  console.log("  saved", headerShot);

  // ===== 截图 2：DJ 头像点击 → 打开设置 (默认 pulse 暗色) =====
  await page.locator(".chat-dj-avatar-btn").click();
  await page.waitForSelector(".settings-card", { timeout: 5000 });
  await settle(page, 400);
  const sPulse = path.join(OUT_DIR, "02-settings-pulse.png");
  await page.locator(".modal-card.settings-card").screenshot({ path: sPulse });
  console.log("  saved", sPulse);

  // 关闭
  await page.locator(".modal-close").click();
  await settle(page, 300);

  // ===== 截图 3：切换到 cream 壁纸，再打开设置 =====
  // 打开壁纸选择器
  await page.locator(".wallpaper-btn").click();
  await page.waitForSelector(".wallpaper-picker", { timeout: 5000 });
  await settle(page, 400);
  // 点 cream 卡（第二行第二列：index 2）
  await page.locator(".wallpaper-card[data-wallpaper='cream']").click();
  await settle(page, 400);
  // 关闭 wallpaper picker
  await page.locator(".wallpaper-picker .modal-close").click();
  await settle(page, 400);

  // 打开 DJ 设置
  await page.locator(".chat-dj-avatar-btn").click();
  await page.waitForSelector(".settings-card", { timeout: 5000 });
  await settle(page, 400);
  const sCream = path.join(OUT_DIR, "03-settings-cream.png");
  await page.locator(".modal-card.settings-card").screenshot({ path: sCream });
  console.log("  saved", sCream);
  await page.locator(".modal-close").click();
  await settle(page, 300);

  // ===== 截图 4：切换到 pop 壁纸，再打开设置 =====
  await page.locator(".wallpaper-btn").click();
  await page.waitForSelector(".wallpaper-picker", { timeout: 5000 });
  await settle(page, 400);
  await page.locator(".wallpaper-card[data-wallpaper='pop']").click();
  await settle(page, 400);
  await page.locator(".wallpaper-picker .modal-close").click();
  await settle(page, 400);

  await page.locator(".chat-dj-avatar-btn").click();
  await page.waitForSelector(".settings-card", { timeout: 5000 });
  await settle(page, 400);
  const sPop = path.join(OUT_DIR, "04-settings-pop.png");
  await page.locator(".modal-card.settings-card").screenshot({ path: sPop });
  console.log("  saved", sPop);
  await page.locator(".modal-close").click();
  await settle(page, 300);

  // ===== 截图 5：切回 pulse，回到 WallpaperPicker 看滚动条 =====
  await page.locator(".wallpaper-btn").click();
  await page.waitForSelector(".wallpaper-picker", { timeout: 5000 });
  await settle(page, 500);
  // 把视口缩窄到 360 让 grid 溢出来，看滚动条
  await page.setViewportSize({ width: 360, height: 720 });
  await settle(page, 400);

  // 截整张 picker
  const wPick = path.join(OUT_DIR, "05-wallpaper-picker.png");
  await page.locator(".wallpaper-picker").screenshot({ path: wPick });
  console.log("  saved", wPick);

  // 额外：截 picker 内部滚动容器（带滚动条）
  const wBody = path.join(OUT_DIR, "06-picker-body-with-scrollbar.png");
  await page.locator(".wallpaper-picker-body").screenshot({ path: wBody });
  console.log("  saved", wBody);

  // 点击 custom 卡片，让 grid 后面展开设计器，更长
  await page.locator(".wallpaper-card[data-wallpaper='custom']").click();
  await settle(page, 500);
  const wCustom = path.join(OUT_DIR, "07-picker-custom-scrollable.png");
  await page.locator(".wallpaper-picker").screenshot({ path: wCustom });
  console.log("  saved", wCustom);

  // ===== 截图 8：自定义模式下打开设置验证 7 token 派生 =====
  await page.locator(".wallpaper-picker .modal-close").click();
  await settle(page, 300);
  await page.setViewportSize({ width: 414, height: 820 });
  await settle(page, 300);
  // 先点上一个预设 demo 数据（用"暖橙"色板，3 个 token 全亮，验证 modal 跟着变）
  await page.locator(".wallpaper-btn").click();
  await page.waitForSelector(".wallpaper-picker", { timeout: 5000 });
  await page.locator(".designer-swatch").nth(5).click(); // 暖橙
  await settle(page, 400);
  await page.locator(".wallpaper-picker .modal-close").click();
  await settle(page, 300);

  await page.locator(".chat-dj-avatar-btn").click();
  await page.waitForSelector(".settings-card[data-wallpaper='custom']", { timeout: 5000 });
  await settle(page, 400);
  const sCustom = path.join(OUT_DIR, "08-settings-custom.png");
  await page.locator(".modal-card.settings-card").screenshot({ path: sCustom });
  console.log("  saved", sCustom);

  // ===== 截图 9：完整 chat panel + DJ 设置弹窗（参考第二张图原貌） =====
  await page.locator(".modal-close").click();
  await settle(page, 300);
  const panelFull = path.join(OUT_DIR, "09-chat-panel-full.png");
  await page.locator(".chat-panel").screenshot({ path: panelFull });
  console.log("  saved", panelFull);

  await browser.close();
  console.log(">> DONE. Output:", OUT_DIR);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
