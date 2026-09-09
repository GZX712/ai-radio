import express from "express";
import cors from "cors";
import http from "node:http";
import { WebSocketServer } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { musicQueue } from "./services/musicQueue";
import { generateDJLine, setDjBroadcast, setCurrentPersonality, pushOnAir, generateGuestGreeting, getCurrentPersonality, pickSpeakText, restoreOnAir } from "./services/dj";
import { buildTransitionScript } from "./services/djScripts";
import { djThrottleCanSpeak, djThrottleMarkSpoke } from "./services/djThrottle";
import { initHistoryDb, recentEvents } from "./services/historyDb";
import {
  CLAIM_TOKEN,
  signBond,
  verifyBond,
  resolveRole,
  noteGuestDevice,
  classifyDevice,
  guestCount,
  loadGuests,
  shouldGreetAgain,
  markGreeted,
} from "./services/deviceIdentity";
import { getOwnerSettings, saveOwnerSettings } from "./services/ownerStore";
import { getSongProfile, getCachedSongProfile, warmSongProfile } from "./services/songKnowledge";
import { ttsService } from "./services/tts";
import { scheduler, setBroadcast as setSchedulerBroadcast } from "./services/scheduler";
import { weatherService } from "./services/weather";
import { triviaService, type TriviaCategory } from "./services/trivia";
import { withDjLock } from "./services/djBusy";
import { Readable } from "node:stream";
import { musicService, neteaseNodeStatus, isCosLibraryMode, type NeteaseSong } from "./services/music";
import { regeneratePhraseBank, phraseBankStatus } from "./services/phraseBank";
import { loadEnv } from "./services/env";

// ============== .env 加载（必须在读取任何 process.env 之前）==============
loadEnv();

// ============== 设备客人档案加载（主人身份无状态验签，不依赖此文件） ==============
loadGuests().catch(() => {});

// ============== 历史持久化初始化（SQLite：播出记忆 + 对话，重启回填不失忆） ==============
initHistoryDb();
try {
  const seed = recentEvents(["song", "dj"], 10);
  if (seed.length > 0) restoreOnAir(seed.map((e) => ({ kind: e.kind as "song" | "dj", text: e.text, ts: e.ts })));
} catch {
  /* 回填失败不影响启动 */
}

// ============== Netease 服务保活 ==============
// Render 免费版 15 分钟无请求会自动 spin down；保活定时任务每 5 分钟 ping 一次
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
function startNeteaseKeepalive() {
  if (keepaliveTimer) return;
  if (!process.env.NETEASE_BASE) return; // 本地开发（sub-process 模式）跳过
  const target = `${process.env.NETEASE_BASE}/`;
  const ping = () => {
    fetch(target, { method: "HEAD", signal: AbortSignal.timeout(5000) })
      .then(() => console.log("[keepalive] netease alive ✓"))
      .catch((err) => console.warn("[keepalive] netease ping fail:", err instanceof Error ? err.message : err));
  };
  ping(); // 启动时立即 ping 一次
  keepaliveTimer = setInterval(ping, 5 * 60 * 1000);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 8787;
const NETEASE_PORT = 3000;

// 部署到 Render 时：NETEASE_BASE 已指向外部网易云 API 服务，跳过子进程启动
const IS_DEPLOYED = !!process.env.NETEASE_BASE;

app.use(cors());
// limit 放宽：主人云端档案含 dataURL 头像（数百 KB），默认 100kb 会 413
app.use(express.json({ limit: "15mb" }));

// 静态文件：TTS 生成的 mp3（前端 /audio/dj-xxx.mp3 拉取）
const AUDIO_DIR = ttsService.getAudioDir();
app.use("/audio", express.static(AUDIO_DIR, { maxAge: "1h" }));

// ============== 音乐流代理 ==============
// 前端页面是 HTTPS，浏览器加载 http:// 网易云流会被 Mixed Content 拦截 → 疯狂跳歌。
// 这里后端用 http 拉流（带 UA/Referer 防盗链头），完整缓冲后转发给前端（同源 https）。
// 不用流式转发：Readable.fromWeb 在 Node 20 有兼容问题 + 浏览器 Range 请求 206 缺 Content-Range 会不播。
app.get("/api/proxy-audio", async (req, res) => {
  const raw = String(req.query.url || "");
  if (!raw) {
    res.status(400).json({ code: 400, message: "缺少 url" });
    return;
  }
  const upstreamUrl = raw.replace(/^https:/, "http:"); // 网易云防盗链只认 http
  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Referer: "https://music.163.com/",
    };
    // Range 透传（audio 元素 seek / 续播进度 / 拖进度条都需要）
    // 浏览器请求代理时带 Range: bytes=xxx- → 原样转发给网易 CDN → CDN 回 206
    // + Content-Range → 代理同样转发。这让 audio 支持随机 seek，不再被
    // "Accept-Ranges: none 整段缓冲"锁死（续播从第 37s 恢复全靠它）。
    const range = req.headers.range;
    if (range) headers.Range = String(range);
    const upstream = await fetch(upstreamUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    // 206（partial）也是成功，必须放行
    if (!upstream.ok && upstream.status !== 206) {
      res.status(502).json({ code: 502, message: `upstream ${upstream.status}` });
      return;
    }
    res.status(upstream.status === 206 ? 206 : 200);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=300");
    // 流式转发（不再整段 buffer 到内存：12MB 歌不再等全部下完才出声，
    // 也消除大文件 25s 超时风险）。带背压：res.write 返回 false 时等 drain
    const reader = upstream.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }
    res.flushHeaders?.();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
      res.end();
    } catch {
      res.destroy();
    }
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ code: 502, message: err instanceof Error ? err.message : "proxy fail" });
    else res.destroy();
  }
});

// ============== 启动网易云 API 子进程（仅本地开发用） ==============
let neteaseProc: ReturnType<typeof spawn> | null = null;

function startNeteaseApi() {
  if (IS_DEPLOYED) {
    console.log(`[AI-Radio] 已部署模式：使用外部 NETEASE_BASE=${process.env.NETEASE_BASE}，跳过子进程启动`);
    return;
  }
  const neteaseDir = path.resolve(__dirname, "../vendor/NeteaseCloudMusicApi");
  console.log(`[AI-Radio] 启动网易云 API 子进程 (port ${NETEASE_PORT})...`);

  neteaseProc = spawn("node", ["app-fixed.js"], {
    cwd: neteaseDir,
    env: { ...process.env, PORT: String(NETEASE_PORT), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  neteaseProc.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[netease] ${chunk.toString().trim()}`);
  });
  neteaseProc.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[netease][err] ${chunk.toString().trim()}`);
  });
  neteaseProc.on("exit", (code) => {
    console.log(`[netease] 进程退出 code=${code}，5 秒后自动重启`);
    // 自动重启：netease 子进程崩了音乐就断，必须拉起
    setTimeout(() => {
      if (!IS_DEPLOYED) startNeteaseApi();
    }, 5000);
  });
}

startNeteaseApi();

// ============== 路由 ==============
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    queue: musicQueue.getQueueInfo(),
    scheduler: { trackCount: scheduler.getTrackCount() },
    netease: neteaseNodeStatus(),
    // [诊断 2026-09-06] cookie 状态（不返回完整值，仅长度+前几位脱敏）— Render 出口 IP 被风控时
    // 确认 NETEASE_COOKIE 是否还生效（VIP 歌需要登录态才能拿到 URL）
    cookie: process.env.NETEASE_COOKIE
      ? { set: true, length: process.env.NETEASE_COOKIE.length, prefix: process.env.NETEASE_COOKIE.slice(0, 12) + "..." }
      : { set: false },
    envPlaylistId: process.env.PLAYLIST_ID || "(not set, using default)",
    musicMode: isCosLibraryMode()
      ? { cos: true, base: (process.env.COS_BASE_URL || "").replace(/\/+$/, "") }
      : { cos: false, neteaseNodes: neteaseNodeStatus().nodes.length },
  });
});

app.get("/api/now", async (_req, res) => {
  try {
    const song = await musicQueue.current();
    res.json({ code: 0, data: song });
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "拉取当前播放失败",
    });
  }
});

app.post("/api/next", async (_req, res) => {
  try {
    const previousSong = await musicQueue.current();
    // 首播判定：切到新歌前从未消费过队列（打开电台第一次取歌）→ 不广播 LLM 串场，
    // 只留 /api/dj/open 的开场白一句，避免"开场白 + 串场介绍"叠着说（辛老师反馈语音太密集）
    const wasConsumed = musicQueue.getConsumedCount();
    const song = await musicQueue.next();
    res.json({ code: 0, data: song });
    broadcast({ type: "songChange", data: song });
    warmSongProfile(song); // [2026-09-07] 切歌后预热背景档案（聊天答歌问/切歌介绍引用）

    // 调度器计数 + DJ 串场（异步）
    scheduler.onTrackChange().catch((err) =>
      console.error("[Scheduler] onTrackChange 失败:", err)
    );
    if (song && wasConsumed > 0) {
      triggerDJTransition(previousSong, song).catch((err) =>
        console.error("[DJ] 串场失败:", err)
      );
    }
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "切歌失败",
    });
  }
});

app.post("/api/prev", async (_req, res) => {
  try {
    const wasConsumed = musicQueue.getConsumedCount();
    const song = await musicQueue.prev();
    res.json({ code: 0, data: song });
    broadcast({ type: "songChange", data: song });
    warmSongProfile(song); // [2026-09-07] 切歌后预热背景档案（聊天答歌问/切歌介绍引用）
    if (song && wasConsumed > 0) {
      triggerDJTransition(null, song).catch((err) =>
        console.error("[DJ] 上首串场失败:", err)
      );
    }
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "上一首失败",
    });
  }
});

app.post("/api/skip", async (_req, res) => {
  try {
    const previousSong = await musicQueue.current();
    const wasConsumed = musicQueue.getConsumedCount();
    const song = await musicQueue.skip();
    res.json({ code: 0, data: song });
    broadcast({ type: "songChange", data: song });
    warmSongProfile(song); // [2026-09-07] 切歌后预热背景档案（聊天答歌问/切歌介绍引用）

    scheduler.onTrackChange().catch((err) =>
      console.error("[Scheduler] onTrackChange 失败:", err)
    );
    if (song && wasConsumed > 0) {
      triggerDJTransition(previousSong, song).catch((err) =>
        console.error("[DJ] 串场失败:", err)
      );
    }
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "切歌失败",
    });
  }
});

// ============== DJ 触发 ==============

/**
 * 切歌过渡语（transition jingle）：预生成的短句音频，随 skip/next/prev 接口**同步**返回。
 * 前端拿到后先播过渡语（DJ 立即开口，不等 LLM），音乐随后无缝起；
 * 详细介绍（LLM+TTS，2-5s）到了再排队接上 —— 解决"歌先出 DJ 没说话 / DJ 先说歌卡顿"的竞态。
 */
/**
 * 切歌 DJ 播报（v3 · [2026-09-07] 冷却 + 安全话术池）：
 * - 冷却：djThrottle 15 分钟窗口，防止"话术太密"——冷却中切歌 DJ 静默（音乐照切）
 * - 话术：djScripts 模板池（0 LLM），杜绝张冠李戴/念怪/编造——
 *   歌名仅纯 ASCII 才偶尔念；星期/时段/天气/冷笑话轮抽
 * - 朗读语言：按当前音色自动选 en/zh（与聊天回复声音一致）
 * - TTS 失败 → 静默（音乐不受影响，绝不阻塞切歌）
 */
async function triggerDJTransition(
  previousSong: NeteaseSong | null,
  currentSong: NeteaseSong
) {
  if (!djThrottleCanSpeak()) {
    console.log("[DJ] 冷却中，切歌静默（音乐照切）");
    return;
  }
  try {
    // 北京时间星期 + 小时（话术变量：星期梗/时段梗）
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
    const wdMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    const weekday = wdMap[parts.find((p) => p.type === "weekday")?.value ?? ""] ?? 0;

    // 天气缓存（0 延迟；拿不到 → 模板池自动落到星期/冷笑话，不阻塞）
    const w = scheduler.getLastWeather() as { city: string; description: string; temperature: number } | null;

    const script = buildTransitionScript({
      song: currentSong ? { name: currentSong.name, artist: currentSong.artist } : null,
      weather: w,
      hour,
      weekday,
    });

    const audio = await ttsService.synthesize(
      pickSpeakText(script.en, script.zh),
      "dj",
      getCurrentPersonality().voice,
      getCurrentPersonality().traits,
    );
    // 切歌冷笑话 → 播完配罐头笑声（funny 标记）
    broadcast({ type: "dj", ...script, audioUrl: audio.url, provider: "script", funny: script.funny, timestamp: Date.now() });
    djThrottleMarkSpoke();
    console.log("[DJ] 切歌话术:", script.en.slice(0, 60));
  } catch (err) {
    console.warn("[DJ] 切歌话术失败(静默):", err instanceof Error ? err.message : err);
  }
}

app.post("/api/dj/open", async (_req, res) => {
  try {
    const currentSong = await musicQueue.current();
    const dj = await generateDJLine({
      scene: "open",
      song: currentSong ?? undefined,
    });
    broadcast({ type: "dj", ...dj });
    res.json({ code: 0, data: dj });
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "DJ 开场失败",
    });
  }
});

app.post("/api/location", (req, res) => {
  try {
    const { lat, lon, city } = req.body as { lat?: number; lon?: number; city?: string };
    if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) {
      res.status(400).json({ code: 400, message: "缺少有效坐标" });
      return;
    }
    weatherService.setUserLocation(lat, lon, city || "当前位置");
    res.json({ code: 0, message: "定位已更新" });
  } catch (err) {
    res.status(500).json({ code: 500, message: "定位失败" });
  }
});

app.post("/api/dj/trigger", async (req, res) => {
  try {
    const { scene } = req.body as { scene?: "open" | "transition" | "trivia" | "weather" };
    const currentSong = await musicQueue.current();
    const dj = await generateDJLine({
      scene: scene ?? "trivia",
      song: currentSong ?? undefined,
    });
    broadcast({ type: "dj", ...dj });
    res.json({ code: 0, data: dj });
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "DJ 触发失败",
    });
  }
});

app.get("/api/weather", async (_req, res) => {
  try {
    const w = await weatherService.getCurrent();
    res.json({ code: 0, data: w });
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "拉取天气失败",
    });
  }
});

app.post("/api/trivia", async (req, res) => {
  try {
    const { category } = req.body as { category?: TriviaCategory };
    const t = await triviaService.generate(category);
    res.json({ code: 0, data: t });
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "生成趣闻失败",
    });
  }
});

