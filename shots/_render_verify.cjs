// 截图验证 Render 部署后的 UI
const { chromium } = require('playwright-core');
const path = require('path');

const URL = process.argv[2] || 'https://ai-radio-server.onrender.com/';
const OUT = process.argv[3] || 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_render_verify.png';

(async () => {
  // Edge 浏览器路径（沙箱环境里没 chromium）
  const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();
  console.log('GET', URL);
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('status', resp.status());
  await page.waitForTimeout(4000); // 让 React 渲染 + ws 连接
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('saved', OUT);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });