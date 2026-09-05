// _shot_laugh_e2e.cjs —— 端到端验证罐头笑声触发
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[dj queue]') || t.startsWith('[laugh]')) {
      console.log('[browser]', m.type(), t);
    }
  });

  await page.addInitScript(() => {
    window.__playedAudios = [];
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      try { window.__playedAudios.push({ src: this.currentSrc || this.src, t: Date.now() }); } catch {}
      return origPlay.apply(this, arguments);
    };
  });

  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.player', { timeout: 15000 });
  await page.waitForTimeout(800);

  // 1. 点"开始电台"消除 start overlay（如果存在）
  const startBtn = page.locator('button', { hasText: '开始电台' });
  if (await startBtn.count() > 0) {
    await startBtn.first().click({ force: true });
    await page.waitForTimeout(800);
    console.log('clicked start');
  }

  // 2. 打开 DJ 设置 → 选毒舌 → 保存
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="DJ 性格设置"]');
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('.settings-overlay', { timeout: 5000 });
  await page.waitForTimeout(400);
  const savage = page.locator('.humor-chip', { hasText: '毒舌' });
  if (await savage.count() === 0) { console.error('NO savage chip'); await browser.close(); process.exit(1); }
  await savage.click({ force: true });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.settings-overlay button');
    for (const b of btns) { if (b.textContent?.includes('保存')) { b.click(); return; } }
  });
  await page.waitForTimeout(800);
  console.log('savage saved');

  // 3. 发拌嘴消息
  const input = page.locator('input.chat-input');
  await input.fill('你推荐的歌也太难听了吧？你是不是没有品味啊');
  await input.press('Enter');
  console.log('sent message');

  // 4. 等 chat-reply 出现（带"播放这段回复"按钮）
  await page.waitForSelector('button[aria-label="播放这段回复"]', { timeout: 30000 });
  console.log('chat-reply appeared');

  // 5. 点 ▶ 播放
  const playBtn = page.locator('button[aria-label="播放这段回复"]').first();
  await playBtn.click({ force: true });
  console.log('clicked play on dj reply');

  // 6. 等 6 秒收集播放记录（DJ 语音 3-4s + 罐头笑 2-3s + 余量）
  await page.waitForTimeout(8000);
  const played = await page.evaluate(() => window.__playedAudios || []);
  console.log('\n--- played audio list ---');
  played.forEach((p, i) => console.log(`[${i}]`, p.src.split('/').pop(), new Date(p.t).toLocaleTimeString()));

  const laughHits = played.filter((p) => p.src && p.src.includes('/laughs/'));
  console.log('\nlaugh track plays:', laughHits.length);
  if (laughHits.length > 0) {
    console.log('✅ 罐头笑声被触发:', laughHits.map((p) => p.src).join(', '));
  } else {
    console.log('❌ 未检测到罐头笑声播放');
  }

  await page.screenshot({ path: 'D:\\Workspace\\AI工作空间仓库\\ai-radio\\shots\\_laugh_e2e.png', fullPage: false });
  console.log('shot: shots/_laugh_e2e.png');

  await browser.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
