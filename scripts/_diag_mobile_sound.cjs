/**
 * 手机端「完全无声」诊断探针
 *
 * 用法：MODE=strict|loose ROLE=owner|guest [URL=...] node scripts/_diag_mobile_sound.cjs
 *   MODE=strict  强制 --autoplay-policy=document-user-activation-required（模拟 iOS/微信）
 *   MODE=loose   强制 --autoplay-policy=no-user-gesture-required（模拟 PC Chrome 高 MEI）
 *   ROLE=owner   先走 /?claim= 绑定，模拟已绑主人设备（直达播放器、无「开始电台」按钮）
 *   ROLE=guest   清存储，模拟新设备（可见「开始电台」按钮，有点击手势）
 *
 * 埋点：AudioContext 构造/resume、media src 赋值、play() 成败、全事件流、元素最终状态
 */
const path = require('node:path');
const fs = require('node:fs');

const PW = 'C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js';
const { chromium } = require(PW);
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';

const MODE = process.env.MODE || 'strict';
const ROLE = process.env.ROLE || 'guest';
const URL_BASE = process.env.URL || 'https://ai-radio-server.onrender.com';
const CLAIM = process.env.CLAIM || 'xradio-master-2026';
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 12000);

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

const INIT = `(() => {
  window.__M = [];
  window.__els = [];
  const M = (k, v) => { try { window.__M.push(Object.assign({ t: Math.round(performance.now()), k }, v || {})); } catch (e) {} };
  const reg = (el) => {
    if (!el || el.__tag) return;
    el.__tag = window.__els.length + 1;
    window.__els.push(el);
    const snap = () => ({
      el: el.__tag,
      src: String(el.currentSrc || el.src || '').slice(-46),
      rs: el.readyState,
      ns: el.networkState,
      paused: el.paused,
      ct: Number(el.currentTime || 0).toFixed(1),
      vol: el.volume,
      muted: el.muted,
      err: el.error ? (el.error.code + '/' + (el.error.message || '').slice(0, 30)) : null,
    });
    for (const ev of ['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','playing','waiting','stalled','suspend','abort','emptied','error','play','pause','volumechange'])
      el.addEventListener(ev, () => M('ev:' + ev, snap()));
  };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const Patched = function (...a) {
      const c = new AC(...a);
      M('ctx:new', { state: c.state });
      const r = c.resume.bind(c);
      c.resume = () => { M('ctx:resume:call', { state: c.state }); return r().then(() => { M('ctx:resume:ok', { state: c.state }); return c; }, (e) => { M('ctx:resume:fail', { state: c.state, why: String((e && e.name) || e) }); throw e; }); };
      return c;
    };
    Patched.prototype = AC.prototype;
    window.AudioContext = Patched;
    if (window.webkitAudioContext) window.webkitAudioContext = Patched;
  }
  const D = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  const g = D.get;
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    set(v) { reg(this); M('src=', { el: this.__tag, url: String(v).slice(-50) }); return D.set.call(this, v); },
    get() { return g.call(this); },
    configurable: true,
  });
  const p = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    reg(this);
    const t = this.__tag;
    M('play:call', { el: t, src: String(this.src || '').slice(-40), paused: this.paused });
    const pr = p.apply(this, arguments);
    if (pr && pr.then) pr.then(() => M('play:ok', { el: t })).catch((e) => M('play:fail', { el: t, why: String((e && e.name) || e) + ' ' + String((e && e.message) || '').slice(0, 70) }));
    return pr;
  };
  const au = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () { reg(this); M('pause:call', { el: this.__tag }); return au.apply(this, arguments); };
})();`;

const elState = () => `(() => (window.__els || []).map(el => ({
  el: el.__tag,
  src: String(el.currentSrc || el.src || '').slice(-46),
  rs: el.readyState, ns: el.networkState, paused: el.paused,
  ct: Number(el.currentTime || 0).toFixed(2), vol: el.volume, muted: el.muted,
  err: el.error ? el.error.code : null,
})))()`;

