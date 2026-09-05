// 截图验证：🖼 自定义壁纸卡片现在是直接可点击选图（已上传时显示缩略图+ ✕）
const { chromium } = require("playwright-core");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:8787/";
const OUT = "D:/Workspace/AI工作空间仓库/ai-radio/shots";

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // 1) 默认状态（customImage=null）：先看 player 没有"添加背景"按钮，再开 picker 看自定义卡片"未上传"
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector(".app", { timeout: 10000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  // 跳过开始遮罩
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const btn = document.querySelector(".start-overlay button, [class*=start] button, button");
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "_player_default_no_bg_btn.png"), fullPage: false });

  // 2) 打开壁纸选择面板 → 看自定义壁纸卡片（未上传状态 + 占位）
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button"));
    const wallpaperBtn = all.find((b) => /壁纸|主题|theme|wallpaper/i.test(b.textContent || "") || /壁纸|主题|theme|wallpaper/i.test(b.getAttribute("aria-label") || ""));
    if (wallpaperBtn) wallpaperBtn.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "_picker_no_upload.png"), fullPage: false });

  // 3) 模拟上传图（通过 page.evaluate 直接写 localStorage 并刷新）
  //    步骤：先关 picker，注入 customImage，再开 picker
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await page.waitForTimeout(300);
  // 直接 set store 状态：通过 localStorage + 触发 React 重读（reload）
  await page.evaluate(() => {
    // 1x1 紫粉色 PNG（base64 硬编码，无字符编码问题）
    const fake = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNkYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==";
    // 用更大的 300x200 紫色 PNG（透明像素 + 中心标记）
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGGSURBVFhH7ZcxbsMwEETR+Q9paxI7dpzEpnDs2LFTw7GdWCRdiS21ZUmWZDtn/v95I8mW7Dhm4gM4OXkDeJx9ALwOvgF8vfkEeBx5BLwf+QJ4HHkAuB95AngceQC4H3kCeBx5ALgfeQJ4HHkAuB95AngceQC4H3kCeBx5ALgfeQJ4HHkAuB95AnjceAB4HLkDuB95ArgfeQK4H3kCuB95ArgfeQK4H3kCuB95ArgfeQK4H3kCuB95ArgfeQK4H3kCuB95ArgfeQK4H3kCuB95ArgfeQK4H3kCuB95ArgfeQK4H3kCuB95ArgfeQK4H3kC+L7xAPA4cgdwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBHA/8gRwP/IEcD/yBPA94wHgceQO4H7kCeB+5AngfuQJ4H7kCeB+5Anggc+CB/zPAz/dL2xhP/v/AAAAAElFTkSuQmCC";
    localStorage.setItem("ai-radio-custom-image", "data:image/png;base64," + PNG);
    localStorage.setItem("ai-radio-wallpaper", "image");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // 重新开始
  await page.evaluate(() => {
    const btn = document.querySelector(".start-overlay button, [class*=start] button, button");
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);

  // 4) 主界面：图已生效（背景）+ Player 卡片没有"添加背景"按钮
  await page.screenshot({ path: path.join(OUT, "_main_with_bg.png"), fullPage: false });

  // 5) 打开 picker 看自定义卡片（已上传状态 = 缩略图）
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button"));
    const wallpaperBtn = all.find((b) => /壁纸|主题|theme|wallpaper/i.test(b.textContent || "") || /壁纸|主题|theme|wallpaper/i.test(b.getAttribute("aria-label") || ""));
    if (wallpaperBtn) wallpaperBtn.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "_picker_with_upload.png"), fullPage: false });

  // 6) hover 自定义卡片 → ✕ 清除按钮显形
  const card = await page.locator(".wallpaper-card-image").first();
  await card.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "_picker_hover_clear.png"), fullPage: false });

  console.log("DONE");
  await browser.close();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});