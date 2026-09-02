// 强制 cover-placeholder 渲染，对比辛老师截图
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launchPersistentContext(
    'C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\edge-profile-current',
    {
      headless: true,
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\152.0.4191.53\\msedge.exe',
      viewport: { width: 380, height: 700 },
      deviceScaleFactor: 2,
    }
  );
  const page = browser.pages()[0] || (await browser.newPage());

  await page.goto('http://localhost:8787/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate(() => {
    localStorage.setItem('ai-radio-wallpaper', 'glass');
  });
  await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const start = btns.find(b => b.textContent && /开始电台|Start|启动|进入/i.test(b.textContent));
    if (start) start.click();
  });
  await page.waitForTimeout(1500);
  // 强制 cover-wrapper 显示 placeholder（移除真实图、添加 placeholder 子元素）
  await page.evaluate(() => {
    const wrapper = document.querySelector('.cover-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '<div class="cover-placeholder" style="width:100%;height:100%;display:grid;place-items:center;color:rgba(255,255,255,0.85);font-size:48px;">♪</div>';
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_current-glass-placeholder-forced.png', fullPage: false, clip: { x: 0, y: 0, width: 760, height: 600 } });
  console.log('OK');
  await browser.close();
})();