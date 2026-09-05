// 验证：chat-reply 类型 DJ 消息不该有 💡 小灯泡，auto 类型仍保留
const { chromium } = require('playwright-core');

(async () => {
  // 用本地后端 8787(同时 serve dist 静态 + WS 后端)
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 13 Pro
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const page = await ctx.newPage();

  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 关掉 start-overlay 直接进入 chat
  await page.waitForSelector('.start-overlay', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    const o = document.querySelector('.start-overlay');
    if (o) o.click();
  });
  await page.waitForTimeout(800);

  // 注入两条假 DJ 消息到 chat-messages 容器（绕过 React state，最快验证 DOM 渲染）
  await page.evaluate(() => {
    const chatPanel = document.querySelector('.chat-panel, [class*="chat"]');
    const messages = document.querySelector('.chat-messages') || document.querySelector('[class*="messages"]');
    if (!messages) {
      console.log('NO chat-messages container found, will look for first .chat-msg');
    }
    // 找 .chat-messages 的祖先容器
    let host = messages;
    if (!host) {
      const c = document.querySelector('.chat-msg');
      if (c) host = c.parentElement;
    }
    if (!host) {
      console.log('NO host');
      return;
    }

    // 两条假消息 DOM
    function makeMsg(role, kind, enText, withBulb) {
      const wrap = document.createElement('div');
      wrap.className = `chat-msg ${role}${role === 'dj' && kind === 'reply' ? ' kind-reply' : ''}${role === 'dj' && kind === 'auto' ? ' kind-auto' : ''}`;
      // 头像
      const av = document.createElement('div');
      av.className = 'chat-avatar';
      av.textContent = '🎙️';
      wrap.appendChild(av);
      // 气泡
      const content = document.createElement('div');
      content.className = 'chat-msg-content';
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = enText;
      content.appendChild(text);
      if (withBulb) {
        const bulb = document.createElement('span');
        bulb.className = 'chat-bulb';
        bulb.textContent = '💡';
        content.appendChild(bulb);
      }
      wrap.appendChild(content);
      return wrap;
    }

    // auto: 切歌冷笑话（带 bulb） + reply: 聊天回复（无 bulb）
    host.appendChild(makeMsg('dj', 'auto',
      '[切歌冷笑话] Everybody has a music taste. Some just have more courage to admit it than others.',
      true));
    host.appendChild(makeMsg('dj', 'reply',
      '[聊天回复] I get it — when the playlist hits different at 3 AM and you start questioning all your life choices.',
      false));
    host.scrollTop = host.scrollHeight;
  });

  await page.waitForTimeout(500);

  // 截图
  const chatPanel = await page.locator('.chat-panel, [class*="chat"]').first();
  await chatPanel.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_bulb_segregation.png' });
  await page.screenshot({ path: 'D:/Workspace/AI工作空间仓库/ai-radio/shots/_bulb_page.png', fullPage: false });

  // 计数检查
  const stats = await page.evaluate(() => {
    const all = document.querySelectorAll('.chat-msg');
    const bulbAll = document.querySelectorAll('.chat-bulb');
    // 找 auto 和 reply 的 .chat-msg (它们的顺序是后插入的在后面)
    const autoBubble = !!Array.from(all).slice(-2)[0]?.querySelector('.chat-bulb');
    const replyBubble = !!Array.from(all).slice(-2)[1]?.querySelector('.chat-bulb');
    return {
      allCount: all.length,
      bulbCount: bulbAll.length,
      autoBubbleHasBulb: autoBubble,
      replyBubbleHasBulb: replyBubble,
    };
  });
  console.log('STATS:', JSON.stringify(stats));

  await browser.close();
  console.log('done');
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