// ============== TTS 试听 + 音色目录 ==============
app.post("/api/tts/preview", async (req, res) => {
  try {
    const { voice, style } = req.body as { voice?: string; style?: string };
    if (!voice) {
      res.status(400).json({ code: 400, message: "缺少 voice 参数" });
      return;
    }
    // 试听短句（中英都来一句，让用户感知音色）
    const text = "Hi, I'm your AI Radio DJ — this is what I sound like. 嗨，我是你的 AI 电台 DJ，这是我说话的声音。";
    const audio = await ttsService.synthesize(text, "preview", voice, style);
    res.json({ code: 0, data: { url: audio.url, voice } });
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "试听合成失败",
    });
  }
});

app.get("/api/voices", (_req, res) => {
  res.json({ code: 0, data: ttsService.getVoiceCatalog() });
});

// ============== MiMo 诊断 ==============
// 在 Render 服务器上直接请求小米 API，返回详细状态（判断是环境变量/网络/IP 哪个问题）
app.get("/api/dj/mimo-diag", async (_req, res) => {
  const key = process.env.MIMO_API_KEY || "";
  const base = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
  const out: Record<string, unknown> = {
    hasKey: !!key,
    keyPrefix: key ? key.slice(0, 6) + "..." : "",
    keyLen: key.length,
    base,
  };
  if (!key) {
    out.conclusion = "MIMO_API_KEY 未配置（环境变量没注入）";
    res.json({ code: 0, data: out });
    return;
  }
  try {
    const t0 = Date.now();
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": key },
      body: JSON.stringify({
        model: process.env.MIMO_MODEL || "mimo-v2.5-tts",
        messages: [{ role: "assistant", content: "你好，测试。" }],
        audio: { format: "mp3", voice: "冰糖" },
      }),
      signal: AbortSignal.timeout(20000),
    });
    out.httpStatus = resp.status;
    out.latencyMs = Date.now() - t0;
    const body = await resp.text().catch(() => "");
    out.bodyPreview = body.slice(0, 300);
    if (resp.ok) {
      try {
        const j = JSON.parse(body);
        const b64 = j?.choices?.[0]?.message?.audio?.data;
        out.audioB64Len = b64 ? b64.length : 0;
        out.conclusion = b64 ? "MiMo API 正常，返回音频" : "MiMo API 200 但无音频数据";
      } catch {
        out.conclusion = "MiMo API 200 但响应不是 JSON";
      }
    } else {
      out.conclusion = `MiMo API 拒绝：HTTP ${resp.status}`;
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    out.conclusion = "网络错误（连不上 api.xiaomimimo.com）";
  }
  res.json({ code: 0, data: out });
});

// ============== 话术库管理 ==============
app.get("/api/phrase/status", (_req, res) => {
  res.json({ code: 0, data: phraseBankStatus() });
});
app.post("/api/phrase/refresh", (_req, res) => {
  // 立即返回，后台生成（100 条需 5-10 分钟）
  res.json({ code: 0, data: { started: true, hint: "后台生成中，查看 /api/phrase/status 轮询进度" } });
  regeneratePhraseBank("british")
    .then((n) => console.log(`[API] 话术库手动刷新完成：${n} 条`))
    .catch((err) => console.warn("[API] 话术库刷新失败:", err instanceof Error ? err.message : err));
});

// 同步 DJ personality（用户选音色/性格后立即调用，后端所有 TTS 立即生效）
app.post("/api/dj/personality", (req, res) => {
  const { gender, voice, traits, humorStyle } = (req.body || {}) as {
    gender?: "male"|"female"|"neutral";
    voice?: string;
    traits?: string;
    humorStyle?: "financial"|"medical"|"legal"|"poker"|"british"|"savage"|"none";
  };
  if (!gender) {
    res.status(400).json({ code: 400, message: "缺少 gender" });
    return;
  }
  setCurrentPersonality({
    gender,
    voice,
    traits: traits ?? "",
    humorStyle: humorStyle ?? "british",
  });
  res.json({ code: 0, message: "已同步" });
});

// ============== 调度器 ==============
app.post("/api/schedule/start", async (_req, res) => {
  try {
    await scheduler.triggerStartBroadcast();
    res.json({ code: 0, message: "手动开播成功" });
  } catch (err) {
    res.status(500).json({
      code: 500,
      message: err instanceof Error ? err.message : "手动开播失败",
    });
  }
});

app.get("/api/schedule/status", (_req, res) => {
  res.json({
    code: 0,
    data: {
      trackCount: scheduler.getTrackCount(),
      cronActive: true,
      autoOpenTime: "17:30 Asia/Shanghai",
      djInterval: 3,
      lastWeather: scheduler.getLastWeather(),
    },
  });
});

// [诊断 2026-09-06] 直接调网易云 playlist/detail，看 Render 出口 IP 是否被风控
// 返回每个节点的真实 trackIds 数量（不带 failover，依次硬调，方便排查 IP 段问题）
import { NETEASE_BASES_DIAG } from "./services/music";
app.get("/api/diag/playlist/:id", async (req, res) => {
  const playlistId = req.params.id;
  const results: any[] = [];
  for (const base of NETEASE_BASES_DIAG) {
    try {
      const url = `${base}/playlist/detail?id=${playlistId}` +
        (process.env.NETEASE_COOKIE ? `&cookie=${encodeURIComponent(process.env.NETEASE_COOKIE)}` : "");
      const t0 = Date.now();
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const ms = Date.now() - t0;
      const text = await r.text();
      let count = -1;
      let code: number | null = null;
      try {
        const j = JSON.parse(text);
        count = j?.playlist?.trackIds?.length ?? -2;
        code = j?.code ?? null;
      } catch { /* not json */ }
      results.push({ base, httpStatus: r.status, ms, bytes: text.length, trackIds: count, apiCode: code });
    } catch (e) {
      results.push({ base, error: e instanceof Error ? e.message : String(e) });
    }
  }
  res.json({ code: 0, data: results });
});

// ============== HTTP + WS 服务 ==============
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(message: unknown) {
  // [2026-09-07] 播出记忆：把 DJ 台词与切歌记入 On-Air Log，聊天时 DJ 能"记得"刚说过什么、
  // 正在放什么 → 上下文连续（index.ts 是唯一广播出口，dj/scheduler/点歌都经这里）
  const m = message as { type?: string; en?: string; data?: { name?: string; artist?: string } };
  if (m?.type === "dj" && m.en) {
    pushOnAir("dj", m.en);
  } else if (m?.type === "songChange" && m.data?.name) {
    pushOnAir("song", `"${m.data.name}"${m.data.artist ? " — " + m.data.artist : ""}`);
  }
  const text = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(text);
    }
  });
}

// ============== 设备身份：主人绑定 / 在线概览 / 客人彩蛋 ==============

/** 主人绑定：/?claim=<口令> 换长期 bond（前端存 localStorage，此后自动识别） */
app.post("/api/device/claim", (req, res) => {
  const { token, deviceId } = (req.body ?? {}) as { token?: unknown; deviceId?: unknown };
  if (typeof deviceId !== "string" || deviceId.length < 8 || deviceId.length > 80) {
    res.status(400).json({ code: 400, message: "deviceId 非法" });
    return;
  }
  if (token !== CLAIM_TOKEN) {
    res.status(403).json({ code: 403, message: "口令错误" });
    return;
  }
  res.json({ code: 0, data: { deviceId, bond: signBond(deviceId), isOwner: true } });
});

// ============== 主人云端档案：跨设备同步个性化设置（壁纸/DJ头像/DJ性格） ==============

/** 读云端档案：?deviceId=&bond= → { settings } | { settings: null }（无档案时前端做种子推送） */
app.get("/api/owner/settings", async (req, res) => {
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : "";
  const bond = typeof req.query.bond === "string" ? req.query.bond : "";
  if (!verifyBond(deviceId, bond)) {
    res.status(403).json({ code: 403, message: "仅主人可访问云端档案" });
    return;
  }
  try {
    const s = await getOwnerSettings();
    res.json({ code: 0, data: { settings: s && s.updatedAt ? s : null } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err instanceof Error ? err.message : "读取档案失败" });
  }
});

/** 写云端档案：body { deviceId, bond, settings } → 全量合并快照，返回最新 updatedAt */
app.put("/api/owner/settings", async (req, res) => {
  const { deviceId, bond, settings } = (req.body ?? {}) as {
    deviceId?: unknown;
    bond?: unknown;
    settings?: Record<string, unknown>;
  };
  const did = typeof deviceId === "string" ? deviceId : "";
  const bd = typeof bond === "string" ? bond : null;
  if (!verifyBond(did, bd)) {
    res.status(403).json({ code: 403, message: "仅主人可写云端档案" });
    return;
  }
  // 白名单字段；显式 null 视为清除，undefined/非白名单键丢弃
  const patch: Record<string, unknown> = {};
  for (const k of ["wallpaper", "personality", "djAvatar", "userAvatar", "playerBg"] as const) {
    const v = settings?.[k];
    if (v !== undefined && (typeof v === "string" || v === null)) patch[k] = v;
  }
  try {
    const s = await saveOwnerSettings(patch as Parameters<typeof saveOwnerSettings>[0]);
    res.json({ code: 0, data: { settings: s } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err instanceof Error ? err.message : "写入档案失败" });
  }
});

/** 在线设备概览（供主人查看：现在谁在听，是主人还是客人） */
app.get("/api/device/now", (_req, res) => {
  const online: { kind: string; role: string; deviceId?: string; connectedAt?: number }[] = [];
  wss.clients.forEach((client) => {
    const meta = client as unknown as { _deviceId?: string; _kind?: string; _role?: string; _connectedAt?: number };
    if (meta._deviceId) {
      online.push({
        kind: meta._kind ?? "未知设备",
        role: meta._role ?? "unknown",
        deviceId: meta._deviceId.slice(0, 8),
        connectedAt: meta._connectedAt,
      });
    }
  });
  res.json({ code: 0, data: { online, guestTotal: guestCount() } });
});

/**
 * 客人彩蛋：DJ 语音欢迎（首次隆重 / 再来低调）。
 * 带 DJ 互斥锁避免与开播/切歌话术抢播；锁忙则 1.5s 后补一次，仍忙就放弃（下回接入再说）。
 */
function fireGuestGreeting(isNew: boolean, deviceId: string): void {
  const doGreet = (): Promise<boolean> =>
    withDjLock(async () => {
      try {
        const dj = await generateGuestGreeting(isNew);
        if (dj.audioUrl) {
          broadcast({ type: "dj", ...dj, timestamp: Date.now(), guest: true });
          markGreeted(deviceId);
          console.log(`[DEVICE] 🎙️ 客人${isNew ? "隆重欢迎" : "低调问候"}已播报`);
        } else {
          console.warn("[DEVICE] 欢迎语音合成失败(无音频)，跳过播报");
        }
      } catch (err) {
        console.warn("[DEVICE] 客人欢迎异常:", err instanceof Error ? err.message : String(err));
      }
    });
  doGreet().then((ok) => {
    if (!ok) {
      console.log("[DEVICE] DJ 忙，1.5s 后补发客人欢迎…");
      setTimeout(() => {
        doGreet().catch(() => {});
      }, 1500);
    }
  });
}

/**
 * 播放控制命令识别（语音/文字均可）
 * 命中返回 { action, en, zh }；闲聊返回 null
 */
function detectAction(text: string): { action: string; en: string; zh: string } | null {
  const t = text.toLowerCase().trim();

  // 切歌 / 下一首
  if (/(切歌|下一首|换歌|换一首|下一条|next|skip|change\s*song)/.test(t)) {
    return { action: "skip", en: "Switching tracks. Hold on.", zh: "好，换一首。" };
  }
  // 暂停
  if (/(暂停|停一下|先停|pause|stop)/.test(t)) {
    return { action: "pause", en: "Pausing the music.", zh: "音乐已暂停。" };
  }
  // 播放 / 继续
  if (/(播放|继续|开始|play|resume)/.test(t)) {
    return { action: "play", en: "Music on.", zh: "继续播放。" };
  }
  // 音量调大
  if (/(大声|音量加|音量调大|声音大|volume\s*up|louder)/.test(t)) {
    return { action: "volumeUp", en: "Turning it up a notch.", zh: "音量调大一点。" };
  }
  // 音量调小
  if (/(小声|音量减|音量调小|声音小|volume\s*down|quieter)/.test(t)) {
    return { action: "volumeDown", en: "Turning it down a notch.", zh: "音量调小一点。" };
  }
  // 现在放什么
  if (/(什么歌|现在放|歌名|what'?s\s*playing|current\s*song|what\s*song)/.test(t)) {
    return { action: "whatSong", en: "Let me check the queue.", zh: "让我看看现在放什么。" };
  }

  return null;
}

/**
 * [2026-09-07] 歌曲问题检测：问句涉及"当前这首/正在放的歌"的背景、创作、年代、演唱等
 * → 命中时聊天链路等待该歌的背景档案生成，让 DJ 答歌问时有真材实料。
 * 强信号词匹配，避免把"今天有什么故事"这类普通闲聊误判成歌问。
 */
function detectSongQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // 主体词（必须是"歌"相关）+ 常见问法
  if (/(这首歌|这首|这歌|现在放|正在放|播放的|放的|刚刚那|刚才那|上一首|什么歌|哪首歌|歌的背景|歌曲|cover|feat)/.test(t)) return true;
  if (/(歌|曲|唱|放|播)/.test(t) && /(背景|创作|灵感|来历|故事|趣闻|百科|年代|哪年|发行|原唱|翻唱|介绍|谁|为什么|怎么)/.test(t)) return true;
  return false;
}

/**
 * 点歌识别："播放/来首/放首/想听 + 关键词"
 * 命中返回搜索关键词；闲聊返回 null
 */
function detectSongRequest(text: string): { keyword: string } | null {
  const t = text.trim();

  // 播放/来首/放首/点一首/想听 XX
  const patterns = [
    /(?:播放|来一首|来首|放首|放一首|点一首|点歌|想听|唱一首|放一下)\s*(.+?)[。！!？?]?$/,
    /^(?:播放|来一首|来首|放首|放一首|点一首|想听)\s*(.+)$/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1] && m[1].length >= 2) {
      const keyword = m[1].trim().replace(/[。！!？?，,]$/, "");
      return { keyword };
    }
  }
  return null;
}

/**
 * 点歌处理：搜索 → 找第一首可播 → 广播播放 + DJ 真思考评论（3-4s 让 LLM 联想）
 */
async function handleSongRequest(ws: { send: (d: string) => void }, keyword: string): Promise<void> {
  try {
    const results = await musicService.search(keyword, 10);
    if (results.length === 0) {
      ws.send(JSON.stringify({
        type: "chat-reply",
        en: `I looked everywhere for "${keyword}" — even under the vinyl stacks. Nothing. Try another one?`,
        zh: `我翻遍了每个角落找「${keyword}」——连黑胶堆底下都看了，没有。换一首试试？`,
        provider: "fallback",
      }));
      return;
    }

    for (const s of results) {
      try {
        const full = await musicService.getCompleteSong(s.songmid);
        if (!full.url) continue;
        // 找到：广播播放（所有客户端同步） + DJ 真思考评论
        broadcast({ type: "playSong", song: full });

        // 立即回 fallback 占位（让用户知道 DJ 在找歌）
        ws.send(JSON.stringify({
          type: "chat-reply",
          en: `On it — searching for something that fits "${keyword}"…`,
          zh: `知道了——正在找符合「${keyword}」的歌…`,
          provider: "fallback",
        }));

        // LLM 真思考：为什么这首适合用户请求的氛围（3-4s 返回）
        const context = `The listener just asked me to play something "${keyword}". I picked "${full.name}" by ${full.artist}. Briefly explain why this track fits what they asked for — connect the song's mood/title/lyrics to their request with wit. 2-3 sentences. IMPORTANT: mention ONLY the song title ("${full.name}") when naming it — never the artist name.`;
        const dj = await generateDJLine({
          scene: "chat",
          userMessage: context,
        }).catch(() => null);

        if (dj) {
          ws.send(JSON.stringify({
            type: "chat-reply",
            action: "playSong",
            song: full,
            en: dj.en,
            zh: dj.zh,
            audioUrl: dj.audioUrl,
            provider: dj.provider,
          }));
        } else {
          ws.send(JSON.stringify({
            type: "chat-reply",
            action: "playSong",
            song: full,
            en: `Found it — "${full.name}". Consider it requested, considered it queued.`,
            zh: `找到了——《${full.name}》。点单成功，已插队。`,
            provider: "fallback",
          }));
        }
        return;
      } catch { /* 版权限制，试下一首 */ }
    }

    ws.send(JSON.stringify({
      type: "chat-reply",
      en: `"${keyword}" came up in search but none are playable right now. Copyright is a joyless thing.`,
      zh: `搜到「${keyword}」了，但现在没有可播放的版本。版权是个很无趣的东西。`,
      provider: "fallback",
    }));
  } catch (err) {
    ws.send(JSON.stringify({
      type: "chat-reply",
      en: "Search hit a wall — try asking again in a moment?",
      zh: "搜索撞墙了——过会儿再试试？",
      provider: "fallback",
    }));
    console.error("[WS-song] 点歌失败:", err);
  }
}

