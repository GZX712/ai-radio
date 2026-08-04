import { create } from "zustand";
import type { NowPlaying } from "@/types";

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