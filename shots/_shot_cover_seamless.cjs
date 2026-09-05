// _shot_cover_seamless.cjs —— 验证封面"反转后无缝连接"
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  page.on('console', m => console.log('[browser]', m.type(), m.text()));

  // 设好 music cookie 让网易云能正常播放
  await ctx.addCookies([{
    name: 'MUSIC_U', value: '3ebaa4d6c2f51cf14d2d7bbcf90c1c10b5fb3d36cb41adb5101a01343b9c95b801a9d9ebd6c1ea4b8b8db4a5d5c8d0d4ab5fb09e5dd25f2b79de7af0857f0fee8e7e2fb4c2cc5fe',
    domain: '127.0.0.1', path: '/',
  }]);

  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 等播放器
  await page.waitForSelector('.player', { timeout: 15000 });
  console.log('player loaded');

  // 等 PixelCover 出现（歌曲加载完才会有）
  await page.waitForSelector('.pixel-grid', { timeout: 30000 });
  console.log('pixel-grid appeared');

  // 等图片 crossOrigin load + 12x12 切色算完
  await page.waitForFunction(
    () => document.querySelectorAll('.pixel-cell .face-back').length === 144 &&
          Array.from(document.querySelectorAll('.pixel-cell .face-back'))
            .every(c => c.style.background && c.style.background !== 'rgb(10, 10, 15)'),
    { timeout: 30000 }
  ).catch(() => console.log('waitFunction timeout, may still be loading'));
  await page.waitForTimeout(1200);

  // 点掉"点击开始"的蒙层
  const overlay = page.locator('.start-overlay');
  if (await overlay.count() > 0) {
    await overlay.click({ position: { x: 100, y: 100 }, force: true });
    await page.waitForTimeout(800);
    console.log('start-overlay clicked');
  }

  // 等蒙层消失
  await page.waitForSelector('.start-overlay', { state: 'hidden', timeout: 5000 })
    .catch(() => console.log('overlay may already be gone'));

  // 全翻正（点击 PixelCover）
  await page.locator('.pixel-grid').click({ position: { x: 50, y: 50 }, force: true });
  await page.waitForTimeout(900);

  const revealedCount = await page.locator('.pixel-cell.revealed').count();
  console.log('revealed count:', revealedCount);

  const cover = page.locator('.cover-wrapper').first();
  await cover.screenshot({ path: 'shots/_cover_seamless.png', omitBackground: false });
  console.log('saved: shots/_cover_seamless.png');

  await page.screenshot({ path: 'shots/_page_seamless.png', fullPage: false });
  console.log('saved: shots/_page_seamless.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
