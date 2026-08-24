import { useCallback, useEffect, useRef, useState } from "react";
import { useRadioStore } from "@/store/useRadioStore";
import { radioApi } from "@/lib/api";
import { ReconnectingWS } from "@/lib/ws";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import type { NowPlaying } from "@/types";
import { Player } from "@/components/Player";
import { ChatPanel } from "@/components/ChatPanel";
import { Toast } from "@/components/Toast";
import { ParticleField } from "@/components/ParticleField";
import { DigitRain } from "@/components/DigitRain";
import { CloudBanner } from "@/components/CloudBanner";
import { isCloudDemo, buildPushHeaders, PUSH_URL } from "@/lib/cloudMode";

export default function App() {
  const setNow = useRadioStore((s) => s.setNow);
  const setDjBilingual = useRadioStore((s) => s.setDjBilingual);
  const setError = useRadioStore((s) => s.setError);
  const isPlaying = useRadioStore((s) => s.isPlaying);  const progress = useRadioStore((s) => s.progress);
  const fmt = (s: number) =>
    isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}` : "0:00";
  const engine = useAudioEngine();
  const [ws, setWs] = useState<ReconnectingWS | null>(null);
  const [started, setStarted] = useState(false); // 开始电台引导层
  // 云端模式：当前正在播的远端电脑状态（每 2s 轮询 EdgeOne KV）
  const [remoteNow, setRemoteNow] = useState<NowPlaying | null>(null);
  const [remoteLastSeen, setRemoteLastSeen] = useState<number>(0);
  // APP 使用时长（打开页面即开始累计，每秒 +1）
  const [appTime, setAppTime] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setAppTime((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  // 持久化 handlePlay 引用（避免 effect 重跑）
  const handlePlayRef = useRef(engine.handlePlay);
  handlePlayRef.current = engine.handlePlay;

  // 点击开始电台（iOS Safari 需要用户手势解锁音频）
  const handleStart = useCallback(() => {
    setStarted(true);
    // 🔓 同步解锁音频（user gesture 内），否则浏览器 autoplay policy 静默拒绝 play()
    if (engine.unlockAudio) engine.unlockAudio();
    // 用户主动点击开始 → 自动播放第一首（保持"点开始就播"的预期）
    engine.handlePlay().catch(() => {});
  }, [engine]);

  // 播放控制命令执行（聊天/语音触发）
  const handleAction = useCallback((action: string, payload?: unknown) => {
    switch (action) {
      case "skip":
        engine.handleSkip().catch(() => {});
        break;
      case "pause":
        engine.handlePause();
        break;
      case "play":
        engine.handlePlay().catch(() => {});
        break;
      case "playSong": {
        // 点歌：直接播放 DJ 找到的歌曲
        const song = payload as NowPlaying | undefined;
        if (song?.url) {
          engine.loadAndPlay(song).catch(() => {});
        }
        break;
      }
      case "volumeUp": {
        const v = Math.min(1, useRadioStore.getState().volume + 0.2);
        engine.setVolume(v);
        break;
      }
      case "volumeDown": {
        const v = Math.max(0, useRadioStore.getState().volume - 0.2);
        engine.setVolume(v);
        break;
      }
      case "whatSong": {
        const now = useRadioStore.getState().now;
        if (now) {
          useRadioStore.getState().setDjBilingual(
            `Now playing: "${now.name}".`,
            `现在播放：《${now.name}》。`
          );
        }
        break;
      }
    }
  }, [engine]);

  // 初始拉当前播放
  useEffect(() => {
    radioApi
      .getNow()
      .then(setNow)
      .catch((err) => setError(err instanceof Error ? err.message : "Init failed"));
  }, [setNow, setError]);

  // ☁️ 云端模式：每 2.5 秒轮询 EdgeOne KV，看辛老师本机电脑正在播什么
  useEffect(() => {
    if (!isCloudDemo()) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/poll", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        if (json?.now) {
          setRemoteNow(json.now as NowPlaying);
          setRemoteLastSeen(Date.now());
          // 同步到 store（让 Player/Visualizer 也能显示）
          setNow(json.now as NowPlaying);
        }
      } catch {
        /* 网络/EdgeOne 故障静默 */
      }
    };
    tick();
    const t = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [setNow]);

  // 🚀 本机模式：每 5 秒把当前正在播放的歌推到 EdgeOne KV（云端才能看到）
  useEffect(() => {
    if (isCloudDemo()) return; // 云端页面自身不推
    // 读取用户配置的 DJ_TOKEN（辛老师从 EdgeOne 控制台拿）
    let token = "";
    try {
      token = localStorage.getItem("ai-radio-dj-token") || "";
    } catch { /* ignore */ }
    let lastSentKey = "";
    const tick = async () => {
      const now = useRadioStore.getState().now;
      const isPlaying = useRadioStore.getState().isPlaying;
      const progress = useRadioStore.getState().progress;
      if (!now) return;
      // 只在变化时推（避免无谓请求）
      const key = `${now.songmid}|${isPlaying ? 1 : 0}|${Math.floor(progress)}`;
      if (key === lastSentKey) return;
      lastSentKey = key;
      try {
        await fetch(PUSH_URL, {
          method: "POST",
          headers: buildPushHeaders(token),
          body: JSON.stringify({
            now,
            isPlaying,
            progress,
            timestamp: Date.now(),
            source: "local-pc",
          }),
        });
      } catch {
        /* 推送失败静默（不影响本机播放） */
      }
    };
    const t = window.setInterval(tick, 5000);
    tick(); // 立即推一次
    return () => clearInterval(t);
  }, []);

  // 启动时恢复 DJ personality（localStorage → 后端），切歌等场景立即用用户音色
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ai-radio-dj-personality");
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p?.gender) return;
      fetch("/api/dj/personality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }).catch(() => {});
    } catch { /* ignore */ }
  }, []);

  // 浏览器 GPS 精确定位（手机基站/网络位置）+ 逆地理编码城市名，上报后端用于天气解说
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let city = "当前位置";
        // 逆地理编码（Nominatim 免费）：拿城市名
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=zh&zoom=10`
          );
          const j = (await res.json()) as { address?: { city?: string; town?: string; village?: string; county?: string } };
          city = j.address?.city || j.address?.town || j.address?.village || j.address?.county || "当前位置";
        } catch { /* 逆地理失败用"当前位置" */ }
        fetch("/api/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: latitude, lon: longitude, city }),
        }).catch(() => {});
      },
      () => { /* 用户拒绝或无权限，回退 IP 定位 */ },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    );
  }, []);

  // 自动开播：页面加载即尝试播放；iOS Safari 需用户手势，点击/触摸任意处重试
  useEffect(() => {
    let autoPlayed = false;
    const tryStart = () => {
      if (autoPlayed) return;
      handlePlayRef.current()
        .then(() => { autoPlayed = true; })
        .catch(() => { /* 失败，等下次手势再试 */ });
    };
    tryStart();
    document.addEventListener("click", tryStart);
    document.addEventListener("touchstart", tryStart);
    return () => {
      document.removeEventListener("click", tryStart);
      document.removeEventListener("touchstart", tryStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebSocket 接收 DJ 串场（双语）
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new ReconnectingWS(`${proto}://${location.host}/ws`);
    setWs(ws);
    ws.connect();

    const off = ws.onMessage((msg) => {
      const m = msg as { en?: string; zh?: string; audioUrl?: string; type?: string; song?: NowPlaying };
      if (m.type === "dj" || m.type === "chat-reply") {
        useRadioStore.getState().setDjThinking(false);
        // dj 类型（切歌/开场/天气/趣闻/整点）→ 自动播放
        // chat-reply 类型 → 不自动播（ChatPanel 显示 ▶ 按钮，用户按了才听）
        if (m.audioUrl && m.type === "dj") {
          engine.playDj(m.audioUrl, m.en ?? "", m.zh ?? "").catch(() => {});
        }
        return;
      }
      if (m.type === "playSong" && m.song?.url) {
        // 点歌广播：直接播放（所有客户端同步）
        useRadioStore.getState().setDjThinking(false);
        engine.loadAndPlay(m.song).catch(() => {});
      }
    });

    return () => {
      off();
      ws.close();
      setWs(null);
      engine.stopDj();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDjBilingual]);

  // 开场白只在"开始电台"按钮点击时触发一次（移除自动触发，避免重复说话）

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="header-avatar" aria-label="DJ">DJ</div>
          <div>
            <div className="header-name">AI Radio</div>
            <div className="header-status">
              {isCloudDemo()
                ? (remoteNow ? "📡 Synced" : "☁️ Cloud")
                : (isPlaying ? "Speaking" : "Online")}
            </div>
          </div>
        </div>
        <div className="header-timer" title="本次使用时长">{fmt(appTime)}</div>
      </header>

      {/* ☁️ 云端模式横幅：明确告诉用户这是 EdgeOne 部署版 + 远端同步状态 */}
      <CloudBanner remoteNow={remoteNow} remoteLastSeen={remoteLastSeen} />

      <Player
        onToggle={() => {
          if (engine.unlockAudio) engine.unlockAudio();
          return engine.handleToggle();
        }}
        onSkip={engine.handleSkip}
        onPrev={engine.handlePrev}
        onSeek={engine.handleSeek}
        onSeekTo={engine.handleSeekTo}
        onSetRate={engine.setPlaybackRate}
        onSetVolume={engine.setVolume}
        getAnalyser={engine.getAnalyser}
        chatPanelSlot={
          ws ? (
            <ChatPanel
              ws={ws}
              onAction={handleAction}
              playDj={engine.playDj}
              stopDj={engine.stopDj}
            />
          ) : null
        }
      />
      {/* 桌面端装饰：粒子 + 数字雨（移动端 CSS media query 自动隐藏） */}
      <ParticleField count={12} />
      <DigitRain />
      <Toast />

      {/* 开始电台引导层（iOS autoplay 解锁）；云端模式不显示（点播需要本地后端） */}
      {!started && !isCloudDemo() && (
        <div className="start-overlay" onClick={handleStart}>
          <div className="start-card">
            <h2 className="start-title">AI 电台</h2>
            <p className="start-sub">294 首你的歌 · 双语 DJ · 语音操控</p>
            <button type="button" className="start-btn magnetic">
              ▶ 开始电台
            </button>
          </div>
        </div>
      )}

      {/* 云端模式：完全没数据时显示空状态 */}
      {isCloudDemo() && !remoteNow && (
        <div className="cloud-empty">
          <div className="cloud-empty-icon">📡</div>
          <div className="cloud-empty-title">等待远端电脑连接</div>
          <p className="cloud-empty-sub">
            辛老师，本机电脑访问 <a href={location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:8787' : `http://${location.hostname}:8787`} target="_blank" rel="noopener noreferrer">http://{location.hostname}:8787</a> 开启本地服务并播放音乐
            <br />
            远端电脑开始播放后，当前页面会同步显示正在播的曲目
          </p>
        </div>
      )}
    </div>
  );
}