/**
 * 预检：blob: URL 作为 music 源（crossOrigin="anonymous"）经 WebAudio 取色/出声是否正常。
 *
 * 背景：为绕开 COS mp3 没有 Cache-Control 的问题，计划把下一首整首 fetch → blob →
 *       createObjectURL 后交给 <audio>。唯一风险是「blob 源 + crossOrigin=anonymous +
 *       createMediaElementSource」是否被判为异源污染 → 静音 / analyser 全 0。
 *
 * 做法：在 http://127.0.0.1 页面内（安全上下文）对比两种源：blob: 与 COS 直链，
 *       各播 1.5s，比较 currentTime 推进 + analyser 波形峰值。
 */
const http = require("http");
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";
const PORT = 8793;

const PAGE = `<!doctype html><meta charset="utf-8"><title>blob audio test</title><body>ready</body>`;

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
    });
    s.listen(PORT, "127.0.0.1", () => resolve(s));
  });
}

const TEST = async () => {
  const B = "https://ai-radio-library-1463614289.cos.ap-nanjing.myqcloud.com";
  const out = { errors: [] };
  try {
    const m = await (await fetch(B + "/manifest.json")).json();
    const song = m.songs[0];
    const url = B + "/songs/" + encodeURIComponent(song.file);
    out.song = song.id + " " + song.file;
    out.manifestSongs = m.songs.length;

    // ---- 取 blob ----
    const t0 = performance.now();
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    out.fetchMs = Math.round(performance.now() - t0);
    out.blobKB = Math.round(blob.size / 1024);
    const blobUrl = URL.createObjectURL(blob);
    out.blobUrlPrefix = blobUrl.slice(0, 12);

    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const silent = ctx.createGain();
    silent.gain.value = 0; // 观测用：图仍在处理，但不外放
    silent.connect(ctx.destination);

    const probe = async (label, src) => {
      const el = new Audio();
      el.crossOrigin = "anonymous";
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      let srcNode = null;
      try {
        srcNode = ctx.createMediaElementSource(el);
        srcNode.connect(analyser).connect(silent);
      } catch (e) {
        out.errors.push(label + " createMediaElementSource: " + e.message);
      }
      el.src = src;
      const r = { label, srcKind: src.startsWith("blob:") ? "blob" : "cos-direct", played: false, t1: 0, peak: 0 };
      try {
        await el.play();
        r.played = true;
      } catch (e) {
        r.playError = e.name + ": " + e.message;
      }
      const buf = new Uint8Array(analyser.fftSize);
      const t1 = performance.now();
      for (let i = 0; i < 30; i++) {
        await new Promise((res2) => setTimeout(res2, 50));
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        r.peak = Math.max(r.peak, peak);
      }
      r.t1 = +el.currentTime.toFixed(2);
      r.elapsedMs = Math.round(performance.now() - t1);
      r.readyState = el.readyState;
      el.pause();
      try { srcNode && srcNode.disconnect(); } catch { /* noop */ }
      return r;
    };

    out.blobProbe = await probe("blob", blobUrl);
    out.cosProbe = await probe("cos", url);
    URL.revokeObjectURL(blobUrl);
  } catch (e) {
    out.errors.push("fatal: " + e.message);
  }
  return out;
};

(async () => {
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[page-error]", m.text().slice(0, 160));
    });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    const r = await page.evaluate(TEST);
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})();
