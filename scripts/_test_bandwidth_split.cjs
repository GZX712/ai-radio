/**
 * 带宽账本实验（空白页，零 App 代码）：8 Mbps 档下
 *   1) 裸 fetch 真实吞吐（判断"限速档到底给了多少带宽"）
 *   2) 单个 music 元素 alone → canplay 耗时
 *   3) music + 同时下载一个 DJ 语音大小(~110KB)的 mp3 → canplay 耗时（判断抢带宽是否成立）
 * 目的：给「卡壳」定因 —— 是文件太大，还是 DJ 与音乐并发互抢。
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const COS = 'https://ai-radio-library-1463614289.cos.ap-nanjing.myqcloud.com';
const MBPS = Number(process.env.MBPS || 8);
const MEDIA = { downloadThroughput: Math.round((MBPS * 1024 * 1024) / 8), uploadThroughput: Math.round((3 * 1024 * 1024) / 8), latency: 60 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const m = await (await fetch(COS + '/manifest.json')).json();
  const song = m.songs.find((s) => s.file.includes('My bedroom')) || m.songs[0];
  const url = `${COS}/songs/${encodeURIComponent(song.file)}`;
  const total = Number((await fetch(url, { headers: { Range: 'bytes=0-1' } }).then((r) => (r.headers.get('content-range') || '0/0').split('/')[1])));
  const dj = m.songs[1] ? `${COS}/songs/${encodeURIComponent(m.songs[1].file)}` : url;
  const djSize = Number((await fetch(dj, { headers: { Range: 'bytes=0-1' } }).then((r) => (r.headers.get('content-range') || '0/0').split('/')[1])));
  console.log(`曲目: ${song.file} | ${(total / 1024 / 1024).toFixed(2)} MB | 估计码率 ${(total * 8 / (song.duration || 95) / 1000).toFixed(0)} kbps`);
  console.log(`限速档: ${MBPS} Mbps ≈ ${Math.round(MEDIA.downloadThroughput / 1024)} KB/s\n`);

  const browser = await PW.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...MEDIA });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('about:blank');
    return { ctx, page };
  };

  // ---- 1) 裸 fetch 吞吐（取前 2.4MB，通常正是 Chrome 起播预读量）----
  {
    const { ctx, page } = await mk();
    const r = await page.evaluate(async ([u]) => {
      const t0 = performance.now();
      const res = await fetch(u, { headers: { Range: 'bytes=0-2516582' } }); // 2.4MB
      const buf = await res.arrayBuffer();
      const dt = (performance.now() - t0) / 1000;
      return { bytes: buf.byteLength, sec: +dt.toFixed(2), kbps: Math.round(buf.byteLength / 1024 / dt) };
    }, [url]);
    console.log(`① 裸 fetch 2.4MB: ${r.sec}s → 实际吞吐 ${r.kbps} KB/s（设定上限 ${Math.round(MEDIA.downloadThroughput / 1024)} KB/s）`);
    await ctx.close();
  }

  // ---- 2/3) 媒体元素对照 ----
  async function run(label, script) {
    const { ctx, page } = await mk();
    await page.addInitScript(() => {
      window.__ev = []; window.__els = [];
      window.__M = (k, e) => window.__ev.push({ k, t: Math.round(performance.now()), ...(e || {}) });
      window.__watch = (el) => {
        if (!el || el.__w) return; el.__w = 1; el.__tag = window.__els.push(el);
        for (const ev of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error']) {
          el.addEventListener(ev, () => window.__M('ev:' + ev, { el: el.__tag, buf: el.buffered.length ? +el.buffered.end(el.buffered.length - 1).toFixed(1) : 0 }));
        }
      };
      window.__create = () => { const a = new Audio(); a.crossOrigin = 'anonymous'; a.preload = 'auto'; window.__watch(a); return a; };
    });
    const t0 = Date.now();
    await page.goto('about:blank'); // addInitScript 只对"之后的导航"生效，必须再走一次
    await page.evaluate(script, [url, dj]);
    let canplay = null, sound = null;
    for (let i = 0; i < 300; i++) {
      await sleep(100);
      const s = await page.evaluate(() => ({
        el: window.__els.map((a) => ({ tag: a.__tag, ct: +a.currentTime.toFixed(2), rs: a.readyState, ns: a.networkState, buf: +(a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0).toFixed(1) })),
        cp: window.__ev.filter((e) => e.k === 'ev:canplay').map((e) => e.el),
      }));
      if (canplay === null && s.cp.includes(1)) canplay = Date.now() - t0;
      if (s.el[0] && s.el[0].ct > 0.5 && !sound) { sound = Date.now() - t0; break; }
    }
    const ev = await page.evaluate(() => window.__ev);
    console.log(`\n== ${label} ==  canplay(el#1) ${canplay}ms | 出声 ${sound}ms`);
    for (const e of ev.filter((x) => /canplay|loadedmetadata|stalled|error/.test(x.k))) {
      console.log('    ' + String(e.t).padStart(7) + 'ms  ' + e.k + ' el#' + e.el + ' buf=' + e.buf);
    }
    await ctx.close();
    return { canplay, sound };
  }

  const A = await run('A 单个 music 元素', ([u]) => {
    const a = window.__create(); a.src = u; a.play().catch(() => {});
  });

  const B = await run('B music + 同时下一个整首(模拟 DJ 语音抢占)', async ([u, d]) => {
    const a = window.__create(); a.src = u; a.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    const o = window.__create(); o.volume = 0.0001; o.src = d; o.play().catch(() => {});
  });

  const C = await run('C music + 仅预取前 128KB(模拟 DJ 语音真实体积)', async ([u, d]) => {
    const a = window.__create(); a.src = u; a.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    await fetch(d, { headers: { Range: 'bytes=0-131072' } }).then((r) => r.arrayBuffer());
  });

  // D：决定性问题 —— 第二个是"正在播放的小音频"（复刻 DJ 语音），
  //    体积只有 128KB，若 music 仍被大幅拖延 → 是调度/优先级问题，不是带宽问题
  const D = await run('D music + 正在播放的 128KB 小音频(真 DJ 场景)', async ([u, d]) => {
    const a = window.__create(); a.src = u; a.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    const buf = await fetch(d, { headers: { Range: 'bytes=0-131072' } }).then((r) => r.arrayBuffer());
    const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
    const o = window.__create(); o.volume = 0.0001; o.src = blobUrl; o.play().catch(() => {});
  });

  await browser.close();
  console.log('\n===== 汇总 =====');
  console.log(`  A 单个元素              canplay ${A.canplay}ms`);
  console.log(`  B +整首并发             canplay ${B.canplay}ms  (差 ${B.canplay - A.canplay}ms)`);
  console.log(`  C +128KB 并发(download) canplay ${C.canplay}ms  (差 ${C.canplay - A.canplay}ms)`);
  console.log(`  D +128KB 正在播放       canplay ${D.canplay}ms  (差 ${D.canplay - A.canplay}ms)`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
