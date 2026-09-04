// 截：点击自定义图片卡 → 展开 uploader 后的状态
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8787/';
const OUT = process.argv[2] || 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_wp_uploader.png';

(async () => {
  const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 1100 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 跳引导
  const startBtn = page.getByText('开始电台', { exact: false }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(800);
  }

  // 开 picker
  await page.locator('.wallpaper-btn').first().click();
  await page.waitForTimeout(500);

  // 点"自定义壁纸"卡片
  await page.locator('.wallpaper-card-image').click();
  await page.waitForTimeout(600);

  // 滚到底确保 uploader 在视口
  await page.locator('.wallpaper-picker-body').evaluate(el => el.scrollTop = el.scrollHeight).catch(()=>{});
  await page.waitForTimeout(300);

  await page.screenshot({ path: OUT, fullPage: false });
  console.log('saved', OUT);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });