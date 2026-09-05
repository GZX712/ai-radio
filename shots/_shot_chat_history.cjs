// e2e 验证 chat 历史 / 头像 / 滚动条 / 3D 流式打字
const { chromium } = require('C:/Users/hxaka/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

(async () => {
  const fakeDjAvatar = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'>
       <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
         <stop offset='0' stop-color='#ff66b3'/><stop offset='1' stop-color='#00d4d4'/>
       </linearGradient></defs>
       <rect width='60' height='60' rx='30' fill='url(#g)'/>
       <text x='30' y='40' text-anchor='middle' font-size='32' fill='#0a0a0f' font-weight='800'>🐱</text>
     </svg>`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const page = await ctx.newPage();

  await page.addInitScript((avatar) => {
    try { localStorage.setItem('ai-radio-dj-avatar', avatar); } catch {}
  }, fakeDjAvatar);

  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.start-overlay', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    const o = document.querySelector('.start-overlay');
    if (o) o.click();
  });
  await page.waitForTimeout(800);

  // 截图 1：刚打开 app
  await page.screenshot({
    path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_chat_open.png',
    fullPage: false,
  });

  // 验证头部 avatar img
  const headerImg = await page.evaluate(() => {
    const img = document.querySelector('.header-avatar img');
    return img ? { w: getComputedStyle(img).width, h: getComputedStyle(img).height, br: getComputedStyle(img).borderRadius } : null;
  });
  console.log('HEADER IMG:', JSON.stringify(headerImg));

  // 直接发消息 —— 不点 settings 按钮
  // 等 chat 出现（默认 open 是 true，但 section 可能未渲染完）
  await page.waitForSelector('input.chat-input', { timeout: 8000 });

  // 先关闭可能打开的 modal
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach((o) => o.remove());
  });
  await page.waitForTimeout(200);

  // 第一条：问 DJ 有没有上下文记忆
  await page.locator('input.chat-input').first().fill('Hey DJ, do you know what I had for lunch today?');
  await page.locator('button.chat-send').first().click();
  await page.waitForTimeout(500);

  // 等 typing 出现（djThinking）
  await page.waitForFunction(() => !!document.querySelector('.chat-msg.dj.thinking'), { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_chat_thinking.png', fullPage: false });

  // 等 DJ reply 到达（最多 8s 给 LLM+TTS）
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.chat-msg.dj .chat-text')).some((el) => el.textContent && el.textContent.length > 5),
    { timeout: 12000 }
  ).catch(() => console.log('reply 1 wait timeout'));
  await page.waitForTimeout(1500);

  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_chat_reply_arrived.png', fullPage: false });

  // 第二条：续话题（测上下文）
  await page.locator('input.chat-input').first().fill('Actually I had pizza and sushi today.');
  await page.locator('button.chat-send').first().click();
  await page.waitForTimeout(4000); // 等 reply
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_chat_two_replies.png', fullPage: false });

  const msgCount = await page.locator('.chat-msg').count();
  console.log('CHAT MSG COUNT:', msgCount);

  // 检查 localStorage 持久化
  const persisted = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ai-radio-chat-history') || '[]'); }
    catch { return []; }
  });
  console.log('PERSISTED HISTORY COUNT:', persisted.length);
  if (persisted.length > 0) {
    console.log('PERSISTED FIRST ROLE/KIND:', persisted[0].role, '/', persisted[0].kind);
    console.log('PERSISTED LAST ROLE/KIND:', persisted[persisted.length - 1].role, '/', persisted[persisted.length - 1].kind);
  }

  // 滚到底部
  await page.evaluate(() => {
    const list = document.querySelector('.chat-list');
    if (list) list.scrollTop = list.scrollHeight;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_chat_history_full.png', fullPage: false });

  await browser.close();
  console.log('done');
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
