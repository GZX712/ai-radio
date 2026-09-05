import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useRadioStore } from "@/store/useRadioStore";
import { Visualizer } from "./Visualizer";
import { PixelCover } from "./PixelCover";

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
  const playerBgImage = useRadioStore((s) => s.playerBgImage);
  const setPlayerBgImage = useRadioStore((s) => s.setPlayerBgImage);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  /** File → DataURL */
  const readAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("文件读取失败"));
      fr.readAsDataURL(file);
    });

  const handleBgFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return;
    try {
      const url = await readAsDataURL(file);
      setPlayerBgImage(url);
    } catch {
      /* 静默失败 */
    }
  };

  const handleBgClear = () => {
    setPlayerBgImage(null);
    if (bgInputRef.current) bgInputRef.current.value = "";
  };

  const songPicUrl = now?.picUrl;

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeekTo(Math.max(0, Math.min(1, pct)));
  };

  const hasBg = !!playerBgImage;

  return (
    <main
      className="player"
      data-playing={isPlaying}
      data-player-bg={hasBg ? "on" : "off"}
      style={hasBg ? { backgroundImage: `url(${playerBgImage})` } : undefined}
      onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleBgFile(e.dataTransfer.files?.[0]);
      }}
    >
      {/* 隐藏 file input（触发上传） */}
      <input
        ref={bgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="player-bg-file-input"
        onChange={(e) => handleBgFile(e.target.files?.[0])}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* 背景图状态微指示：拖拽时高亮 / 无图时显示 "＋ 上传背景" 按钮（hover 显，按钮靠右下） */}
      {hasBg ? (
        <button
          type="button"
          className="player-bg-btn player-bg-btn-clear"
          onClick={handleBgClear}
          title="清除自定义背景"
          aria-label="清除自定义背景"
        >
          ✕ 清除背景
        </button>
      ) : (
        <button
          type="button"
          className="player-bg-btn player-bg-btn-add"
          onClick={() => bgInputRef.current?.click()}
          title="上传自定义背景图（仅作用于播放器卡片）"
          aria-label="上传自定义背景图"
        >
          🖼 添加背景
        </button>
      )}

      {dragOver && (
        <div className="player-bg-dropzone" aria-hidden="true">
          <span>释放图片上传</span>
        </div>
      )}

      <div className="cover-wrapper">
        {songPicUrl ? (
          <PixelCover src={songPicUrl} alt={now.name || "Cover"} isPlaying={isPlaying} />
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

      {/* 进度条 */}
      <div className="progress-bar" onClick={handleProgressClick} role="slider" aria-label="Seek">
        <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
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

      {/* DJ Chat 嵌入槽（位于控制区下方，与播放器共享卡片样式） */}
      {chatPanelSlot}
    </main>
  );
}