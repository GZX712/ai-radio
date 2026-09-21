/**
 * 手机端延迟体检 v2 —— 修正 v1 的测量缺陷：
 *   `new Audio()` 是游离 DOM 元素，querySelector('audio') 看不见它（v1 的"未出声"是误报）。
 *   这里直接从 HTMLMediaElement.prototype 上劫持 play/src，登记所有媒体元素。
 *
 * 输出：从「点击开始电台」到真正出声（music.currentTime 推进）的真实耗时，
 *       以及每个媒体元素的 src / play() 调用 / 被拒原因 / 缓冲进度。
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const fs = require('fs');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const URL = process.env.URL || 'https://ai-radio-server.onrender.com';
const TAP_DELAY = Number(process.env.TAP_DELAY || 2500); // 模拟真人：引导层出现后再等 N ms 才点
const NET = process.env.NET || 'slow4g';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NETMAP = {
  slow4g: { downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8), uploadThroughput: Math.round(750 * 1024 / 8), latency: 150 },
  fast3g: { downloadThroughput: Math.round(3 * 1024 * 1024 / 8), uploadThroughput: Math.round(1.5 * 1024 * 1024 / 8), latency: 100 },
  // ⚠️ 曾经漏了 fourg 这一档：NET=fourg 时静默回落到 slow4g，导致"8Mbps 也要 13 秒"的假结论
  fourg: { downloadThroughput: Math.round(8 * 1024 * 1024 / 8), uploadThroughput: Math.round(2 * 1024 * 1024 / 8), latency: 60 },
  wifi: { downloadThroughput: -1, uploadThroughput: -1, latency: 20 },
};

(async () => {
  const out = { url: URL, tapDelayMs: TAP_DELAY, net: NET, marks: [], playCalls: [], afterTapSoundMs: null, errs: [] };
  const browser = await PW.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => out.errs.push(String(e).slice(0, 160)));

  await page.addInitScript(() => {
    const M = (k, extra) => window.__marks.push({ k, t: Math.round(performance.now()), ...(extra || {}) });
    window.__marks = [];
    window.__audios = [];

    // 登记所有媒体元素（new Audio() 不会进 DOM，只能从原型层抓）
    const reg = (el, why) => {
      if (!el.__idx) { el.__idx = window.__audios.length + 1; window.__audios.push(el); M('elCreated', { idx: el.__idx, why }); }
      return el.__idx;
    };
    const rawPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const idx = reg(this, 'play');
      M('playCall', { idx, src: String(this.src || '').slice(-46), t: Math.round(performance.now()) });
      const p = rawPlay.apply(this, arguments);
      if (p && typeof p.then === 'function') {
        p.then(() => M('playOK', { idx, t: Math.round(performance.now()) }))
          .catch((e) => M('playReject', { idx, why: String((e && e.name) || e).slice(0, 40), t: Math.round(performance.now()) }));
      }
      return p;
    };
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true, get: d.get,
      set(v) {
        const idx = reg(this, 'src');
        M('srcSet', { idx, url: String(v || '').slice(-46), t: Math.round(performance.now()) });
        return d.set.call(this, v);
      },
    });
    // 引导层何时出现 / 画出
    const iv = setInterval(() => {
      if (document.querySelector('.start-overlay')) { M('overlayInDOM'); clearInterval(iv); requestAnimationFrame(() => requestAnimationFrame(() => M('overlayPainted'))); }
    }, 30);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) M('longtask', { dur: Math.round(e.duration) }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const nc = NETMAP[NET] || NETMAP.slow4g;
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...nc });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // 记录每个媒体响应（含体积），用于算"13MB 到底下了多少"
  const media = {};
  page.on('response', (r) => {
    if (r.request().resourceType() !== 'media') return;
    const u = r.url();
    const k = /\/audio\/dj-/.test(u) ? 'DJ语音' : (u.split('/').pop() || '').slice(0, 30);
    media[k] = media[k] || { status: r.status(), kb: 0, n: 0, url: u.slice(-56) };
    media[k].n++;
    media[k].kb += Math.round(Number(r.headers()['content-length'] || 0) / 1024);
  });

  await page.goto(URL, { waitUntil: 'commit', timeout: 120000 });
  // 等引导层画出来
  for (let i = 0; i < 240; i++) {
    await sleep(200);
    const mk = await page.evaluate(() => window.__marks || []).catch(() => []);
    if (mk.some((m) => m.k === 'overlayPainted')) break;
  }
  await sleep(TAP_DELAY);

  const tapAt = Date.now();
  out.preClickMarks = (await page.evaluate(() => window.__marks || [])).filter((m) => ['srcSet', 'playCall', 'playOK', 'playReject'].includes(m.k));
  try { await page.click('.start-btn', { timeout: 15000 }); }
  catch (e) { out.errs.push('click: ' + String(e).slice(0, 140)); }

  // 等出声：music 通道元素 = src 命中 COS/mp3 且不属于 /audio/dj-
  let sound = null;
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const st = await page.evaluate(() => (window.__audios || []).map((a, i) => ({
      idx: i + 1, src: String(a.src || '').slice(-44), ct: +a.currentTime.toFixed(2), rs: a.readyState, net: a.networkState,
      paused: a.paused, dur: Math.round(a.duration || 0),
      bufEnd: a.buffered && a.buffered.length ? +a.buffered.end(a.buffered.length - 1).toFixed(1) : 0,
      isDj: /\/audio\/dj-/.test(a.src || ''),
    }))).catch(() => []);
    const music = st.find((a) => !a.isDj && /\.mp3/i.test(a.src));
    if (music && music.ct > 0.4) { sound = Date.now() - tapAt; out.musicAtSound = music; break; }
    if (i === 60) out.probe30s = st; // 30 秒还没声 → 留证据
  }
  out.afterTapSoundMs = sound;
  out.postMarks = (await page.evaluate(() => window.__marks || [])).filter((m) => ['srcSet', 'playCall', 'playOK', 'playReject'].includes(m.k));
  out.finalState = (await page.evaluate(() => (window.__audios || []).map((a, i) => ({
    idx: i + 1, src: String(a.src || '').slice(-44), ct: +a.currentTime.toFixed(2), rs: a.readyState, paused: a.paused,
    bufEnd: a.buffered && a.buffered.length ? +a.buffered.end(a.buffered.length - 1).toFixed(1) : 0,
  }))).catch(() => []));
  out.media = media;
  out.longTasks = (await page.evaluate(() => window.__marks || [])).filter((m) => m.k === 'longtask').map((m) => m.dur);
  const mk = await page.evaluate(() => window.__marks || []);
  out.marks = mk.filter((m) => ['overlayInDOM', 'overlayPainted', 'elCreated'].includes(m.k));
  out.nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    const p = {}; for (const e of performance.getEntriesByType('paint')) p[e.name] = Math.round(e.startTime);
    return { ttfb: Math.round(n.responseStart || 0), dcl: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0), paint: p };
  }).catch(() => ({}));

  await browser.close();
  fs.writeFileSync('D:/Workspace/AI工作空间仓库/ai-radio/shots/_mobile_latency.json', JSON.stringify(out, null, 2), 'utf8');

  const f = (k) => (out.marks.find((m) => m.k === k) || {}).t ?? '-';
  console.log(`== 手机端延迟体检 v2 (${NET} + CPU 4x, 引导层后 ${TAP_DELAY}ms 才点) ==`);
  console.log('  引导层画出      :', f('overlayPainted'), 'ms');
  console.log('  nav dcl/load    :', out.nav.dcl, '/', out.nav.load, 'ms   首帧:', JSON.stringify(out.nav.paint));
  console.log('  长任务          :', out.longTasks.length, '个，最长', out.longTasks.length ? Math.max(...out.longTasks) : 0, 'ms');
  console.log('  --- 点击前的媒体动作 ---');
  for (const m of out.preClickMarks) console.log('    ', m.t + 'ms', m.k, JSON.stringify(m.src || m.url || ''), m.why || '');
  console.log('  点击 → 出声     :', out.afterTapSoundMs === null ? '❌ 超时未出声' : out.afterTapSoundMs + ' ms');
  if (out.musicAtSound) console.log('      出声时状态  :', JSON.stringify(out.musicAtSound));
  console.log('  --- 点击后的媒体动作 ---');
  for (const m of out.postMarks) console.log('    ', m.t + 'ms', m.k, JSON.stringify(m.src || m.url || ''), m.why || '');
  console.log('  媒体下载量      :', JSON.stringify(out.media));
  console.log('  报错            :', JSON.stringify(out.errs));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
