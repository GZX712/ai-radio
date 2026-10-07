import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { useRadioStore } from "@/store/useRadioStore";
import { Visualizer } from "./Visualizer";
import { PixelCover } from "./PixelCover";
import { buildLetterCoverSvg } from "../lib/coverArt";

interface PlayerProps {
  onToggle: () => Promise<void>;
  onSkip: () => Promise<void>;
  onPrev: () => Promise<void>;
  onSeek: (delta: number) => void;
  onSeekTo: (pct: number) => void;
  onSetRate: (rate: number) => void;
  onSetVolume: (v: number) => void;
  getAnalyser: () => AnalyserNode | null;
  /** DJ Chat 嵌入槽（由 App 传入 ChatPanel 组件） */
  chatPanelSlot?: ReactNode;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

/**
 * Premium 播放器 v3：上一首/暂停/切歌 + ±15s + 倍速 + 进度点击跳转
 */
export function Player({
  onToggle,
  onSkip,
  onPrev,
  onSeek,
  onSeekTo,
  onSetRate,
  onSetVolume,
  getAnalyser,
  chatPanelSlot,
}: PlayerProps) {
  const now = useRadioStore((s) => s.now);
  const isPlaying = useRadioStore((s) => s.isPlaying);
  const isLoading = useRadioStore((s) => s.isLoading);
  const progress = useRadioStore((s) => s.progress);
  const duration = useRadioStore((s) => s.duration);
  const volume = useRadioStore((s) => s.volume);
  const rate = useRadioStore((s) => s.playbackRate);
  /** 用户上传的卡片背景图 DataURL（通过壁纸面板的"自定义壁纸"卡片触发上传） */
  const playerBgImage = useRadioStore((s) => s.playerBgImage);

  // picUrl 空时用字母封面 dataURL 兜底（COS 模式 97 首皆无封面）
  // useMemo 锁住 name/artist/songmid 三元组：同一首歌不重复 hash/拼字符串/URI 编码
  const songPicUrl = useMemo(
    () =>
      now?.picUrl ||
      buildLetterCoverSvg({
        name: now?.name ?? "",
        artist: now?.artist ?? "",
        songmid: now?.songmid,
      }),
    [now?.picUrl, now?.name, now?.artist, now?.songmid],
  );

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  // [2026-10-06] 进度条支持按住拖动（原来只有 onClick 点跳：
  // 手机上「点」能跳但辛老师要的是拖拽手感 —— pointer 事件系鼠标/触摸通吃）。
  // 拖动中只本地预览（不真 seek）：每帧 move 都写 currentTime 会触发 COS Range
  // 请求风暴 + 与 timeupdate 回写打架；松手才一次性 seek。
  const [dragPct, setDragPct] = useState<number | null>(null);
  // [2026-10-07 黑屏根治] 拖动状态必须用 ref 判定、坐标必须在事件同步栈里算出。
  // 旧写法 setDragPct(cur => cur === null ? cur : pctFromPointer(e))：updater 由
  // React 在渲染阶段异步执行，届时合成事件已回收、e.currentTarget === null →
  // getBoundingClientRect 抛 TypeError → 整树卸载 → 辛老师手机上的「拖进度黑屏」。
  const draggingRef = useRef(false);
  const pctFromPointer = (e: React.PointerEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };
  const handleProgressDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId); // 拖出条外也能继续跟手
    setDragPct(pctFromPointer(e));
  };
  const handleProgressMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setDragPct(pctFromPointer(e)); // 同步算出数值再 set，事件对象不进 updater
  };
  const handleProgressUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) onSeekTo(pctFromPointer(e)); // 松手这一刻才真正 seek
    draggingRef.current = false;
    setDragPct(null);
  };
  const shownPercent = dragPct !== null ? dragPct * 100 : progressPercent;

  return (
    <main
      className="player"
      data-playing={isPlaying}
      data-player-bg={playerBgImage ? "on" : "off"}
      style={playerBgImage ? { backgroundImage: `url(${playerBgImage})` } : undefined}
    >
      <div className="cover-wrapper">
        {songPicUrl ? (
          <PixelCover src={songPicUrl} alt={now?.name || "Cover"} isPlaying={isPlaying} />
        ) : (
          <div className="cover-placeholder" />
        )}
      </div>

      <div className="meta">
        <div className="name">
          {isPlaying && <span className="play-indicator" aria-hidden="true" />}
          {now?.name ?? "NOT PLAYING"}
        </div>
        <div className="artist">{now?.artist ?? ""}</div>
      </div>

      <Visualizer analyser={getAnalyser()} isPlaying={isPlaying} />

      {/* 进度条（点击跳转 + 按住拖动） */}
      <div
        className="progress-bar"
        onPointerDown={handleProgressDown}
        onPointerMove={handleProgressMove}
        onPointerUp={handleProgressUp}
        onPointerCancel={handleProgressUp}
        role="slider"
        aria-label="Seek"
      >
        <div className="progress-fill" style={{ width: `${shownPercent}%` }} />
      </div>
      <div className="time-row">
        <span className="time">{formatTime(progress)}</span>
        <span className="time">{formatTime(duration)}</span>
      </div>

      {/* 控制条：上一首 -15 暂停/播放 +15 下一首（5 键紧凑） */}
      <div className="controls">
        <button
          type="button"
          onClick={onPrev}
          className="btn-secondary"
          disabled={isLoading}
          aria-label="上一首"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={() => onSeek(-15)}
          className="btn-secondary"
          aria-label="后退 15 秒"
        >
          -15
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="btn-primary magnetic"
          disabled={isLoading}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isLoading ? "..." : isPlaying ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => onSeek(15)}
          className="btn-secondary"
          aria-label="前进 15 秒"
        >
          +15
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="btn-secondary"
          disabled={isLoading}
          aria-label="下一首"
        >
          ⏭
        </button>
      </div>

      {/* 倍速 + 音量 */}
      <div className="aux-row">
        <select
          className="rate-select"
          value={rate}
          onChange={(e) => onSetRate(parseFloat(e.target.value))}
          aria-label="Playback speed"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>{r}x</option>
          ))}
        </select>
        <span className="aux-icon">🔊</span>
        <input
          type="range"
          className="volume-slider"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => onSetVolume(parseFloat(e.target.value))}
          aria-label="Volume"
        />
      </div>

      {/* [2026-10-07 底框规整·一体卡] DJ Chat 留在播放器卡片内（辛老师拍板：不要拆成
          两张独立卡，还是一体的）。「不工整」的病根不是嵌套，而是聊天面板自带
          背景+边框+毛玻璃 → 卡中卡双重框。CSS 侧已把它洗成透明 + 顶部一条
          通栏分割线，视觉上就是一整张卡的上下两节。 */}
      {chatPanelSlot}
    </main>
  );
}