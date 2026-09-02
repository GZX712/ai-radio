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
  | "custom"; // 🎨 自定义（用户自由调色）

/** HSL 三元组 */
export interface HSL {
  /** H: 0-360 */
  h: number;
  /** S: 0-100（百分比） */
  s: number;
  /** L: 0-100（百分比） */
  l: number;
}

/**
 * 自定义壁纸：把 UI 拆成 7 个 design token，每个 token 独立一个 HSL 三元组，
 * 这样可以做到"背景一个颜色、卡片一个颜色、文字一个颜色、accent 一个颜色"等
 * 真正独立的设计器。频谱紫色 LED 不参与切换。
 */
export interface CustomColors {
  bg: HSL;          // 背景
  surface: HSL;     // 卡片 / 容器
  surfaceAlt: HSL;  // 次级背景（输入框 / 凹陷区）
  text: HSL;        // 主文字
  textSoft: HSL;    // 次文字
  accent: HSL;      // 强调色（按钮 / 进度条 / 链接）
  border: HSL;      // 边框 / 分隔线
}

/** token 配置（给色轮设计器 UI 用） */
export interface CustomTokenDef {
  key: keyof CustomColors;
  label: string;
  hint: string;
}

export const CUSTOM_TOKEN_LIST: CustomTokenDef[] = [
  { key: "bg",         label: "背景",   hint: "页面底色" },
  { key: "surface",    label: "卡片",   hint: "容器 / 面板" },
  { key: "surfaceAlt", label: "次级",   hint: "输入框 / 凹陷" },
  { key: "text",       label: "主文字", hint: "标题 / 重要文字" },
  { key: "textSoft",   label: "次文字", hint: "辅助 / 弱化" },
  { key: "accent",     label: "强调色", hint: "按钮 / 进度条" },
  { key: "border",     label: "边框",   hint: "分隔线 / 卡片边" },
];

/** 默认配色（基于"霓虹脉冲"基色：紫底 / 青主色 / 白文字） */
export const DEFAULT_CUSTOM: CustomColors = {
  bg:         { h: 265, s: 70,  l: 8  },
  surface:    { h: 265, s: 55,  l: 14 },
  surfaceAlt: { h: 265, s: 45,  l: 10 },
  text:       { h: 240, s: 20,  l: 92 },
  textSoft:   { h: 240, s: 15,  l: 78 },
  accent:     { h: 195, s: 100, l: 50 },
  border:     { h: 265, s: 50,  l: 22 },
};

/** 单 token 内部 patch（用于色轮 onChange） */
export type CustomTokenPatch = Partial<Record<keyof CustomColors, Partial<HSL>>>;

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
    if (v === "custom" || (v && VALID_WALLPAPERS.has(v))) return v as WallpaperId;
  } catch { /* ignore */ }
  return "pulse";
}

const CUSTOM_KEYS: Array<keyof CustomColors> = ["bg", "surface", "surfaceAlt", "text", "textSoft", "accent", "border"];
const isHSL = (v: unknown): v is HSL =>
  !!v && typeof v === "object" &&
  typeof (v as HSL).h === "number" &&
  typeof (v as HSL).s === "number" &&
  typeof (v as HSL).l === "number";

/**
 * 把老的扁平 {hue, sat, light} 派生为 7 token 结构（迁移用）。
 * 老的 single HSL 主要是 bg 一个色，现在拆分为多 token：bg/表面用偏暗版，
 * accent 用补色偏亮版，text/border 取协调色。
 */
function legacyPatch(bg: HSL): CustomColors {
  const { h, s } = bg;
  return {
    bg:         { h, s,                l: Math.max(4,  bg.l - 42) },
    surface:    { h, s: Math.max(20, s - 15), l: Math.max(8,  bg.l - 36) },
    surfaceAlt: { h, s: Math.max(20, s - 25), l: Math.max(6,  bg.l - 40) },
    text:       { h: 240, s: 20,        l: 92 },
    textSoft:   { h: 240, s: 15,        l: 78 },
    accent:     { h: (h + 180) % 360, s: 95, l: Math.min(75, Math.max(45, bg.l + 10)) },
    border:     { h, s: Math.max(20, s - 20), l: Math.max(10, bg.l - 28) },
  };
}

function loadCustomColors(): CustomColors {
  try {
    const raw = localStorage.getItem("ai-radio-custom-colors");
    if (!raw) return DEFAULT_CUSTOM;
    const obj = JSON.parse(raw);
    // 老的扁平 {hue, sat, light}
    if (
      typeof (obj as Record<string, unknown>)?.hue === "number" &&
      typeof (obj as Record<string, unknown>)?.sat === "number" &&
      typeof (obj as Record<string, unknown>)?.light === "number"
    ) {
      return legacyPatch({ h: obj.hue, s: obj.sat, l: obj.light });
    }
    // 新结构（每个 token 一个 HSL，缺失字段用默认）
    const merged = { ...DEFAULT_CUSTOM };
    for (const k of CUSTOM_KEYS) {
      const slot = (obj as Record<string, unknown>)?.[k];
      if (isHSL(slot)) merged[k] = { ...DEFAULT_CUSTOM[k], ...slot };
    }
    return merged;
  } catch {
    return DEFAULT_CUSTOM;
  }
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

  // 壁纸方案：6 款配色 + 1 个自定义
  wallpaperId: WallpaperId;
  setWallpaper: (id: WallpaperId) => void;
  /** 用户自定义 7 token 颜色（仅 wallpaperId === "custom" 生效） */
  customColors: CustomColors;
  setCustomColors: (patch: CustomTokenPatch) => void;

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

  customColors: loadCustomColors(),
  setCustomColors: (patch: CustomTokenPatch) =>
    set((s) => {
      const next: CustomColors = { ...s.customColors };
      for (const k of Object.keys(patch) as Array<keyof CustomColors>) {
        const sl = patch[k];
        if (!sl) continue;
        next[k] = { ...next[k], ...sl };
      }
      try {
        localStorage.setItem("ai-radio-custom-colors", JSON.stringify(next));
      } catch { /* ignore */ }
      return { customColors: next };
    }),

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