wss.on("connection", (ws, req) => {
  // —— 设备身份识别：主人 / 客人（彩蛋依据） ——
  const ua = req.headers["user-agent"];
  let devUrl: URL | null = null;
  try {
    devUrl = new URL(req.url ?? "", "http://localhost");
  } catch {
    devUrl = null;
  }
  const deviceId = devUrl?.searchParams.get("deviceId") || undefined;
  const bond = devUrl?.searchParams.get("bond") || undefined;
  const { role, isNewGuest } = resolveRole(deviceId, bond);
  const kind = classifyDevice(ua);
  noteGuestDevice(deviceId, ua);

  // 挂到 socket 上，供 /api/device/now 统计当前在线角色
  const wsMeta = ws as unknown as { _deviceId?: string; _kind?: string; _role?: string; _connectedAt?: number };
  wsMeta._deviceId = deviceId;
  wsMeta._kind = kind;
  wsMeta._role = role;
  wsMeta._connectedAt = Date.now();

  if (role === "owner") {
    console.log(`[DEVICE] 🏠 主人接入：${kind} (${deviceId?.slice(0, 8)}…)`);
  } else if (role === "guest-new") {
    console.log(`[DEVICE] 👋 新客人接入：${kind} (${deviceId?.slice(0, 8)}…) → 触发隆重欢迎`);
    if (deviceId) fireGuestGreeting(true, deviceId);
  } else if (role === "guest-known") {
    console.log(`[DEVICE] 🔁 熟客接入：${kind} (${deviceId?.slice(0, 8)}…)`);
    if (deviceId && shouldGreetAgain(deviceId)) {
      console.log("[DEVICE] 距上次欢迎 ≥10 分钟 → 低调问候");
      fireGuestGreeting(false, deviceId);
    }
  } else {
    console.log(`[DEVICE] 📡 无标识设备接入：${kind}`);
  }

  ws.send(JSON.stringify({
    type: "hello",
    text: "AI 电台 WS 已连接",
    role,
    isOwner: role === "owner",
    isNewGuest,
    deviceId: deviceId?.slice(0, 8),
  }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (msg.type === "chat" && msg.text) {
        // 1. 点歌请求优先（"播放一首温柔的音乐" / "来首周杰伦的歌"）
        const songReq = detectSongRequest(String(msg.text));
        if (songReq) {
          await handleSongRequest(ws, songReq.keyword);
          return;
        }

        // 2. 播放控制命令（切歌/暂停/播放/音量等）
        const action = detectAction(String(msg.text));
        if (action) {
          ws.send(JSON.stringify({ type: "chat-reply", ...action }));
          return;
        }

        // 3. 闲聊：DJ 直接回应话题（不跑题）
        try {
          const personality = (msg.personality && typeof msg.personality === "object")
            ? msg.personality as { gender: "male" | "female" | "neutral"; voice?: string; traits: string }
            : undefined;
          // 记住用户音色/性格选择（所有场景的 TTS 都用它）
          if (personality) setCurrentPersonality(personality);
          // 前端 send chat 时会带本设备的会话历史 (history: [{role, content}]) 交给 LLM，
          // 让 DJ 看到上文、避免"答非所问"。
          // [2026-09-09·设备隔离] 上下文只取该设备自己带过来的会话历史 —— 服务端不再
          //   注入任何跨会话/跨设备聊天记忆。每个设备与 DJ 的对话彼此独立、不可见不共享：
          //   新设备接入不会带上别的设备聊过什么；刷新后 DJ 只记得本设备最近聊过的 10 条。
          const history = Array.isArray(msg.history)
            ? (msg.history as { role?: unknown; content?: unknown }[])
                .filter((x) =>
                  (x.role === "user" || x.role === "assistant") &&
                  typeof x.content === "string" &&
                  (x.content as string).trim().length > 0
                )
                .slice(-10)
                .map((x) => ({ role: x.role as "user" | "assistant", content: x.content as string }))
            : [];
          const dj = await (async () => {
            // [2026-09-07] 聊天上下文升级：让 DJ 知道此刻在放什么歌 + 歌的背景档案。
            // 之前 chat 完全不传当前歌 → 用户问"这歌什么背景/谁唱的"DJ 无从答起（结构性答非所问）。
            const currentSong = await musicQueue.current().catch(() => null);
            let songProfile: Awaited<ReturnType<typeof getSongProfile>> | null = null;
            if (currentSong) {
              if (detectSongQuestion(String(msg.text))) {
                // 用户在问歌 → 等档案（缓存秒回；首次生成 ~3s 值得等，答歌问要真材实料）
                songProfile = await getSongProfile(currentSong).catch(() => null);
              } else {
                // 普通闲聊 → 有缓存就带（DJ 更懂歌），没有不阻塞；后台预热下次问就有
                songProfile = getCachedSongProfile(currentSong);
                warmSongProfile(currentSong);
              }
            }
            return generateDJLine({
              scene: "chat",
              userMessage: String(msg.text),
              personality,
              history,
              song: currentSong ?? undefined,
              songProfile,
            });
          })();
          ws.send(JSON.stringify({ type: "chat-reply", ...dj }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: "chat-reply",
            en: "Sorry, DJ is out for a smoke — try another topic?",
            zh: "抱歉，DJ 出去抽烟了——换个话题试试？",
            provider: "fallback",
          }));
          console.error("[WS-chat] 失败:", err);
        }
      }
    } catch {}
  });

  ws.on("close", () => console.log(`[WS] client disconnected (${role})`));
});

// ============== 静态资源（始终服务 dist，让 iPhone/微信直接访问 8787） ==============
const dist = path.resolve(__dirname, "../dist");
app.use(express.static(dist, { maxAge: "1h", setHeaders: (res) => res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate") }));
app.get(/^(?!\/api\/|\/audio\/|\/ws).*/, (_req, res) =>
  res.sendFile(path.join(dist, "index.html"))
);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[AI-Radio] server on http://localhost:${PORT}`);
  console.log(`[AI-Radio] WS on ws://localhost:${PORT}/ws`);
  console.log(`[AI-Radio] 网易云 API ${IS_DEPLOYED ? "外部" : `本地 http://localhost:${NETEASE_PORT}`}`);

  // 部署到 Render 时启动 netease 服务保活（防 spin down）
  if (IS_DEPLOYED) startNeteaseKeepalive();

  // 调度器启动：cron 17:30 + 切歌间隔计数
  setSchedulerBroadcast(broadcast);
  setDjBroadcast(broadcast); // 让 DJ 后台真联想话术能直接 broadcast
  scheduler.start();

  // 启动后主动加载用户歌单（不依赖首次播放）：netease 就绪需数秒，
  // 失败时 musicQueue.init 内部会自动定时重试直到成功
  setTimeout(() => {
    musicQueue.init().catch(() => {});
  }, IS_DEPLOYED ? 5000 : 4000);
});

// 优雅退出
const shutdown = (signal: string) => {
  console.log(`[AI-Radio] 收到 ${signal}，关闭中...`);
  scheduler.stop();
  if (neteaseProc) {
    neteaseProc.kill("SIGTERM");
  }
  server.close();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
