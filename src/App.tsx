import { useCallback, useEffect, useRef, useState } from "react";
import { useRadioStore } from "@/store/useRadioStore";
import { radioApi } from "@/lib/api";
import { ReconnectingWS } from "@/lib/ws";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { playEntranceSfx, playRandomSfx } from "@/lib/sfx";
import type { NowPlaying } from "@/types";
import { Player } from "@/components/Player";
import { ChatPanel } from "@/components/ChatPanel";
import { Toast } from "@/components/Toast";
import { ParticleField } from "@/components/ParticleField";

export default function App() {
  const setNow = useRadioStore((s) => s.setNow);
  const setDjBilingual = useRadioStore((s) => s.setDjBilingual);
  const setError = useRadioStore((s) => s.setError);
  const sfxEnabled = useRadioStore((s) => s.sfxEnabled);
  const toggleSfx = useRadioStore((s) => s.toggleSfx);
  const isPlaying = useRadioStore((s) => s.isPlaying);  const progress = useRadioStore((s) => s.progress);
  const fmt = (s: number) =>
    isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}` : "0:00";
  const engine = useAudioEngine();
  const [ws, setWs] = useState<ReconnectingWS | null>(null);
  const [started, setStarted] = useState(false); // 开始电台引导层
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
    engine.handlePlay().catch(() => {
      // 播放失败也继续（可能已解锁但网络慢）
      useRadioStore.getState().setError("播放失败，请重试");
    });
    // 登场搞笑音效（DJ 亮相）
    if (useRadioStore.getState().sfxEnabled) playEntranceSfx();
    // 触发 DJ 开场（只一段，不重复）
    window.setTimeout(() => {
      fetch("/api/dj/open", { method: "POST" }).catch(() => {});
    }, 300);
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

  // 自动开播：页面加载即尝试一次（无手势会被 iOS 拒，用户点"开始电台"时再重试）。
  // 注意：不再挂 document 全局 click 重试——之前它会和播放按钮的 onToggle 竞态，
  // 首次播放失败时"点暂停 → document 监听又自动调 handlePlay"导致暂停无效/播放异常。
  useEffect(() => {
    handlePlayRef.current().catch(() => { /* 失败交给用户手势（开始电台/播放按钮） */ });
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
        // 搞笑音效：DJ 段子/回复到达时 40% 概率随机反应音效（不打断语音，音量轻）
        if (useRadioStore.getState().sfxEnabled && Math.random() < 0.4) {
          playRandomSfx();
        }
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
            <div className="header-status">{isPlaying ? "Speaking" : "Online"}</div>
          </div>
        </div>
        <div className="header-right">
          <button
            type="button"
            className={`sfx-toggle ${sfxEnabled ? "on" : "off"}`}
            onClick={toggleSfx}
            title={sfxEnabled ? "搞笑音效：开（点击关闭）" : "搞笑音效：关（点击开启）"}
            aria-label="搞笑音效开关"
          >
            {sfxEnabled ? "😄 音效开" : "🔇 音效关"}
          </button>
          <div className="header-timer" title="本次使用时长">{fmt(appTime)}</div>
        </div>
      </header>

      <Player
        onToggle={engine.handleToggle}
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
      {/* 数字雨已删除（用户要求去除右下角青色矩形） */}
      <Toast />

      {/* 开始电台引导层（iOS autoplay 解锁） */}
      {!started && (
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
    </div>
  );
}