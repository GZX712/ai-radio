/**
 * 切歌「卡壳」探针：量化一次手动切歌（未命中预取）从点击到出声的耗时构成，
 * 以及慢网连续播放中的 stall（缓冲停顿）次数与总时长。
 *
 * 背景：手机端首屏/起播已在 45d291c 修过（35s → 3.7s@4G）。本次要回答的是
 * **第二个抱怨：「有时候卡壳」** —— 也就是播放中途的停顿与切歌空窗，
 * 需要拆成：① /api/next 往返 ② 音频下载+解码到可播 ③ DJ 串场语音到达/开声。
 *
 * 用法：URL=http://127.0.0.1:8787 NET=fourg SKIP_AT=12 node scripts/_probe_skip_gap.cjs
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:8787';
const OUT = 'D:/Workspace/AI工作空间仓库/ai-radio/shots';
const NET = process.env.NET || 'fourg';
const SKIP_AT = Number(process.env.SKIP_AT || 12);      // 播到第几秒点切歌
const WATCH_MS = Number(process.env.WATCH_MS || 75000); // 切歌后观察多久
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// 限速档位（缺档必须显式报错 —— 上一轮踩过"漏档静默回落"的坑）
const NETMAP = {
  slow4g: { downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8), uploadThroughput: Math.round((750 * 1024) / 8), latency: 150 },
  fast3g: { downloadThroughput: Math.round((3 * 1024 * 1024) / 8), uploadThroughput: Math.round((1.5 * 1024 * 1024) / 8), latency: 100 },
  fourg: { downloadThroughput: Math.round((8 * 1024 * 1024) / 8), uploadThroughput: Math.round((3 * 1024 * 1024) / 8), latency: 60 },
  wifi: { downloadThroughput: -1, uploadThroughput: -1, latency: 20 },
};
if (!(NET in NETMAP)) {
  console.error(`❌ 未知网络档 NET=${NET}，可用：${Object.keys(NETMAP).join(' / ')}`);
  process.exit(1);
}
const profile = NETMAP[NET];
console.log(`网络档 = ${NET}`, JSON.stringify(profile));

(async () => {
  const browser = await PW.chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: IPHONE_UA,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (profile.downloadThroughput > 0) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: profile.latency,
      downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }

  const report = { net: NET, skipAt: SKIP_AT, marks: [], next: null, dj: [], samples: [], stalls: [], errs: [] };

  // 在页面里埋点：注册表跟踪所有 media 元素（new Audio() 是游离元素，querySelector 看不见）
  await page.addInitScript(() => {
    window.__R = { reg: [], marks: [] };
    const M = (k, v) => { window.__R.marks.push(Object.assign({ t: Math.round(performance.now()), k }, v || {})); };
    window.__M = M;
    HTMLMediaElement.prototype.__reg = HTMLMediaElement.prototype.__reg || [];
    const reg = (el) => {
      if (!el || el.__tag) return el && el.__tag;
      el.__tag = window.__R.reg.length + 1;
      window.__R.reg.push(el);
      for (const ev of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'suspend', 'abort', 'ended', 'error']) {
        el.addEventListener(ev, () => {
          M('ev:' + ev, {
            el: el.__tag, src: String(el.src || '').slice(-34),
            rs: el.readyState, ct: +(el.currentTime || 0).toFixed(2),
            buf: (el.buffered && el.buffered.length) ? +(el.buffered.end(el.buffered.length - 1) - el.currentTime).toFixed(2) : 0,
          });
        });
      }
      return el.__tag;
    };
    window.__reg = reg;
    const dPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { reg(this); return dPlay.apply(this, arguments); };
    const dLoad = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () { reg(this); return dLoad.apply(this, arguments); };
    const dSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    const dSrcGet = dSrcDesc.get;
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      set(v) { reg(this); M('src=', { el: this.__tag, url: String(v).slice(-44) }); return dSrcDesc.set.call(this, v); },
      get() { return dSrcGet.call(this); },
      configurable: true,
    });
    // fetch 埋点：区分 音频预取 / api
    const df = window.fetch;
    window.fetch = function (u, o) {
      const s = typeof u === 'string' ? u : (u && u.url) || '';
      const t = Math.round(performance.now());
      if (/\/api\//.test(s)) M('fetch:api:start', { url: s.slice(-40) });
      return df.apply(this, arguments).then((r) => {
        if (/\/api\//.test(s)) M('fetch:api:done', { url: s.slice(-40), status: r.status });
        if (/\.mp3|\/songs\//i.test(s)) M('fetch:mp3', { url: s.slice(-40) });
        return r;
      });
    };
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.start-btn', { timeout: 90000 });
  const tTap = await page.evaluate(() => Math.round(performance.now()));
  await page.click('.start-btn');
  report.marks.push({ t: tTap, k: 'tap:开始电台' });

  // 等真的出声
  await page.waitForFunction(
    () => { const r = window.__R.reg.find((e) => /songs|cos|blob:|localhost/.test(String(e.src))); return r && r.currentTime > 0.4 && !r.paused; },
    { timeout: 90000 }
  ).catch(() => {});
  const firstSound = await page.evaluate(() => {
    const r = window.__R.reg.find((e) => /songs|cos|blob:|localhost/.test(String(e.src)));
    return r ? { dt: Math.round(performance.now()), ct: +r.currentTime.toFixed(2), src: String(r.src).slice(-40) } : null;
  });
  report.firstSound = firstSound;
  console.log(`① 点击「开始电台」→ 出声: ${firstSound ? (firstSound.dt - 0) + 'ms (ct=' + firstSound.ct + 's)' : '未探测到'}`);

  // 播到 SKIP_AT 秒，点切歌（此时通常还没到 85% 预取阈值 → 走真实下载路径）
  await page.waitForFunction((s) => {
    const r = window.__R.reg.find((e) => /songs|cos|blob:|localhost/.test(String(e.src)));
    return r && r.currentTime > s;
  }, SKIP_AT, { timeout: 120000 }).catch(() => {});
  const before = await page.evaluate(() => {
    const r = window.__R.reg.find((e) => /songs|cos|blob:|localhost/.test(String(e.src)));
    return { ct: r ? +r.currentTime.toFixed(2) : 0, src: r ? String(r.src).slice(-40) : '', pending: window.__R.marks.filter((m) => m.k === 'src=').length };
  });
  await page.evaluate(() => window.__M('tap:切歌'));
  const tSkip = await page.evaluate(() => Math.round(performance.now()));
  await page.click('button[aria-label="下一首"]', { timeout: 15000 });
  console.log(`② 切歌前状态: ct=${before.ct}s src=…${before.src} (历史 src 赋值 ${before.pending} 次)`);

  // 观察切歌后：新歌何时出声 + DJ 语音何时到达/开声 + stall
  const deadline = Date.now() + WATCH_MS;
  let skipSoundAt = null;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => {
      const reg = window.__R.reg;
      return {
        t: Math.round(performance.now()),
        medias: reg.map((e) => ({
          tag: e.__tag, src: String(e.src || '').slice(-36), paused: e.paused,
          ct: +(e.currentTime || 0).toFixed(2), rs: e.readyState,
          buf: (e.buffered && e.buffered.length) ? +(e.buffered.end(e.buffered.length - 1) - e.currentTime).toFixed(2) : 0,
        })),
      };
    });
    report.samples.push(snap);
    const music = snap.medias.filter((m) => /songs|cos|blob:/.test(m.src)).pop();
    if (!skipSoundAt && music && music.ct > 0.4 && !music.paused) {
      skipSoundAt = snap.t;
      console.log(`③ 切歌 → 新歌出声: ${skipSoundAt - tSkip}ms (src=…${music.src})`);
    }
    if (skipSoundAt && snap.t - skipSoundAt > 25000) break;
    await sleep(700);
  }

  const marks = await page.evaluate(() => window.__R.marks);
  report.marks = report.marks.concat(marks);
  report.skipMs = skipSoundAt ? skipSoundAt - tSkip : null;

  // DJ 语音（/audio/dj-*.mp3）
  const djEv = marks.filter((m) => /audio\/dj-|dj-.*\.mp3/.test(JSON.stringify(m)));
  report.dj = djEv.slice(0, 20);

  // 统计 stall：waiting 事件次数 + 每次持续（到下个 playing）
  const evs = marks.filter((m) => m.k === 'ev:waiting' || m.k === 'ev:playing' || m.k === 'ev:stalled');
  let waitStart = null;
  for (const e of evs) {
    if (e.k === 'ev:waiting' || e.k === 'ev:stalled') { if (!waitStart) waitStart = e.t; }
    if (e.k === 'ev:playing' && waitStart) { report.stalls.push({ from: waitStart, ms: e.t - waitStart, el: e.el }); waitStart = null; }
  }

  // 缓冲余量轨迹（判断慢网是否一直在"边下边播"的危险区）
  const bufTrace = report.samples.map((s) => {
    const m = s.medias.filter((x) => /songs|cos|blob:/.test(x.src)).pop();
    return m ? { t: s.t, buf: m.buf, ct: m.ct, rs: m.rs } : null;
  }).filter(Boolean);
  report.bufTrace = bufTrace;

  await page.screenshot({ path: `${OUT}/_skip_gap.png` });
  await browser.close();

  console.log('\n④ DJ 串场语音事件（前 12 条）:');
  for (const d of report.dj.slice(0, 12)) console.log('   ', d.t, d.k, JSON.stringify(d).slice(0, 130));
  console.log('\n⑤ stall 停顿:', report.stalls.length ? JSON.stringify(report.stalls) : '无');
  console.log('⑥ 缓冲余量轨迹（尾 12 点）:');
  for (const b of bufTrace.slice(-12)) console.log(`    t=${b.t} ct=${b.ct}s rs=${b.rs} 缓冲余量=${b.buf}s`);
  console.log('\n⑦ 错误:', JSON.stringify(report.errs));

  require('fs').writeFileSync(`${OUT}/_skip_gap.json`, JSON.stringify(report, null, 1));
  console.log('\n结果已写入 shots/_skip_gap.json');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
