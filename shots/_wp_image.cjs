// 截图：wallpaper picker modal 自定义图片版
const { chromium } = require('playwright-core');
const path = require('path');

const URL = 'http://localhost:8787/';
const OUT = process.argv[2] || 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_wp_image.png';

(async () => {
  const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 点"开始电台"按钮（跳过引导层）
  const startBtn = page.getByText('开始电台', { exact: false }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(800);
  }

  // 点 header 上的"壁纸"按钮
  await page.locator('.wallpaper-btn').first().click();
  await page.waitForTimeout(800);

  await page.screenshot({ path: OUT, fullPage: false });
  console.log('saved', OUT);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });