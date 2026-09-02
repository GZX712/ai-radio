// 截图：pop 气泡改造 + comic/glass 主题重写验证
const { chromium } = require('playwright-core');
const path = require('path');

const BASE = 'http://127.0.0.1:8791/';
const OUT = path.resolve(__dirname, 'round4-shots');
require('fs').mkdirSync(OUT, { recursive: true });

const SAMPLE_MESSAGES = [
  // 你发的话
  { id: 1, role: 'user', kind: 'reply', en: '来首周杰伦试试', zh: '', time: '15:03' },
  // DJ 回复
  {
    id: 2,
    role: 'dj',
    kind: 'reply',
    en: "今晚第 3 首, Ed Sheeran 的 Shape of You ~",
    zh: '一首经典流行，前奏响起你应该会跟着哼～',
    audioUrl: 'http://example.com/audio.mp3',
    time: '15:03',
  },
];

(async () => {
  const browser = await chromium.launchPersistentContext(
    'C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\edge-profile-shot',
    {
      headless: true,
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\152.0.4191.53\\msedge.exe',
      viewport: { width: 380, height: 700 },
      deviceScaleFactor: 2,
    }
  );
  const page = browser.pages()[0] || (await browser.newPage());

  // 设置壁纸 + 注入测试消息 + 打开聊天面板
  const setupPage = async (wallpaperId) => {
    // 先设壁纸 + 测试消息到 localStorage（新 context 干净起步）
    await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.evaluate(({ wp, msgs }) => {
      localStorage.setItem('ai-radio-wallpaper', wp);
      localStorage.setItem('ai-radio-test-messages', JSON.stringify(msgs));
    }, { wp: wallpaperId, msgs: SAMPLE_MESSAGES });
    // 带 testMsgs=1 重进：ChatPanel 初始 state 从 localStorage 读消息
    await page.goto(BASE + '?testMsgs=1&testThinking=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    // 点掉 splash 进入播放器
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const start = btns.find(b => b.textContent && /开始电台|Start|启动|进入/i.test(b.textContent));
      if (start) start.click();
    });
    await page.waitForTimeout(900);
  };

  // 截图播放器（已关闭 splash）+ 聊天面板默认展开可见
  const shotPlayer = async (wp, file) => {
    await setupPage(wp);
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  };

  // 同上但全页截图（更好展示主题色覆盖全屏）
  const shotChatOpen = async (wp, file) => {
    await setupPage(wp);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  };

  // pop 主题：先看整体播放器
  await shotPlayer('pop', '01-pop-player.png');
  // pop：打开聊天面板
  await shotChatOpen('pop', '02-pop-chat.png');

  // comic 主题
  await shotPlayer('comic', '03-comic-player.png');
  await shotChatOpen('comic', '04-comic-chat.png');

  // glass 主题
  await shotPlayer('glass', '05-glass-player.png');
  await shotChatOpen('glass', '06-glass-chat.png');

  // 对照：pulse 默认
  await shotPlayer('pulse', '07-pulse-player.png');

  await browser.close();
  console.log('DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
