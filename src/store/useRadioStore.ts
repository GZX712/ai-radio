import { create } from "zustand";
import type { NowPlaying } from "@/types";

/** 壁纸方案 ID（决定 .app 的 data-wallpaper 属性） */
export type WallpaperId =
  | "pulse"   // 霓虹脉冲（默认 · 紫色 LED 频谱）
  | "mono"    // 02 极简黑白
  | "cream"   // 05 奶油新拟态
  | "glass"   // 06 玻璃拟态
  | "pop"     // 16 波普艺术
  | "comic"   // 23 复古漫画
  | "image";  // 🖼️ 自定义图片壁纸（用户上传的图作为底部背景）

export const WALLPAPERS: { id: WallpaperId; name: string; desc: string; palette: [string, string, string] }[] = [
  { id: "pulse",  name: "霓虹脉冲",   desc: "默认 · 紫青 LED",   palette: ["#9d00ff", "#00f3ff", "#0a0a0f"] },
  { id: "mono",   name: "极简黑白",   desc: "克制 · 干净",       palette: ["#ffffff", "#888888", "#0a0a0a"] },
  { id: "cream",  name: "奶油新拟态", desc: "浅灰 · 同色系凹凸", palette: ["#e6e9f2", "#6c7cff", "#9a8cff"] },
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
    // 老版本可能存了 "custom"（旧调色盘方案）→ 降级为 pulse
    if (v === "custom") return "pulse";
  } catch { /* ignore */ }
  return "pulse";
}

/** 自定义图片壁纸：DataURL 字符串（jpg/png/webp），存 localStorage */
function loadCustomImage(): string | null {
  try {
    const v = localStorage.getItem("ai-radio-custom-image");
    if (!v) return null;
    // 仅接受图片 DataURL
    if (typeof v === "string" && v.startsWith("data:image/")) return v;
  } catch { /* ignore */ }
  return null;
}

/** 清理老的 ai-radio-custom-colors 键（避免用户被新机制意外污染） */
function cleanupLegacyCustomColors() {
  try { localStorage.removeItem("ai-radio-custom-colors"); } catch { /* ignore */ }
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

  // 壁纸方案：6 款配色 + 1 个自定义图片
  wallpaperId: WallpaperId;
  setWallpaper: (id: WallpaperId) => void;
  /** 用户上传的图片壁纸 DataURL（仅 wallpaperId === "image" 生效） */
  customImage: string | null;
  setCustomImage: (dataUrl: string | null) => boolean; // 失败（quota 等）返回 false

  /** 用户上传的播放器封面图 DataURL（无歌曲 picUrl 时显示） */
  customCover: string | null;
  setCustomCover: (dataUrl: string | null) => boolean;

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

  customImage: (() => {
    cleanupLegacyCustomColors(); // 清掉老的 customColors 残留
    return loadCustomImage();
  })(),
  setCustomImage: (dataUrl) => {
    try {
      if (dataUrl === null) {
        localStorage.removeItem("ai-radio-custom-image");
      } else {
        localStorage.setItem("ai-radio-custom-image", dataUrl);
      }
      set({ customImage: dataUrl });
      return true;
    } catch {
      // QuotaExceededError 等
      return false;
    }
  },

  customCover: (() => {
    try {
      const v = localStorage.getItem("ai-radio-player-cover");
      if (typeof v === "string" && v.startsWith("data:image/")) return v;
    } catch { /* ignore */ }
    return null;
  })(),
  setCustomCover: (dataUrl) => {
    try {
      if (dataUrl === null) {
        localStorage.removeItem("ai-radio-player-cover");
      } else {
        localStorage.setItem("ai-radio-player-cover", dataUrl);
      }
      set({ customCover: dataUrl });
      return true;
    } catch {
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
