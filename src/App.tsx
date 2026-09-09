import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRadioStore, WALLPAPERS, type WallpaperId } from "@/store/useRadioStore";
import { radioApi } from "@/lib/api";
import { ReconnectingWS } from "@/lib/ws";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { playEntranceSfx } from "@/lib/sfx";
import type { NowPlaying } from "@/types";
import { Player } from "@/components/Player";
import { ChatPanel } from "@/components/ChatPanel";
import { Toast } from "@/components/Toast";
import { ParticleField } from "@/components/ParticleField";
import { WallpaperPicker } from "@/components/WallpaperPicker";
import { buildWsUrl, tryClaimFromUrl, bindCurrentDeviceAsOwner, isOwnerDevice } from "@/lib/deviceIdentity";
import { pullSettings, pushSettings } from "@/lib/settingsSync";

export default function App() {
  const setNow = useRadioStore((s) => s.setNow);
  const setDjBilingual = useRadioStore((s) => s.setDjBilingual);
  const setError = useRadioStore((s) => s.setError);
  const sfxEnabled = useRadioStore((s) => s.sfxEnabled);
  const toggleSfx = useRadioStore((s) => s.toggleSfx);
  const wallpaperId = useRadioStore((s) => s.wallpaperId);
  const setWallpaper = useRadioStore((s) => s.setWallpaper);
  const playerBgImage = useRadioStore((s) => s.playerBgImage);
  const setPlayerBgImage = useRadioStore((s) => s.setPlayerBgImage);
  const djAvatar = useRadioStore((s) => s.djAvatar);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deviceRole, setDeviceRole] = useState<string>(""); // owner | guest-new | guest-known | no-id（hello 下发）
  const isPlaying = useRadioStore((s) => s.isPlaying);  const progress = useRadioStore((s) => s.progress);
  const fmt = (s: number) =>
    isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}` : "0:00";
  const engine = useAudioEngine();
  const [ws, setWs] = useState<ReconnectingWS | null>(null);
  // 开始电台引导层：已认证的主人设备（手机/电脑）直接进电台，永不弹引导/绑定界面；
  // 只有新接入的（客人/未绑定）设备第一次打开才看到 —— 与主人体验区分开。
  const [started, setStarted] = useState<boolean>(() => {
    try { return isOwnerDevice(); } catch { return false; }
  });
  // 主人设备绑定：仅「开始电台」页用，单设备级一次性
  // - already：localStorage 已有 bond → 显示「✓ 本设备已为主人」，disable 按钮
  // - idle/binding/done/error：供首次打开的设备点击「一键绑定」走状态机
  const [bindingState, setBindingState] = useState<"already" | "idle" | "binding" | "done" | "error">(() => {
    if (typeof window === "undefined") return "idle";
    try {
      return localStorage.getItem("radio_owner_bond") ? "already" : "idle";
    } catch { return "idle"; }
  });
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
    // iOS 必须：同步手势内先解锁 AudioContext + media autoplay（在任何 await 之前！
    // 否则 resume 手势栈已断 → 音乐"播放中"但 WebAudio 无声）
    engine.unlock();
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

  // 一键绑定本设备为主人：和「开始电台」合并为同一次手势
  // - 同步：解锁音频 + 开电台（同 handleStart）
  // - 异步：claim → bond 写 localStorage → reload 让 WS 重连带上 bond → 后端识别为 owner
  // - 已绑定设备（state="already"）直接走 handleStart，不重复弹出
  const handleBindAndStart = useCallback(() => {
    handleStart();
    if (bindingState !== "idle") return;
    setBindingState("binding");
    bindCurrentDeviceAsOwner()
      .then((r: { ok: boolean; bond?: string; already?: boolean }) => {
        if (r.ok) {
          setBindingState("done");
          // 600ms 后 reload：让 WS 用新 bond 重连，后端识别为 owner → 客人彩蛋永不触发
          setTimeout(() => location.reload(), 600);
        } else {
          setBindingState("error");
          useRadioStore.getState().setError("主人绑定失败，可稍后点击头部徽标重试");
        }
      })
      .catch(() => {
        setBindingState("error");
      });
  }, [engine, bindingState, handleStart]);

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

  // 主人设置云端档案同步：启动时拉取（壁纸 / DJ头像 / DJ性格 → 主人各设备自动跟随）。
  // 聊天记录不做云同步：每个设备与 DJ 的对话彼此独立、不可见不共享。
  // - 主人设备：历史保存在本机 localStorage（刷新/重开都在）
  // - 其他新接入设备（客人）：无痕 —— 启动即清掉本机任何聊天残留，会话结束即消失
  useEffect(() => {
    void pullSettings();
    if (!isOwnerDevice()) {
      try { localStorage.removeItem("ai-radio-chat-history"); } catch { /* ignore */ }
      useRadioStore.getState().clearChatHistory();
    }
  }, []);

  // 主人绑定：/?claim=<口令> 访问一次 → 绑定本设备（此后自动识别，无需再带参）
  useEffect(() => {
    tryClaimFromUrl().then((r) => {
      if (r === "claimed") {
        setError("✅ 已将本设备绑定为电台主人，正在刷新生效…");
        window.setTimeout(() => location.reload(), 1200);
      } else if (r === "failed") {
        setError("❌ 主人绑定失败：口令无效或服务未就绪");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const ws = new ReconnectingWS(buildWsUrl(`${proto}://${location.host}/ws`));
    setWs(ws);
    ws.connect();

    const off = ws.onMessage((msg) => {
      const m = msg as { en?: string; zh?: string; audioUrl?: string; type?: string; song?: NowPlaying; funny?: boolean; role?: string; isOwner?: boolean };
      if (m.type === "hello") {
        // 后端告知本设备身份（主人 / 客人）——界面徽标 + 控制台可查
        setDeviceRole(m.role ?? "");
        console.info(`[DEVICE] 本设备身份: ${m.role ?? "unknown"}${m.isOwner ? "（主人）" : ""}`);
        return;
      }
      if (m.type === "dj" || m.type === "chat-reply") {
        useRadioStore.getState().setDjThinking(false);
        // 去掉"到达就随机播卡通音效"——改成：dj 类型自动播语音，
        // 若后端标了 funny（这条是笑话/怼人），语音播完自动接 sitcom 罐头笑声
        // （playDj 内部处理；chat-reply 由用户点 ▶ 播放，同样在 ChatPanel 传 laugh）
        // dj 类型（切歌/开场/天气/趣闻/整点）→ 自动播放
        // chat-reply 类型 → 不自动播（ChatPanel 显示 ▶ 按钮，用户按了才听）
        if (m.audioUrl && m.type === "dj") {
          engine.playDj(m.audioUrl, m.en ?? "", m.zh ?? "", false, m.funny === true).catch(() => {});
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
    <div className="app" data-wallpaper={wallpaperId}>
      <header className="header">
        <div className="header-brand">
          <div className="header-avatar" aria-label="DJ">
            {djAvatar
              ? <img src={djAvatar} alt="DJ" className="header-avatar-img" />
              : <span className="header-avatar-fallback">DJ</span>}
          </div>
          <div>
            <div className="header-name">AI Radio</div>
            <div className="header-status">
              {isPlaying ? "Speaking" : "Online"}
              {deviceRole === "owner" && <span className="role-badge owner" title="本设备是电台主人">🏠 主人</span>}
              {(deviceRole === "guest-new" || deviceRole === "guest-known") && (
                <span className="role-badge guest" title="本设备是访客（DJ 会语音欢迎）">👤 访客</span>
              )}
            </div>
          </div>
        </div>
        <div className="header-right">
          <button
            type="button"
            className="wallpaper-btn"
            onClick={() => setPickerOpen(true)}
            title={`当前壁纸：${WALLPAPERS.find(w => w.id === wallpaperId)?.name ?? wallpaperId}`}
            aria-label="切换壁纸"
          >
            <span className="wallpaper-btn-dot" style={{
              background: WALLPAPERS.find(w => w.id === wallpaperId)?.palette[0] ?? "#9d00ff",
            }} />
            <span className="wallpaper-btn-label">壁纸</span>
          </button>
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
              wallpaperId={wallpaperId}
            />
          ) : null
        }
      />
      {/* 桌面端装饰：粒子 + 数字雨（移动端 CSS media query 自动隐藏） */}
      <ParticleField count={12} />
      {/* 数字雨已删除（用户要求去除右下角青色矩形） */}
      <Toast />

      {/* 壁纸选择面板（fixed 定位，独立于 DOM 层级） */}
      {pickerOpen && (
        <WallpaperPicker
          current={wallpaperId}
          playerBgImage={playerBgImage}
          onPick={(id: WallpaperId) => {
            setWallpaper(id);
            void pushSettings(); // 主人改壁纸 → 同步上云，手机下次打开自动跟随
          }}
          onPlayerBgImage={(url) => {
            const r = setPlayerBgImage(url);
            void pushSettings(); // 自定义播放器背景 → 同步上云
            return r;
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* 开始电台引导层（iOS autoplay 解锁 + 主人设备一键绑定，三合一） */}
      {!started && (
        <div className="start-overlay" onClick={handleStart} role="presentation">
          <div className="start-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="start-title">辛老师的 AI 电台</h2>
            <p className="start-sub">284 首你的歌 · 双语 DJ · 语音操控</p>

            {/* 主人绑定区：一键 claim → reload 后永不再弹（仅未绑设备显示操作按钮） */}
            <div className="start-bind-row">
              {bindingState === "already" ? (
                <span className="start-bind-chip owner-chip" title="本设备已永久绑定为电台主人">✓ 本设备已为主人</span>
              ) : bindingState === "binding" ? (
                <button type="button" className="start-bind-btn" disabled>⏳ 正在绑定为主人…</button>
              ) : bindingState === "done" ? (
                <button type="button" className="start-bind-btn owner-bound" disabled>✓ 绑定成功，即将刷新…</button>
              ) : bindingState === "error" ? (
                <button
                  type="button"
                  className="start-bind-btn"
                  onClick={(e) => { e.stopPropagation(); setBindingState("idle"); }}
                >↻ 重试绑定</button>
              ) : (
                <button
                  type="button"
                  className="start-bind-btn"
                  onClick={(e) => { e.stopPropagation(); handleBindAndStart(); }}
                  title="把当前浏览器标记为电台主人（辛老师本人的电脑/手机）"
                >📍 这是我的设备，绑定为主人</button>
              )}
            </div>

            <button type="button" className="start-btn magnetic" onClick={handleStart}>
              ▶ 开始电台
            </button>
            <p className="start-hint">点击「▶ 开始电台」直接听歌｜点击「📍 绑定为主人」同步解锁并永久认作主人</p>
          </div>
        </div>
      )}
    </div>
  );
}