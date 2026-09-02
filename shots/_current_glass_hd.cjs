// 截当前 glass 主题完整高清图（含 cover-placeholder + 真实播放态）
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launchPersistentContext(
    'C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\edge-profile-current',
    {
      headless: true,
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\152.0.4191.53\\msedge.exe',
      viewport: { width: 380, height: 720 },
      deviceScaleFactor: 3,  // 3x 高清
    }
  );
  const page = browser.pages()[0] || (await browser.newPage());

  // ===== 状态 1: 真实播放态（有真实封面图） =====
  await page.goto('http://localhost:8787/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate(() => {
    localStorage.setItem('ai-radio-wallpaper', 'glass');
    localStorage.setItem('ai-radio-test-messages', JSON.stringify([
      { id: 1, role: 'user', kind: 'reply', en: '来首周杰伦试试', zh: '', time: '15:03' },
      { id: 2, role: 'dj', kind: 'reply', en: '今晚第 3 首, Ed Sheeran 的 Shape of You ~', zh: '一首经典流行，前奏响起你应该会跟着哼～', time: '15:03' },
    ]));
  });
  await page.goto('http://localhost:8787/?testMsgs=1&testThinking=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const start = btns.find(b => b.textContent && /开始电台|Start|启动|进入/i.test(b.textContent));
    if (start) start.click();
  });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_glass-hd-real.png', fullPage: true });

  // ===== 状态 2: cover-placeholder 态（让 CSS ::before 注入音符） =====
  await page.evaluate(() => {
    const wrapper = document.querySelector('.cover-wrapper');
    if (wrapper) wrapper.innerHTML = '<div class="cover-placeholder"></div>';
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_glass-hd-placeholder.png', fullPage: true });

  console.log('OK');
  await browser.close();
})();