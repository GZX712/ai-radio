/**
 * 验证「绑定为主人」按钮已下线，且既有绑定能力/数据全部保留。
 *
 * 三种场景：
 *   A. 未绑定设备（客人）→ 引导层只剩「▶ 开始电台」，页面上不出现任何绑定按钮/文案
 *   B. 已绑定主人设备（用真实 bond 播种 localStorage）→ 永不渲染引导层，直达播放器
 *   C. 老路子 ?claim=<口令> 仍可用 → 换到 bond、写入 localStorage、URL 清掉口令
 *
 * 关键：场景 B 用的 bond 是从后端 POST /api/device/claim 现取的**真签名**，
 * 因此它同时证明"已绑设备的凭证依旧被验签通过"（数据没被动过）。
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:8787';
const OUT = 'D:/Workspace/AI工作空间仓库/ai-radio/shots';
const TOKEN = process.env.CLAIM || 'xradio-master-2026';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const probe = () => ({
  overlay: !!document.querySelector('.start-overlay'),
  bindBtn: document.querySelectorAll('.start-bind-btn').length,
  bindRow: document.querySelectorAll('.start-bind-row').length,
  hint: ((document.querySelector('.start-hint') || {}).textContent || '').trim(),
  hasBindText: /绑定为主人|本设备已为主人/.test(document.body.innerText || ''),
  bondInLs: !!localStorage.getItem('radio_owner_bond'),
  devIdInLs: localStorage.getItem('radio_device_id'),
  roleBadge: ((document.querySelector('.role-badge') || {}).textContent || '').trim(),
});

(async () => {
  const results = {};
  const browser = await PW.chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const newCtx = () => browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: IPHONE_UA,
  });

  // ---------- 0) 取一个真实 bond（模拟"已有的两台主人设备"之一） ----------
  const claimRes = await fetch(URL + '/api/device/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, deviceId: 'verify-owner-device-0001' }),
  }).then((r) => r.json());
  const realBond = claimRes && claimRes.data && claimRes.data.bond;
  console.log('[0] 现取真 bond:', realBond ? realBond.slice(0, 26) + '…' : '❌ 失败 ' + JSON.stringify(claimRes));
  results.realBond = !!realBond;

  // ---------- A) 客人设备 ----------
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.start-btn', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const s = await page.evaluate(probe);
    results.guest = s;
    await page.screenshot({ path: `${OUT}/_bind_A_guest_overlay.png` });
    console.log('[A] 客人引导层:', JSON.stringify(s));
    await ctx.close();
  }

  // ---------- B) 已绑定主人设备（播种真 bond） ----------
  {
    const ctx = await newCtx();
    await ctx.addInitScript((bond) => {
      try {
        localStorage.setItem('radio_device_id', 'verify-owner-device-0001');
        localStorage.setItem('radio_owner_bond', bond);
      } catch { /* ignore */ }
    }, realBond || 'invalid');
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    const s = await page.evaluate(probe);
    results.owner = s;
    await page.screenshot({ path: `${OUT}/_bind_B_owner_direct.png` });
    console.log('[B] 主人设备（直达，不应有引导层）:', JSON.stringify(s));
    await ctx.close();
  }

  // ---------- C) ?claim= 老路子仍可用 ----------
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await page.goto(`${URL}/?claim=${encodeURIComponent(TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);
    const s = await page.evaluate(() => ({
      bondSaved: !!localStorage.getItem('radio_owner_bond'),
      url: location.search,
      overlay: !!document.querySelector('.start-overlay'),
    }));
    results.claimUrl = s;
    console.log('[C] ?claim= 绑定:', JSON.stringify(s));
    await ctx.close();
  }

  await browser.close();

  const pass =
    results.guest.overlay === true &&
    results.guest.bindBtn === 0 &&
    results.guest.bindRow === 0 &&
    results.guest.hasBindText === false &&
    results.owner.overlay === false &&
    results.claimUrl.bondSaved === true &&
    results.claimUrl.url === '';
  console.log('\n===== 结论:', pass ? '✅ 全部通过' : '❌ 有未通过项', '=====');
  require('fs').writeFileSync(`${OUT}/_bind_verify.json`, JSON.stringify(results, null, 2));
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
