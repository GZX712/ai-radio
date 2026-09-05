// 截图：桌面 1280x720 + 手机 390x844 各 2 态 = 4 张
const { chromium } = require("playwright-core");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:8787/";
const OUT = "D:/Workspace/AI工作空间仓库/ai-radio/shots";

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/HRoPgAAAAABJRU5ErkJggg==";

async function startAndShot(name, viewport, withImage = false) {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });

  if (withImage) {
    // 直接设置 localStorage 模拟"已上传"（迁移逻辑会自动把旧 key 转过来）
    await page.evaluate(({ tiny }) => {
      localStorage.clear();
      // 用旧 ai-radio-custom-image 触发迁移逻辑
      localStorage.setItem("ai-radio-custom-image", `data:image/png;base64,${tiny}`);
    }, { tiny: TINY_PNG });
  } else {
    await page.evaluate(() => localStorage.clear());
  }

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // 点开始按钮（先尝试 start-overlay 内的按钮，再用文本兜底）
  await page.evaluate(() => {
    const btn = document.querySelector(".start-overlay button") ||
      Array.from(document.querySelectorAll("button")).find(b => /开始/.test(b.textContent || ""));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  await browser.close();
}

(async() => {
  await startAndShot("_bg_desktop_empty.png", { width: 1280, height: 720 }, false);
  console.log("DONE 1");
  await startAndShot("_bg_mobile_empty.png", { width: 390, height: 844 }, false);
  console.log("DONE 2");
  await startAndShot("_bg_desktop_with.png", { width: 1280, height: 720 }, true);
  console.log("DONE 3");
  await startAndShot("_bg_mobile_with.png", { width: 390, height: 844 }, true);
  console.log("DONE ALL");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });