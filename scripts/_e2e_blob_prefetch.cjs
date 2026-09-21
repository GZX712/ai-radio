/**
 * 端到端验证「预取下一首 → 切歌命中本地 Blob」。
 *
 * 断链：/api/peek 只在本地新后端里有（线上还没部署），所以必须跑本地后端 8787。
 * 判定成功：某个 <audio> 元素的 src 在某刻变成 `blob:` —— 说明
 *   ① 85% 阈值触发了 /api/peek ②整首 fetch 成 Blob 成功 ③ loadAndPlay 命中缓存。
 * 附带记录：songs/*.mp3 的网络请求次数（blob 播放不应再产生媒体请求）。
 */
const PW = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";
const URL = process.env.E2E_URL || "http://127.0.0.1:8787/";
const SHOT_DIR = "D:/Workspace/AI工作空间仓库/ai-radio/shots";
const MAX_MS = Number(process.env.MAX_MS || 14 * 60 * 1000);
const STEP_MS = 10_000;

(async () => {
  const report = { url: URL, started: false, samples: [], blobSeen: null, mp3Req: {}, errs: [], peekCalls: [] };
  const browser = await PW.chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

  page.on("pageerror", (e) => report.errs.push("PAGEERR " + String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") report.errs.push("CONSOLE " + m.text().slice(0, 160)); });
  page.on("request", (r) => {
    const u = r.url();
    if (/\/api\/peek/.test(u)) report.peekCalls.push(Date.now());
    if (/\.mp3(\?|$)/.test(u)) {
      const k = r.resourceType() + " " + u.split("/").pop().slice(0, 46);
      report.mp3Req[k] = (report.mp3Req[k] || 0) + 1;
    }
  });

  await page.addInitScript(() => {
    window.__audios = [];
    const Orig = window.Audio;
    function Patched(...a) {
      const el = new Orig(...a);
      el.__srcLog = [];
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      try {
        Object.defineProperty(el, "src", {
          get: () => desc.get.call(el),
          set: (v) => { el.__srcLog.push(String(v).slice(0, 40)); return desc.set.call(el, v); },
          configurable: true,
        });
      } catch { /* 定义失败：退化为直接读属性 */ }
      window.__audios.push(el);
      return el;
    }
    Patched.prototype = Orig.prototype;
    window.Audio = Patched;
    // 记录预取产生的 blob 数量
    window.__blobCount = 0;
    const oc = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__blobCount += 1; return oc(b); };
  });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (const sel of ["text=开始电台", "text=开始收听", "text=进入电台", 'button:has-text("开始")', "text=绑定并开始"]) {
    try {
      const el = await page.$(sel);
      if (el) { await el.click({ timeout: 2000 }); report.started = true; report.clickedSel = sel; break; }
    } catch { /* 试下一个选择器 */ }
  }

  const t0 = Date.now();
  while (Date.now() - t0 < MAX_MS) {
    await page.waitForTimeout(STEP_MS);
    const snap = await page.evaluate(() => {
      const audios = (window.__audios || []).map((a) => ({
        src: String(a.src || "").slice(0, 46),
        kind: String(a.src || "").startsWith("blob:") ? "blob" : (/\.mp3/.test(a.src || "") ? "cos" : "other"),
        paused: a.paused,
        ct: +(a.currentTime || 0).toFixed(1),
        dur: +(a.duration || 0).toFixed(1),
        pct: a.duration ? Math.round((a.currentTime / a.duration) * 100) : 0,
        rs: a.readyState,
        srcLog: (a.__srcLog || []).slice(-3).map((s) => s.slice(0, 34)),
      }));
      return { audios, blobCount: window.__blobCount || 0 };
    }).catch((e) => ({ audios: [], blobCount: 0, err: String(e).slice(0, 120) }));

    const music = snap.audios.find((a) => a.kind !== "other") || snap.audios[0] || {};
    const blobAudio = snap.audios.find((a) => a.kind === "blob");
    report.samples.push({
      at: Math.round((Date.now() - t0) / 1000) + "s",
      music: { kind: music.kind, ct: music.ct, dur: music.dur, pct: music.pct, paused: music.paused, rs: music.rs, srcLog: music.srcLog },
      blobCount: snap.blobCount,
      blobAudio: blobAudio ? { ct: blobAudio.ct, paused: blobAudio.paused, rs: blobAudio.rs } : null,
    });
    if (blobAudio && !report.blobSeen) {
      report.blobSeen = { at: Math.round((Date.now() - t0) / 1000) + "s", ct: blobAudio.ct, rs: blobAudio.rs, paused: blobAudio.paused };
    }
    if (report.blobSeen && blobAudio && blobAudio.ct > 3) break; // blob 已稳定播 3 秒 → 结论拿到
    // 增量落盘：跑的过程中也能看到进度（不必等最后一次）
    fs.writeFileSync(path.join(SHOT_DIR, "_e2e_prefetch.partial.json"), JSON.stringify(report, null, 2), "utf8");
  }

  report.peekCallCount = report.peekCalls.length;
  await page.screenshot({ path: path.join(SHOT_DIR, "_e2e_prefetch.png") }).catch(() => {});
  await browser.close();
  fs.writeFileSync(path.join(SHOT_DIR, "_e2e_prefetch.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ blobSeen: report.blobSeen, peekCallCount: report.peekCallCount, mp3Req: report.mp3Req, errs: report.errs.slice(0, 6), lastSamples: report.samples.slice(-6) }, null, 2));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
