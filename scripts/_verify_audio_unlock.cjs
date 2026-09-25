/**
 * 验证「手机端完全无声」修复。
 *
 * 用法：MODE=normal|locked [URL=...] node scripts/_verify_audio_unlock.cjs
 *
 *   MODE=normal  正常环境（ctx 创建即 running）→ 应立刻接线、播放正常、无解锁提示
 *   MODE=locked  把 AudioContext 永久锁在 suspended，且让 resume() 永不兑现
 *                —— 精确模拟 iOS / 微信在**没有用户手势**时的行为。
 *
 * 修复前的表现（locked）：loadAndPlay 里 `await ctx.resume()` 永久挂起 →
 *   25 秒超时 → 抛「播放超时」→ 音乐压根没开播、一点声音都没有。
 * 修复后的表现（locked）：tryResume 不阻塞 → 照样起播；元素未接 WebAudio 走默认输出
 *   （这是"至少有声音"的保证）；同时页面显示「轻触开启声音」提示条兜底。
 */
const fs = require('node:fs');

const PW = 'C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js';
const { chromium } = require(PW);
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';

const MODE = process.env.MODE || 'normal';
const URL_BASE = process.env.URL || 'http://127.0.0.1:8787';
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 14000);

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

/** 埋点：媒体源/播放事件、resume 调用、createMediaElementSource 调用次数（=是否接线 WebAudio） */
const BASE_INIT = `(() => {
  window.__M = [];
  window.__els = [];
  window.__mesCount = 0;
  window.__resumeCalls = 0;
  const M = (k, v) => { try { window.__M.push(Object.assign({ t: Math.round(performance.now()), k }, v || {})); } catch (e) {} };
  window.__M_ = M;
  const reg = (el) => {
    if (!el || el.__tag) return;
    el.__tag = window.__els.length + 1;
    window.__els.push(el);
    const snap = () => ({ el: el.__tag, src: String(el.currentSrc || el.src || '').slice(-42), rs: el.readyState, paused: el.paused, ct: Number(el.currentTime || 0).toFixed(2), err: el.error ? el.error.code : null });
    for (const ev of ['loadstart','loadedmetadata','canplay','playing','waiting','stalled','abort','emptied','error','play','pause'])
      el.addEventListener(ev, () => M('ev:' + ev, snap()));
  };
  const C = window.AudioContext || window.webkitAudioContext;
  if (C) {
    // ⚠️ 踩坑：Chrome 把 createMediaElementSource 定义在 **AudioContext.prototype** 上
    // （实测 BaseAudioContext.prototype 无该自有属性），一开始只 patch 基类原型 →
    // 计数恒为 0，误判成"从未接线"。这里两个原型都试，取到自有属性才 patch。
    const protos = [];
    if (window.AudioContext && window.AudioContext.prototype) protos.push(window.AudioContext.prototype);
    if (window.BaseAudioContext && window.BaseAudioContext.prototype && protos.indexOf(window.BaseAudioContext.prototype) < 0) protos.push(window.BaseAudioContext.prototype);
    for (const p of protos) {
      const d = Object.getOwnPropertyDescriptor(p, 'createMediaElementSource');
      if (d && typeof d.value === 'function') {
        const orig = d.value;
        Object.defineProperty(p, 'createMediaElementSource', {
          value: function () { window.__mesCount++; return orig.apply(this, arguments); },
          writable: true, configurable: true,
        });
      }
      const rd = Object.getOwnPropertyDescriptor(p, 'resume');
      if (rd && typeof rd.value === 'function') {
        const origR = rd.value;
        Object.defineProperty(p, 'resume', {
          value: function () { window.__resumeCalls++; return origR.apply(this, arguments); },
          writable: true, configurable: true,
        });
      }
    }
    const ac = C;
    const Patched = function (...a) {
      const c = new ac(...a);
      (window.__ctxs = window.__ctxs || []).push(c);
      M('ctx:new', { state: c.state, n: window.__ctxs.length });
      return c;
    };
    Patched.prototype = ac.prototype;
    window.AudioContext = Patched;
    if (window.webkitAudioContext) window.webkitAudioContext = Patched;
  }
  const D = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  const g = D.get;
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    set(v) { reg(this); M('src=', { el: this.__tag, url: String(v).slice(-44) }); return D.set.call(this, v); },
    get() { return g.call(this); },
    configurable: true,
  });
  const pl = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    reg(this);
    const t = this.__tag;
    M('play:call', { el: t, src: String(this.src || '').slice(-36) });
    const pr = pl.apply(this, arguments);
    if (pr && pr.then) pr.then(() => M('play:ok', { el: t })).catch((e) => M('play:fail', { el: t, why: String((e && e.name) || e) }));
    return pr;
  };
})();`;

