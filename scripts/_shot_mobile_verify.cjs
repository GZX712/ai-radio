// 手机端 UI 快照：确认静态首屏 splash 已撤、引导层与播放器正常
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:8787';
const OUT = 'D:/Workspace/AI工作空间仓库/ai-radio/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

(async () => {
  const browser = await PW.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const splashEarly = await page.evaluate(() => !!document.getElementById('boot-splash'));
  await page.screenshot({ path: `${OUT}/_mob_1_boot.png` });
  console.log('初始是否还有 splash（应为 true，随后被 App 撤掉）:', splashEarly);

  await page.waitForSelector('.start-btn', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    splash: !!document.getElementById('boot-splash'),
    overlay: !!document.querySelector('.start-overlay'),
    title: (document.querySelector('.start-title') || {}).textContent || null,
    sub: (document.querySelector('.start-sub') || {}).textContent || null,
  }));
  console.log('引导层状态:', JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/_mob_2_overlay.png` });

  // 点开始电台 → 进入播放器
  await page.click('.start-btn').catch(() => {});
  await sleep(9000);
  await page.screenshot({ path: `${OUT}/_mob_3_player.png` });
  const player = await page.evaluate(() => ({
    cover: (() => { const i = document.querySelector('img.full-cover'); return i ? { w: i.naturalWidth, h: i.naturalHeight, complete: i.complete, q: i.currentSrc.includes('imageMogr2') } : null; })(),
    name: (document.querySelector('.player .name, .name') || {}).textContent || null,
    overlayGone: !document.querySelector('.start-overlay'),
    splashGone: !document.getElementById('boot-splash'),
  }));
  console.log('播放器状态:', JSON.stringify(player));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
