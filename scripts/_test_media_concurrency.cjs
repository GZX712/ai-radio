/**
 * 隔离实验（空白页，零 App 代码）：确认"另一个媒体在播时，音乐的下载是否被浏览器挂起"
 * 同一首歌 + 同一限速（Slow4G + CPU4x），只改「是否有第二个媒体同时在播」。
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const COS = 'https://ai-radio-library-1463614289.cos.ap-nanjing.myqcloud.com';
const MEDIA = { downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8), uploadThroughput: Math.round(750 * 1024 / 8), latency: 150 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const m = await (await fetch(COS + '/manifest.json')).json();
  const song = m.songs.find((s) => s.file.includes('My bedroom')) || m.songs[0];
  const url = `${COS}/songs/${encodeURIComponent(song.file)}`;
  const sizeKB = Math.round((await fetch(url, { headers: { Range: 'bytes=0-1' } }).then((r) => Number((r.headers.get('content-range') || '0/0').split('/')[1])) ) / 1024);
  console.log('测试曲目:', song.file, `| 体积 ${sizeKB} KB`);
  console.log('限速: 1.6 Mbps（约 200 KB/s）→ 满速下完需约', Math.round(sizeKB / 200), '秒');
  console.log('');

  const browser = await PW.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

  async function run(label, script) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__ev = []; window.__els = [];
      window.__M = (k, e) => window.__ev.push({ k, t: Math.round(performance.now()), ...(e || {}) });
      window.__watch = (el) => {
        if (!el || el.__w) return; el.__w = 1; el.__tag = window.__els.length + 1; window.__els.push(el);
        for (const ev of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'suspend', 'error']) {
          el.addEventListener(ev, () => window.__M('ev:' + ev, { el: el.__tag, buf: el.buffered.length ? +el.buffered.end(0).toFixed(1) : 0 }));
        }
      };
      window.__create = (cross) => { const a = new Audio(); if (cross) a.crossOrigin = 'anonymous'; a.preload = 'auto'; window.__watch(a); return a; };
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...MEDIA });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('about:blank');
    const t0 = Date.now();
    await page.evaluate(script, url);
    let sound = null, canplay = null;
    for (let i = 0; i < 400; i++) {
      await sleep(100);
      const s = await page.evaluate(() => ({
        el: window.__els.map((a) => ({ tag: a.__tag, ct: +a.currentTime.toFixed(2), rs: a.readyState, ns: a.networkState, buf: +(a.buffered.length ? a.buffered.end(0) : 0).toFixed(1) })),
        ev: window.__ev.filter((e) => e.k === 'ev:canplay').map((e) => e.el),
      }));
      if (canplay === null && s.ev.includes(1)) canplay = Date.now() - t0;
      if (s.el[0] && s.el[0].ct > 0.5) { sound = Date.now() - t0; break; }
      if (i % 40 === 39) console.log(`   [${label}] ${((Date.now() - t0) / 1000).toFixed(0)}s 状态:`, JSON.stringify(s.el));
    }
    const ev = await page.evaluate(() => window.__ev);
    console.log(`== ${label} ==  首元素 canplay ${canplay === null ? '未达' : canplay + 'ms'} | 出声 ${sound === null ? '❌未出声' : sound + 'ms'}`);
    for (const e of ev) console.log('    ' + String(e.t).padStart(6) + 'ms  ' + e.k + (e.el ? ' el#' + e.el : '') + (e.buf ? ' buf=' + e.buf : ''));
    console.log('');
    await ctx.close();
    return { label, canplay, sound };
  }

  const r1 = await run('A 只有一个音乐元素（crossOrigin + preload=auto）', (u) => {
    const a = window.__create(true); a.src = u; a.play().catch(() => {});
  });

  const r2 = await run('B 音乐 + 另一个媒体同时在播（复刻 DJ 时序：250ms 后启第二个）', async (u) => {
    const music = window.__create(true); music.src = u; music.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    const other = window.__create(true); other.volume = 0.0001; other.src = u; other.play().catch(() => {});
  });

  await browser.close();
  console.log('== 汇总 ==');
  console.log('  A 单元素        :', r1.canplay === null ? '未达' : r1.canplay + 'ms');
  console.log('  B 双元素并发    :', r2.canplay === null ? '未达' : r2.canplay + 'ms');
  console.log('  差额            :', r1.canplay !== null && r2.canplay !== null ? (r2.canplay - r1.canplay) + 'ms' : 'n/a');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