/** 把 AudioContext 彻底锁死：state 永远 suspended + resume 永不兑现 */
const LOCK_INIT = `(() => {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  const Base = window.BaseAudioContext || C;
  try { Object.defineProperty(Base.prototype, 'state', { get() { return 'suspended'; }, configurable: true }); } catch (e) {}
  try {
    Object.defineProperty(Base.prototype, 'resume', {
      value: function () { return new Promise(function () {}); },
      writable: true, configurable: true,
    });
  } catch (e) {}
  window.__forceLocked = true;
})();`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  await page.addInitScript(BASE_INIT);
  if (MODE === 'locked') await page.addInitScript(LOCK_INIT);

  console.log(`\n########## MODE=${MODE} ##########`);
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3500);

  const hasOverlay = await page.evaluate(() => !!document.querySelector('.start-overlay'));
  if (hasOverlay) {
    console.log('  · 有引导层 → 点击「开始电台」（等于给出手势）');
    await page.click('.start-btn').catch(() => {});
    await page.waitForTimeout(1200);
  } else {
    console.log('  · 无引导层（主人设备直达播放器，无手势）');
  }

  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < OBSERVE_MS) {
    await page.waitForTimeout(3000);
    const s = await page.evaluate(`(() => {
      const els = (window.__els || []).map(el => {
        const full = String(el.currentSrc || el.src || '');
        return { el: el.__tag, src: full.slice(-40), isData: full.startsWith('data:'), hasDj: full.indexOf('/audio/dj-') >= 0, rs: el.readyState, paused: el.paused, ct: Number(Number(el.currentTime || 0).toFixed(2)), err: el.error ? el.error.code : null };
      });
      const toast = document.querySelector('.toast, [class*="toast"]');
      return {
        els,
        hintVisible: !!document.querySelector('.audio-lock-hint'),
        hintText: (document.querySelector('.audio-lock-hint') || {}).innerText || null,
        toast: toast ? String(toast.textContent).slice(0, 80) : null,
        mesCount: window.__mesCount,
        resumeCalls: window.__resumeCalls,
        ctxCount: (window.__ctxs || []).length,
      };
    })()`);
    samples.push({ at: Math.round((Date.now() - t0) / 1000) + 's', ...s });
    const main = s.els.find((e) => !e.isData && !e.hasDj) || s.els[0] || {};
    console.log(`    ${Math.round((Date.now() - t0) / 1000) + 's'} ct=${main.ct} rs=${main.rs} paused=${main.paused} err=${main.err} | 提示条=${s.hintVisible} | 接线数=${s.mesCount} | ctx数=${s.ctxCount} | toast=${s.toast || '-'}`);
  }

  const marks = await page.evaluate(() => window.__M);
  const final = {
    mode: MODE,
    url: URL_BASE,
    mesCount: samples[samples.length - 1]?.mesCount,
    resumeCalls: samples[samples.length - 1]?.resumeCalls,
    ctxCount: samples[samples.length - 1]?.ctxCount,
    hintShown: samples.some((s) => s.hintVisible),
    progressAdvanced: (() => {
      const main = samples
        .map((s) => (s.els.find((e) => !e.isData && !e.hasDj) || {}).ct)
        .filter((v) => typeof v === 'number');
      return main.length >= 2 && main[main.length - 1] > main[0] + 0.5;
    })(),
    anyTimeoutError: samples.some((s) => s.toast && /超时|失败/.test(s.toast)),
    samples,
    errs,
  };
  fs.writeFileSync(`shots/_verify_unlock_${MODE}.json`, JSON.stringify({ ...final, marks }, null, 2));

  console.log('\n  ── 关键事件 ──');
  for (const m of marks) {
    if (/^(ctx:new|play:call|play:ok|play:fail|src=|ev:(playing|canplay|error|waiting|stalled))/.test(m.k))
      console.log(`    ${String(m.t).padStart(6)}ms ${m.k} ${JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => !['t', 'k'].includes(k))))}`);
  }
  console.log('\n  ══ 结论 ══');
  console.log('    接入 WebAudio 的元素数 (mesCount) =', final.mesCount, '（normal 期望 2；locked 期望 0）');
  console.log('    resume 调用次数                   =', final.resumeCalls);
  console.log('    解锁提示条是否出现                 =', final.hintShown, '（locked 期望 true）');
  console.log('    音频进度是否推进（=没被卡死）       =', final.progressAdvanced, '（两种模式都期望 true）');
  console.log('    是否出现"超时/失败"提示             =', final.anyTimeoutError, '（都期望 false）');
  if (errs.length) console.log('    页面报错:', errs.slice(0, 5));
  console.log(`\n  明细写入 shots/_verify_unlock_${MODE}.json`);

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