const pageState = () => `(() => {
  const t = document.querySelector('.toast, .toast-msg, [class*="toast"]');
  const play = document.querySelector('button[aria-label*="播放"], button[aria-label*="暂停"], .play-btn, .ctrl-btn');
  return {
    hasStartOverlay: !!document.querySelector('.start-overlay'),
    trackName: (document.querySelector('.song-name, .track-name, [class*="song-title"]') || {}).textContent || null,
    toast: t ? String(t.textContent).slice(0, 90) : null,
    playBtnLabel: play ? (play.getAttribute('aria-label') || String(play.className).slice(0, 30)) : null,
    bodyText: String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
  };
})()`;

(async () => {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  args.push(
    MODE === 'strict'
      ? '--autoplay-policy=document-user-activation-required'
      : '--autoplay-policy=no-user-gesture-required'
  );

  // ⚠️ 关键：Playwright 默认注入 --autoplay-policy=no-user-gesture-required，
  // 会覆盖我们自己的严格策略（表现为 owner 场景 ctx 直接 running，与真机不符）。
  // 必须用 ignoreDefaultArgs 先把它摘掉，否则测不出「无手势 → AudioContext suspended」。
  const launchOpts = { executablePath: CHROME, args, headless: true };
  if (MODE === 'strict') launchOpts.ignoreDefaultArgs = ['--autoplay-policy=no-user-gesture-required'];
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + String(m.text()).slice(0, 120)); });
  await page.addInitScript(INIT);

  const report = { mode: MODE, role: ROLE, url: URL_BASE, steps: [] };

  console.log(`\n########## MODE=${MODE}  ROLE=${ROLE} ##########`);

  if (ROLE === 'owner') {
    console.log('  [1] 走 /?claim= 绑定本设备为主人…');
    await page.goto(`${URL_BASE}/?claim=${CLAIM}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(6000);
  } else {
    await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  await page.waitForTimeout(3000);

  let ps = await page.evaluate(pageState());
  report.steps.push({ at: 'load', page: ps });
  console.log('  [load] 引导层=' + ps.hasStartOverlay + ' | 曲目=' + ps.trackName + ' | toast=' + ps.toast);
  console.log('         playBtn=' + ps.playBtnLabel);

  if (ps.hasStartOverlay) {
    console.log('  [2] 点击「开始电台」（用户手势）…');
    await page.click('.start-btn').catch(() => {});
    await page.waitForTimeout(1200);
  } else {
    console.log('  [2] 无引导层（主人直达）→ 无手势');
  }

  console.log(`  [3] 观察 ${OBSERVE_MS}ms …`);
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < OBSERVE_MS) {
    await page.waitForTimeout(3000);
    const els = await page.evaluate(elState());
    samples.push({ at: Math.round((Date.now() - t0) / 1000) + 's', els });
    const m = els.find((e) => e.src && !e.src.includes('dj-')) || els[0];
    if (m) console.log(`    ${samples[samples.length - 1].at}  el#${m.el} ct=${m.ct} rs=${m.rs} paused=${m.paused} muted=${m.muted} vol=${m.vol} err=${m.err}  ${m.src}`);
  }

  const marks = await page.evaluate(() => window.__M);
  const elsFinal = await page.evaluate(elState());
  ps = await page.evaluate(pageState());
  report.samples = samples;
  report.marks = marks;
  report.elsFinal = elsFinal;
  report.pageFinal = ps;
  report.errs = errs;

  const out = path.join('shots', `_diag_${MODE}_${ROLE}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log('\n  --- 关键事件 ---');
  for (const m of marks) {
    if (/^(ctx:|play:|src=|ev:(play|playing|error|canplay|waiting|stalled|abort|emptied))/.test(m.k))
      console.log(`    ${String(m.t).padStart(6)}ms ${m.k} ${JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => !['t', 'k'].includes(k))))}`);
  }
  console.log('\n  --- 最终元素状态 ---');
  for (const e of elsFinal) console.log('    ' + JSON.stringify(e));
  console.log('\n  --- 页面 ---');
  console.log('    引导层=' + ps.hasStartOverlay + ' | toast=' + ps.toast);
  if (errs.length) { console.log('\n  --- 报错 ---'); errs.slice(0, 10).forEach((e) => console.log('    ' + e)); }
  console.log(`\n  结果写入 ${out}`);

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
