// 验证：mousemove hover 封面时 setState 频率大幅降低
const { chromium } = require('C:/Users/hxaka/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.start-overlay').catch(() => {});
  await page.evaluate(() => document.querySelector('.start-overlay')?.click());
  await page.waitForSelector('.pixel-grid', { timeout: 8000 });
  await page.waitForTimeout(800);

  // 等图片加载完成（pixelColors 非空）
  await page.waitForFunction(() => {
    const back = document.querySelector('.pixel-cell .face-back');
    return back && back.style.background && back.style.background !== 'rgb(10, 10, 15)';
  }, { timeout: 8000 }).catch(() => {});

  // 点击一次 reveal 全部
  await page.locator('.pixel-grid').click({ position: { x: 100, y: 100 }, force: true });
  await page.waitForTimeout(800);

  // 注入：监听 React 渲染频率（用 PerformanceObserver 看 commit 事件）
  await page.evaluate(() => {
    window.__paintCount = 0;
    window.__paintTotalMs = 0;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__paintCount++;
        window.__paintTotalMs += e.duration || 0;
      }
    });
    try { obs.observe({ type: 'paint', buffered: false }); } catch {}
    window.__startTime = performance.now();
  });

  // 模拟 hover：在 cover 上来回 sweep 鼠标（覆盖 28 个 cell 区域）
  const cover = await page.locator('.pixel-grid');
  const box = await cover.boundingBox();
  if (!box) throw new Error('cover not found');
  for (let i = 0; i < 50; i++) {
    const x = box.x + 20 + (i * 11) % (box.width - 40);
    const y = box.y + 20 + (i * 7) % (box.height - 40);
    await page.mouse.move(x, y, { steps: 4 });
    await page.waitForTimeout(8);
  }

  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => {
    const end = performance.now();
    const sec = (end - window.__startTime) / 1000;
    return {
      durationMs: Math.round(end - window.__startTime),
      paints: window.__paintCount,
      paintsPerSec: (window.__paintCount / sec).toFixed(1),
      // 看 cell 的 revealed className 数量是否稳态
      revealedCount: document.querySelectorAll('.pixel-cell .pixel-flipper.revealed').length,
    };
  });
  console.log('STATS:', JSON.stringify(stats, null, 2));

  // 截图封面（应当是完整无缝的）
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_cover_no_flicker.png' });

  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
