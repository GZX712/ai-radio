import { create } from "zustand";
import type { NowPlaying } from "@/types";

/** 壁纸方案 ID（决定 .app 的 data-wallpaper 属性）
 * 注：用户上传图不再作为整页壁纸，而是作为 Player 卡片背景图（独立维度）。
 * 该类型只管整页 6 主题配色。 */
export type WallpaperId =
  | "pulse"   // 霓虹脉冲（默认 · 紫色 LED 频谱）
  | "mono"    // 02 极简黑白
  | "cream"   // 05 奶油新拟态
  | "glass"   // 06 玻璃拟态
  | "pop"     // 16 波普艺术
  | "comic";  // 23 复古漫画

export const WALLPAPERS: { id: WallpaperId; name: string; desc: string; palette: [string, string, string] }[] = [
  { id: "pulse",  name: "霓虹脉冲",   desc: "默认 · 紫青 LED",   palette: ["#9d00ff", "#00f3ff", "#0a0a0f"] },
  { id: "mono",   name: "极简黑白",   desc: "克制 · 干净",       palette: ["#ffffff", "#888888", "#0a0a0a"] },
  { id: "cream",  name: "奶油新拟态", desc: "浅灰 · 同色系凹凸", palette: ["#e6e9f6", "#6c7cff", "#9a8cff"] },
  { id: "glass",  name: "玻璃拟态",   desc: "通透 · 灵动",       palette: ["#a78bfa", "#60a5fa", "#1e1b4b"] },
  // Memphis 拼贴：粉 / 蓝绿 / 柠檬黄
  { id: "pop",    name: "波普艺术",   desc: "撞色 · 多色拼贴",   palette: ["#ff66b3", "#00d4d4", "#ffd93d"] },
  // 蝙蝠侠超英：黑 / 红 / 信号黄
  { id: "comic",  name: "复古漫画",   desc: "黑底 · 超英 KAPOW", palette: ["#0a0a0a", "#ff3030", "#ffd93d"] },
];

const VALID_WALLPAPERS = new Set<string>(WALLPAPERS.map(w => w.id));

function loadWallpaper(): WallpaperId {
  try {
    const v = localStorage.getItem("ai-radio-wallpaper");
    if (v && VALID_WALLPAPERS.has(v)) return v as WallpaperId;
    // 老版本可能存了 "custom" 或 "image" → 降级为 pulse
    if (v === "custom" || v === "image") return "pulse";
  } catch { /* ignore */ }
  return "pulse";
}

/** Player 卡片背景图：DataURL（jpg/png/webp），存 localStorage */
function loadPlayerBgImage(): string | null {
  // 迁移：老 ai-radio-custom-image（旧机制是整页）→ 自动迁移到 Player 卡片
  try {
    const old = localStorage.getItem("ai-radio-custom-image");
    const cur = localStorage.getItem("ai-radio-player-bg");
    if (!cur && old && typeof old === "string" && old.startsWith("data:image/")) {
      localStorage.setItem("ai-radio-player-bg", old);
      localStorage.removeItem("ai-radio-custom-image");
      localStorage.setItem("ai-radio-wallpaper", "pulse"); // 整页壁纸回默认
      return old;
    }
    if (cur && typeof cur === "string" && cur.startsWith("data:image/")) return cur;
  } catch { /* ignore */ }
  return null;
}

/** 清理老的 ai-radio-custom-colors / ai-radio-custom-image 键 */
function cleanupLegacyCustomKeys() {
  try {
    localStorage.removeItem("ai-radio-custom-colors");
    // ai-radio-custom-image 已经在 loadPlayerBgImage 里迁移并删除
  } catch { /* ignore */ }
}

interface RadioState {
  now: NowPlaying | null;
  djText: string; // 兼容旧字段
  djEn: string;
  djZh: string;
  djThinking: boolean; // DJ 正在生成回复（"正在酝酿"占位）
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  progress: number;
  duration: number;
  volume: number;
  playbackRate: number;

  // 音频压制（DJ 说话时音乐小声）
  duck: () => void;
  unDuck: () => void;

  // DJ 全局静音（用户按 ⏸ 后所有 DJ 语音不自动播，再按 ▶ 恢复）
  djMuted: boolean;
  setDjMuted: (muted: boolean) => void;

  // 搞笑音效开关（切歌/段子/聊天时随机播放，localStorage 持久化）
  sfxEnabled: boolean;
  toggleSfx: () => void;

  // 壁纸方案：只管整页 6 主题配色（玩家背景图走 playerBgImage 独立字段）
  wallpaperId: WallpaperId;
  setWallpaper: (id: WallpaperId) => void;
  /** 玩家卡片背景图 DataURL（铺满整个 .player 容器，独立于整页 wallpaper） */
  playerBgImage: string | null;
  setPlayerBgImage: (dataUrl: string | null) => boolean;

  setNow: (now: NowPlaying | null) => void;
  setDjText: (text: string) => void;
  setDjBilingual: (en: string, zh: string) => void;
  setDjThinking: (thinking: boolean) => void;
  clearDj: () => void;
  setIsPlaying: (playing: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setProgress: (p: number) => void;
  setDuration: (d: number) => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (r: number) => void;
  setDuckCallbacks: (duck: () => void, unDuck: () => void) => void;
}

const noop = () => {};

export const useRadioStore = create<RadioState>((set, get) => ({
  now: null,
  djText: "",
  djEn: "",
  djZh: "",
  djThinking: false,
  isPlaying: false,
  isLoading: false,
  error: null,
  progress: 0,
  duration: 0,
  volume: 1,
  playbackRate: 1,

  duck: noop,
  unDuck: noop,
  djMuted: false,
  setDjMuted: (djMuted) => set({ djMuted }),
  sfxEnabled: (() => {
    try {
      return localStorage.getItem("ai-radio-sfx") !== "off";
    } catch {
      return true;
    }
  })(),
  toggleSfx: () =>
    set((s) => {
      const next = !s.sfxEnabled;
      try {
        localStorage.setItem("ai-radio-sfx", next ? "on" : "off");
      } catch { /* ignore */ }
      return { sfxEnabled: next };
    }),

  wallpaperId: loadWallpaper(),
  setWallpaper: (id) =>
    set(() => {
      try { localStorage.setItem("ai-radio-wallpaper", id); } catch { /* ignore */ }
      return { wallpaperId: id };
    }),

  playerBgImage: (() => {
    cleanupLegacyCustomKeys(); // 清掉老的 customColors 残留 + 迁移 ai-radio-custom-image
    return loadPlayerBgImage();
  })(),
  setPlayerBgImage: (dataUrl) => {
    try {
      if (dataUrl === null) {
        localStorage.removeItem("ai-radio-player-bg");
      } else {
        localStorage.setItem("ai-radio-player-bg", dataUrl);
      }
      set({ playerBgImage: dataUrl });
      return true;
    } catch {
      // QuotaExceededError 等
      return false;
    }
  },

  setNow: (now) => set({ now }),
  setDjText: (djText) => set({ djText }),
  setDjBilingual: (djEn, djZh) => set({ djEn, djZh, djText: djEn, djThinking: false }),
  setDjThinking: (djThinking) => set({ djThinking }),
  clearDj: () => set({ djEn: "", djZh: "", djText: "" }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setDuckCallbacks: (duck, unDuck) => set({ duck, unDuck }),
}));
