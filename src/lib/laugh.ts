/**
 * sitcom 罐头笑声播放器
 * ------------------------------------------------------------------
 * DJ 讲完笑话 / 怼完人（funny 台词）之后，紧跟一段真实观众哄笑声，
 * 像《老友记》《生活大爆炸》《破产姐妹》的 laugh track。
 *
 * 素材：public/laughs/*.mp3（真实人群笑声，免费免版权 SoundDino）
 *   - laugh-crowd-burst.mp3  观众爆笑 5s
 *   - laugh-crowd-long.mp3   人群长笑 14s
 *
 * 播放策略：
 *   - 随机挑素材 + 随机起始点（不从 0 秒播，避免每次音头相同显机械）
 *   - 只截取 2-3 秒片段（罐头笑一般是短促一阵，太长了出戏）
 *   - 音量 0.55~0.7 随机（比 DJ 人声轻一点，盖过音乐但不刺耳）
 *   - 冷却 6 秒：两次笑之间留间隔，避免"每句都笑"的廉价感
 *   - 尊重全局"搞笑音效"开关（sfxEnabled 关闭时一律不笑）
 */
import { useRadioStore } from "@/store/useRadioStore";

const TRACKS = [
  { url: "/laughs/laugh-crowd-burst.mp3", dur: 5.0 },
  { url: "/laughs/laugh-crowd-long.mp3", dur: 14.0 },
];

let lastLaughAt = 0;
let current: HTMLAudioElement | null = null;

/**
 * 播放一段罐头笑声。
 */
export function playLaughTrack(): void {
  // 全局搞笑音效开关（与 sfx 同开关，音效关 = 罐头笑也不响）
  if (!useRadioStore.getState().sfxEnabled) return;

  const now = Date.now();
  if (now - lastLaughAt < 6000) return; // 冷却：两次笑 ≥ 6s
  lastLaughAt = now;

  try {
    const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    const audio = new Audio();
    audio.src = track.url;
    // 随机音量 0.5~0.72
    audio.volume = 0.5 + Math.random() * 0.22;
    // 随机起始点：避开静音音头，从 0.4s ~ 1.6s 之间起播
    const start = Math.min(0.4 + Math.random() * 1.2, Math.max(0, track.dur - 3));
    audio.currentTime = start;
    // 只播 2~3.2 秒就收（罐头笑短促才有 sitcom 感）
    const playMs = 2000 + Math.random() * 1200;
    audio.play().catch(() => { /* 自动播放被拒（未解锁）静默 */ });
    current = audio;
    window.setTimeout(() => {
      try {
        audio.pause();
        audio.src = "";
      } catch { /* ignore */ }
      if (current === audio) current = null;
    }, playMs);
  } catch {
    /* 播放失败不影响 DJ */
  }
}

/** 立即掐断当前罐头笑（切歌/暂停等场景用） */
export function stopLaughTrack(): void {
  try {
    if (current) {
      current.pause();
      current.src = "";
      current = null;
    }
  } catch { /* ignore */ }
}
