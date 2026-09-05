// _shot_cover_retina.cjs —— 在 Render 上用 retina deviceScaleFactor 截图
const { chromium, devices } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const ctx = await browser.newContext({
    ...devices['Desktop Safari'],
    deviceScaleFactor: 2,  // retina
  });
  const page = await ctx.newPage();

  page.on('console', m => console.log('[browser]', m.type(), m.text()));

  await ctx.addCookies([{
    name: 'MUSIC_U', value: '3ebaa4d6c2f51cf14d2d7bbcf90c1c10b5fb3d36cb41adb5101a01343b9c95b801a9d9ebd6c1ea4b8b8db4a5d5c8d0d4ab5fb09e5dd25f2b79de7af0857f0fee8e7e2fb4c2cc5fe',
    domain: '.onrender.com', path: '/',
  }]);

  await page.goto('https://ai-radio-server.onrender.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.player', { timeout: 30000 });
  await page.waitForSelector('.pixel-grid', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const overlay = page.locator('.start-overlay');
  if (await overlay.count() > 0) {
    await overlay.click({ position: { x: 100, y: 100 }, force: true });
    await page.waitForTimeout(800);
  }

  await page.waitForFunction(
    () => document.querySelectorAll('.pixel-flipper .face-back, .pixel-cell .face-back').length === 144,
    { timeout: 30000 }
  ).catch(() => console.log('waitFunction timeout'));

  await page.waitForTimeout(1200);

  // 全翻正
  await page.locator('.pixel-grid').click({ position: { x: 50, y: 50 }, force: true });
  await page.waitForTimeout(900);

  const cover = page.locator('.cover-wrapper').first();
  await cover.screenshot({ path: 'shots/_cover_render_retina.png', omitBackground: false });
  console.log('saved shots/_cover_render_retina.png');

  // 验证 revealed 数量
  console.log('revealed count:', await page.locator('.pixel-flipper.revealed, .pixel-cell.revealed').count());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
