// _shot_settings_modal_mobile_v2.cjs —— 强制触发 modal + 调试 containing block
const { chromium, devices } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ ...devices['iPhone 13 Pro'] });
  const page = await ctx.newPage();

  await ctx.addCookies([{
    name: 'MUSIC_U', value: '3ebaa4d6c2f51cf14d2d7bbcf90c1c10b5fb3d36cb41adb5101a01343b9c95b801a9d9ebd6c1ea4b8b8db4a5d5c8d0d4ab5fb09e5dd25f2b79de7af0857f0fee8e7e2fb4c2cc5fe',
    domain: '127.0.0.1', path: '/',
  }]);

  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.player', { timeout: 15000 });
  await page.waitForSelector('.pixel-grid', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const overlay = page.locator('.start-overlay');
  if (await overlay.count() > 0) {
    await overlay.click({ position: { x: 100, y: 100 }, force: true });
    await page.waitForTimeout(600);
  }

  const settingsBtn = page.locator('button[aria-label="DJ 性格设置"]').first();
  await settingsBtn.scrollIntoViewIfNeeded();
  const box = await settingsBtn.boundingBox();
  if (box) await page.mouse.click(box.x + box.width/2, box.y + box.height/2);

  await page.waitForSelector('.settings-overlay', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const ov = document.querySelector('.settings-overlay');
    const ovCs = ov ? getComputedStyle(ov) : null;
    let parent = ov?.parentElement;
    const chain = [];
    while (parent) {
      const cs = getComputedStyle(parent);
      chain.push({
        tag: parent.tagName.toLowerCase(),
        cls: parent.className.toString().slice(0, 60),
        pos: cs.position,
        transform: cs.transform,
        filter: cs.filter,
        backdropFilter: cs.backdropFilter,
        willChange: cs.willChange,
      });
      parent = parent.parentElement;
    }
    const ovBox = ov?.getBoundingClientRect();
    return {
      chain,
      ovBox,
      ovComputed: { width: ovCs?.width, height: ovCs?.height, top: ovCs?.top, left: ovCs?.left, position: ovCs?.position, inset: ovCs?.inset, transform: ovCs?.transform, animation: ovCs?.animation },
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
  console.log('OV box:', JSON.stringify(info.ovBox));
  console.log('OV computed:', JSON.stringify(info.ovComputed));
  console.log('viewport:', info.viewport.w, 'x', info.viewport.h);
  console.log('ancestor chain (from modal-overlay upward):');
  for (const p of info.chain) console.log('  ', p);

  await page.screenshot({ path: 'shots/_settings_modal_mobile.png', fullPage: false });
  console.log('saved shots/_settings_modal_mobile.png');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
