// _shot_savage_chip.cjs —— 验证 DJ 性格设置 modal 上能看到 7 个 humor chip（含新增「毒舌」）
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  // iPhone 13 Pro 视窗（辛老师截图视窗）
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:8791/';
  console.log('shooting at', BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.player', { timeout: 15000 });
  console.log('player loaded');

  await page.waitForSelector('button[aria-label="DJ 性格设置"]', { timeout: 10000 });
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="DJ 性格设置"]');
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('.settings-overlay', { timeout: 5000 });
  await page.waitForTimeout(700);

  const chips = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.humor-chip')).map((el) => ({
      label: el.innerText.trim(),
      active: el.classList.contains('active'),
      title: el.title,
    }));
  });
  console.log('humor chips count:', chips.length);
  chips.forEach((c, i) => console.log(`  [${i}]`, c));

  // 点击「毒舌」
  const savageChip = page.locator('.humor-chip', { hasText: '毒舌' });
  if (await savageChip.count() === 0) {
    console.error('NO SAVAGE CHIP FOUND');
    await page.screenshot({ path: 'D:\\Workspace\\AI工作空间仓库\\ai-radio\\shots\\_savage_chip_visible.png' });
    process.exit(1);
  }
  await savageChip.click({ force: true });
  await page.waitForTimeout(500);

  const savageActive = await savageChip.evaluate((el) => el.classList.contains('active'));
  console.log('savage chip active:', savageActive);

  await page.screenshot({
    path: 'D:\\Workspace\\AI工作空间仓库\\ai-radio\\shots\\_savage_chip_visible.png',
  });
  console.log('shot saved: _savage_chip_visible.png');

  // 截一张只看到 chip 区域的局部
  const chipRow = page.locator('.modal-humors').first();
  if (await chipRow.count() > 0) {
    await chipRow.screenshot({
      path: 'D:\\Workspace\\AI工作空间仓库\\ai-radio\\shots\\_savage_chip_row.png',
    });
    console.log('shot saved: _savage_chip_row.png');
  }

  await browser.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
