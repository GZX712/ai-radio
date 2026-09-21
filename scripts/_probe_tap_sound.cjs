/**
 * 点击「开始电台」→ 真正出声：逐事件时间线
 * 精确回答"那 13 秒到底花在哪"：
 *   - AudioContext 是否 suspended（挂起时元素在"播"但没声音）
 *   - 媒体元素事件序列：loadstart / loadedmetadata / canplay / playing / waiting / stalled / suspend
 *   - currentTime / readyState / buffered 每 100ms 采样
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const fs = require('fs');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:8787';
const TAP_DELAY = Number(process.env.TAP_DELAY || 2000);
const NET = process.env.NET || 'slow4g';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NETMAP = {
  slow4g: { downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8), uploadThroughput: Math.round(750 * 1024 / 8), latency: 150 },
  fourg: { downloadThroughput: Math.round(8 * 1024 * 1024 / 8), uploadThroughput: Math.round(2 * 1024 * 1024 / 8), latency: 60 },
};

(async () => {
  const out = { url: URL, net: NET, events: [], samples: [], ctx: [], errs: [] };
  const browser = await PW.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => out.errs.push(String(e).slice(0, 140)));

  await page.addInitScript(() => {
    window.__ev = [];
    const M = (k, extra) => window.__ev.push({ k, t: Math.round(performance.now()), ...(extra || {}) });
    window.__ctxs = [];
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      const Orig = window[name];
      if (!Orig) continue;
      const Wrapped = function (...a) { const c = new Orig(...a); window.__ctxs.push(c); M('ctxCreated', { state: c.state }); return c; };
      Wrapped.prototype = Orig.prototype;
      window[name] = Wrapped;
      break;
    }
    // 登记媒体元素 + 挂事件（new Audio() 是游离元素，querySelector 看不见 → 自持注册表）
    const seen = new WeakSet();
    window.__mediaEls = window.__mediaEls || [];
    window.__n = 0;
    const watch = (el) => {
      if (!el || seen.has(el) || typeof el.addEventListener !== 'function') return;
      seen.add(el);
      el.__tag = ++window.__n;
      window.__mediaEls.push(el);
      const tag = () => ({ el: el.__tag, src: String(el.src || '').slice(-38) });
      for (const ev of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'stalled', 'suspend', 'abort', 'emptied', 'error', 'play', 'pause']) {
        el.addEventListener(ev, () => M('ev:' + ev, tag()));
      }
    };
    const rawPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { watch(this); M('play()', { el: this.__tag || '?' }); return rawPlay.apply(this, arguments); };
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get: d.get, set(v) { watch(this); M('src=', { el: this.__tag || '?', url: String(v || '').slice(-38) }); return d.set.call(this, v); } });
    const iv = setInterval(() => { if (document.querySelector('.start-overlay')) { M('overlayPainted'); clearInterval(iv); } }, 30);
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...(NETMAP[NET] || NETMAP.slow4g) });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // 对照实验：NO_DJ=1 时拦掉 DJ 开场白，验证"DJ 在播 → 音乐下载被挂起"的假设
  if (process.env.NO_DJ === '1') {
    await page.route('**/api/dj/open', (r) => r.abort());
    out.noDj = true;
  }

  await page.goto(URL, { waitUntil: 'commit', timeout: 90000 });  for (let i = 0; i < 200; i++) { await sleep(200); const e = await page.evaluate(() => window.__ev || []).catch(() => []); if (e.some((x) => x.k === 'overlayPainted')) break; }
  await sleep(TAP_DELAY);

  const t0InPage = await page.evaluate(() => Math.round(performance.now()));
  const tapWall = Date.now();
  await page.click('.start-btn', { timeout: 15000 }).catch((e) => out.errs.push('click:' + String(e).slice(0, 90)));

  // 每 100ms 采样，直到 currentTime > 0.5
  let firstSound = null;
  for (let i = 0; i < 250; i++) {
    await sleep(100);
    const s = await page.evaluate(() => {
      const els = [];
      for (const a of document.querySelectorAll('audio, video')) els.push(a);
      // 也扫 AudioContext 里的元素拿不到，只能靠 src 记录里的元素；这里另存全局引用
      const list = (window.__mediaEls || []);
      const arr = list.length ? list : els;
      return {
        t: Math.round(performance.now()),
        ctxs: (window.__ctxs || []).map((c) => c.state),
        els: arr.map((a) => ({
          el: a.__tag, src: String(a.src || '').slice(-30), ct: +(a.currentTime || 0).toFixed(2), rs: a.readyState, ns: a.networkState, paused: a.paused,
          bufEnd: a.buffered && a.buffered.length ? +a.buffered.end(a.buffered.length - 1).toFixed(1) : 0,
        })),
      };
    }).catch(() => null);
    if (!s) continue;
    out.samples.push({ dt: s.t - t0InPage, ctxs: s.ctxs, els: s.els });
    const music = s.els.find((e) => !/dj-/.test(e.src || '') && /\.mp3/i.test(e.src || ''));
    if (music && music.ct > 0.5) { firstSound = { dt: s.t - t0InPage, wall: Date.now() - tapWall, el: music }; break; }
  }
  out.firstSound = firstSound;
  out.events = (await page.evaluate(() => window.__ev || [])).map((e) => ({ ...e, t: e.t - t0InPage }));
  out.marksMediaEls = await page.evaluate(() => {
    // 暴露已登记的媒体元素，供后续复用
    return (window.__mediaEls || []).length;
  }).catch(() => 0);
  await browser.close();
  fs.writeFileSync('D:/Workspace/AI工作空间仓库/ai-radio/shots/_tap_sound.json', JSON.stringify(out, null, 2), 'utf8');

  console.log(`== 点击 → 出声 逐事件时间线  (${NET} + CPU4x, 点击基准 t=0) ==`);
  console.log('  firstSound:', out.firstSound ? `页面时间 ${out.firstSound.dt}ms / 墙钟 ${out.firstSound.wall}ms` : '❌ 未探测到');
  console.log('  事件流（相对点击时刻）:');
  for (const e of out.events) console.log('    ' + String(e.t).padStart(6) + 'ms  ' + e.k + '  ' + (e.url || (e.el ? 'el#' + e.el : '')) + (e.state ? ' [' + e.state + ']' : ''));
  console.log('  采样（每 400ms 抽一帧）:');
  out.samples.filter((_, i) => i % 4 === 0).slice(0, 45).forEach((s) => {
    console.log('    ' + String(s.dt).padStart(6) + 'ms  ctx=' + JSON.stringify(s.ctxs) + '  ' + JSON.stringify(s.els));
  });
  console.log('  报错:', JSON.stringify(out.errs));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
