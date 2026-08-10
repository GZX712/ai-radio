import express from "express";
import cors from "cors";
import http from "node:http";
import { WebSocketServer } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { musicQueue } from "./services/musicQueue";
import { generateDJLine, setDjBroadcast, setCurrentPersonality } from "./services/dj";
import { ttsService } from "./services/tts";
import { scheduler, setBroadcast as setSchedulerBroadcast } from "./services/scheduler";
import { weatherService } from "./services/weather";
import { triviaService, type TriviaCategory } from "./services/trivia";
import { withDjLock } from "./services/djBusy";
import { Readable } from "node:stream";
import { musicService, type NeteaseSong } from "./services/music";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 8787;
const NETEASE_PORT = 3000;

// 部署到 Render 时：NETEASE_BASE 已指向外部网易云 API 服务，跳过子进程启动
const IS_DEPLOYED = !!process.env.NETEASE_BASE;

app.use(cors());
app.use(express.json());

// 静态文件：TTS 生成的 mp3（前端 /audio/dj-xxx.mp3 拉取）
const AUDIO_DIR = ttsService.getAudioDir();
app.use("/audio", express.static(AUDIO_DIR, { maxAge: "1h" }));

// ============== 音乐流代理 ==============
// 前端页面是 HTTPS，浏览器加载 http:// 网易云流会被 Mixed Content 拦截 → 疯狂跳歌。
// 这里后端用 http 拉流（带 UA/Referer 防盗链头），流式转发给前端（同源 https）。
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
    const range = String(req.headers.range || "");
    if (range) headers.Range = range;
    const upstream = await fetch(upstreamUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ code: 502, message: `upstream ${upstream.status}` });
      return;
    }
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=300");
    const stream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
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

  neteaseProc = spawn("node", ["app.js"], {
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
    console.log(`[netease] 进程退出 code=${code}`);
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
    const song = await musicQueue.next();
    res.json({ code: 0, data: song });
    broadcast({ type: "songChange", data: song });

    // 调度器计数 + DJ 串场（异步）
    scheduler.onTrackChange().catch((err) =>
      console.error("[Scheduler] onTrackChange 失败:", err)
    );
    if (song) {
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
    const song = await musicQueue.prev();
    res.json({ code: 0, data: song });
    broadcast({ type: "songChange", data: song });
    if (song) {
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
    const song = await musicQueue.skip();
    res.json({ code: 0, data: song });
    broadcast({ type: "songChange", data: song });

    scheduler.onTrackChange().catch((err) =>
      console.error("[Scheduler] onTrackChange 失败:", err)
    );
    if (song) {
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
 * 切歌 DJ：不走 DJ 锁——切歌话术来自预生成缓存（<10ms 秒回），
 * 若被天气/趣闻的 LLM 生成（~5s）锁住，切歌话术会晚 5 秒才广播（用户感知"回复慢"）。
 * 天气/趣闻生成慢没关系，让它们排队即可；切歌必须即时。
 */
async function triggerDJTransition(
  previousSong: NeteaseSong | null,
  currentSong: NeteaseSong
) {
  const dj = await generateDJLine({
    scene: "transition",
    previousSong: previousSong ?? undefined,
    song: currentSong,
  });
  broadcast({ type: "dj", ...dj });
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

// 同步 DJ personality（用户选音色/性格后立即调用，后端所有 TTS 立即生效）
app.post("/api/dj/personality", (req, res) => {
  const { gender, voice, traits, humorStyle } = (req.body || {}) as {
    gender?: "male"|"female"|"neutral";
    voice?: string;
    traits?: string;
    humorStyle?: "financial"|"medical"|"legal"|"poker"|"british"|"none";
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

// ============== HTTP + WS 服务 ==============
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(message: unknown) {
  const text = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(text);
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

wss.on("connection", (ws) => {
  console.log("[WS] client connected");
  ws.send(JSON.stringify({ type: "hello", text: "AI 电台 WS 已连接" }));

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
          const dj = await generateDJLine({
            scene: "chat",
            userMessage: String(msg.text),
            personality,
          });
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

  ws.on("close", () => console.log("[WS] client disconnected"));
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

  // 调度器启动：cron 17:30 + 切歌间隔计数
  setSchedulerBroadcast(broadcast);
  setDjBroadcast(broadcast); // 让 DJ 后台真联想话术能直接 broadcast
  scheduler.start();
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
