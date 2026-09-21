/**
 * 起播策略对照：同一首歌 + 同一限速，只改 preload 策略，看「多久能出声」。
 * 背景：实测 Chrome 起播前会预读约 2.4MB（约占 3.77MB 文件的 62%），
 * 慢网下这就是 12.7 秒 —— 这才是手机端"点了半天不出声"的真因。
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const COS = 'https://ai-radio-library-1463614289.cos.ap-nanjing.myqcloud.com';
const NET = process.env.NET || 'slow4g';
const MAP = {
  slow4g: { downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8), uploadThroughput: Math.round(750 * 1024 / 8), latency: 150 },
  fourg: { downloadThroughput: Math.round(8 * 1024 * 1024 / 8), uploadThroughput: Math.round(2 * 1024 * 1024 / 8), latency: 60 },
  wifi: { downloadThroughput: -1, uploadThroughput: -1, latency: 20 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const m = await (await fetch(COS + '/manifest.json')).json();
  const song = m.songs.find((s) => s.file.includes('My bedroom')) || m.songs[0];
  const url = `${COS}/songs/${encodeURIComponent(song.file)}`;
  console.log(`曲目 ${song.file}  |  限速 ${NET}\n`);

  const browser = await PW.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const rows = [];

  async function run(label, script) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__ev = []; window.__els = [];
      window.__M = (k, e) => window.__ev.push({ k, t: Math.round(performance.now()), ...(e || {}) });
      window.__watch = (el) => {
        if (!el || el.__w) return; el.__w = 1; el.__tag = window.__els.length + 1; window.__els.push(el);
        for (const ev of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'progress']) {
          el.addEventListener(ev, () => window.__M('ev:' + ev, { el: el.__tag, buf: el.buffered.length ? +el.buffered.end(0).toFixed(1) : 0 }));
        }
      };
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...(MAP[NET] || MAP.slow4g) });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('about:blank');
    const t0 = Date.now();
    await page.evaluate(script, url);
    let sound = null;
    for (let i = 0; i < 600; i++) {
      await sleep(100);
      const s = await page.evaluate(() => ({ t: Math.round(performance.now()), els: window.__els.map((a) => ({ ct: +a.currentTime.toFixed(2), rs: a.readyState, buf: +(a.buffered.length ? a.buffered.end(0) : 0).toFixed(1) })) }));
      if (s.els[0] && s.els[0].ct > 0.5) { sound = Date.now() - t0; break; }
    }
    const ev = await page.evaluate(() => window.__ev);
    const first = (k) => { const e = ev.find((x) => x.k === k); return e ? e.t : null; };
    rows.push({ label, sound, meta: first('ev:loadedmetadata'), canplay: first('ev:canplay'), bufAtMeta: (ev.find((x) => x.k === 'ev:loadedmetadata') || {}).buf });
    console.log(`== ${label} ==`);
    console.log(`   出声 ${sound === null ? '❌未出声' : sound + 'ms'} | loadedmetadata ${first('ev:loadedmetadata')}ms (buf=${rows[rows.length - 1].bufAtMeta}s) | canplay ${first('ev:canplay')}ms`);
    for (const e of ev.slice(0, 14)) console.log('     ' + String(e.t).padStart(6) + 'ms  ' + e.k + (e.buf ? ' buf=' + e.buf : ''));
    console.log('');
    await ctx.close();
  }

  await run('1) preload=auto（当前线上）', (u) => { const a = new Audio(); a.crossOrigin = 'anonymous'; a.preload = 'auto'; window.__watch(a); a.src = u; a.play().catch(() => {}); });
  await run('2) preload=metadata', (u) => { const a = new Audio(); a.crossOrigin = 'anonymous'; a.preload = 'metadata'; window.__watch(a); a.src = u; a.play().catch(() => {}); });
  await run('3) preload=none + load()+play()', (u) => { const a = new Audio(); a.crossOrigin = 'anonymous'; a.preload = 'none'; window.__watch(a); a.src = u; a.load(); a.play().catch(() => {}); });
  await run('4) fetch→Blob→播放（整首下完才出声）', async (u) => {
    const a = new Audio(); a.crossOrigin = 'anonymous'; window.__watch(a);
    const b = await (await fetch(u)).blob();
    window.__M('fetchDone', { kb: Math.round(b.size / 1024) });
    a.src = URL.createObjectURL(b); a.play().catch(() => {});
  });

  await browser.close();
  console.log('== 汇总（' + NET + '）==');
  for (const r of rows) console.log('  ' + r.label.padEnd(34) + ' 出声 ' + (r.sound === null ? '未出声' : r.sound + 'ms'));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
