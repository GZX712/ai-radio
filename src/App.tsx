import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRadioStore, WALLPAPERS, type WallpaperId } from "@/store/useRadioStore";
import { radioApi } from "@/lib/api";
import { ReconnectingWS } from "@/lib/ws";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useNextPrefetch } from "@/hooks/useNextPrefetch";
import { playEntranceSfx } from "@/lib/sfx";
import type { NowPlaying } from "@/types";
import { Player } from "@/components/Player";
import { ChatPanel } from "@/components/ChatPanel";
import { Toast } from "@/components/Toast";
import { ParticleField } from "@/components/ParticleField";
import { WallpaperPicker } from "@/components/WallpaperPicker";
import { buildWsUrl, tryClaimFromUrl, isOwnerDevice } from "@/lib/deviceIdentity";
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
  // [2026-09-21] 后段预取下一首（封面 + 音频）：曲库单首 10MB 量级，
  // 等切歌才开始下载会白屏 + 缓冲 —— 提前 85% 进度的余量把资源备好
  useNextPrefetch();
  const [ws, setWs] = useState<ReconnectingWS | null>(null);
  // 开始电台引导层：已认证的主人设备（手机/电脑）直接进电台，永不弹引导/绑定界面；
  // 只有新接入的（客人/未绑定）设备第一次打开才看到 —— 与主人体验区分开。
  const [started, setStarted] = useState<boolean>(() => {
    try { return isOwnerDevice(); } catch { return false; }
  });
  // [2026-09-21 辛老师要求] 引导层上的「📍 这是我的设备，绑定为主人」按钮已下线。
  // 两台主人设备均已绑定完毕，绑定状态由 localStorage 里的 bond 承担（无需 UI 展示）。
  //
  // 注意：这里**只是撤掉 UI 入口**，绑定能力与既有数据完全保留 ——
  //   - bond 是 HMAC(deviceId) 无状态签名，已绑设备的凭证永久有效（不动 EGG_OWNER_SECRET 即可）；
  //   - 后端 POST /api/device/claim 与 CLAIM_TOKEN 原样保留；
  //   - deviceIdentity.tryClaimFromUrl 仍在，将来要加第三台设备时，
  //     访问 /?claim=xradio-master-2026 一次即可绑定（见文件底部注释）。
  // 详见 src/lib/deviceIdentity.ts 顶部说明。
  // APP 使用时长（打开页面即开始累计，每秒 +1）
  const [appTime, setAppTime] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setAppTime((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // [2026-09-21 手机端延迟] 撤掉 index.html 里的静态首屏 splash（同色系占位，
  // 让首帧就有反馈，弥补 Slow 4G 下引导层要 4~9 秒才画出来的空窗）。
  // 淡出 260ms 再移除；元素不存在时静默跳过（本地 dev / 已被移除）。
  useEffect(() => {
    const el = document.getElementById("boot-splash");
    if (!el) return;
    el.classList.add("is-gone");
    const t = window.setTimeout(() => el.remove(), 320);
    return () => window.clearTimeout(t);
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

  // [2026-09-21] 原 handleBindAndStart（一键 claim + 开电台）随绑定按钮一起移除。
  // 现在引导层只有「▶ 开始电台」一个动作，未绑定设备（客人）点它就进入电台。

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

  // 初始拉当前播放 →（仅已认证主人设备）随后首次开播。
  //
  // [2026-09-21 手机端延迟修复] 由「getNow 与 handlePlay 各跑各的」改为**串行**：
  // 并行时 handlePlay() 往往在 now 到位前就执行 → 走 /api/next 白推进一次队列，
  // 慢网下还会与 getNow 回来的歌打架（同一首被两次设源 → 下载 abort、从 0 重来）。
  // 客人 / 未绑定设备不自动播 —— 统一由「开始电台」按钮在手势内触发（iOS 需要）。
  useEffect(() => {
    void radioApi
      .getNow()
      .then((s) => {
        setNow(s);
        return s;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Init failed");
        return null;
      })
      .then(() => {
        // 无手势会被 iOS 拒 → 交给用户点「开始电台」（handleStart 内会再调一次）。
        // 注意：不挂 document 全局 click 重试——它会和播放按钮 onToggle 竞态，
        // 造成"点暂停 → 全局监听又自动 play"，暂停失效。
        if (!started) return;
        handlePlayRef.current().catch(() => { /* 失败交给用户手势 */ });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 自动开播已合并进上面的「getNow → handlePlay」串行流程（见该 effect 注释：
  // 两条异步并行会在慢网下造成同一首歌被两次设源、下载 abort 重来）。

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

      {/* 开始电台引导层（iOS autoplay 解锁 + 主人设备直达，二合一）
          已绑定主人设备（手机/电脑）由 started 初始值直达电台、永不渲染本层；
          其余设备（客人）只看到「▶ 开始电台」一个动作。
          「📍 这是我的设备，绑定为主人」按钮已下线（辛老师：两台主人设备已绑好）。 */}
      {!started && (
        <div className="start-overlay" onClick={handleStart} role="presentation">
          <div className="start-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="start-title">辛老师的 AI 电台</h2>
            <p className="start-sub">284 首你的歌 · 双语 DJ · 语音操控</p>

            <button type="button" className="start-btn magnetic" onClick={handleStart}>
              ▶ 开始电台
            </button>
            <p className="start-hint">点击开始听歌，DJ 会先跟你打个招呼</p>
          </div>
        </div>
      )}
    </div>
  );
}