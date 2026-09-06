/**
 * 续播记忆（Resume）：
 * 把"正在播放的这首歌 + 播放进度"持久化到 localStorage。
 * 用户暂停/关闭/刷新页面后重新打开，能**接着上次没播完的那首继续**，
 * 而不是重新拉一首新的从头播（辛老师需求：暂停后重开继续播放没放完的）。
 */
export interface ResumeState {
  songmid: string;
  name: string;
  artist: string;
  url: string;
  /** 上次播放位置（秒） */
  progress: number;
  /** 歌曲总时长（秒，可能为 NaN/Infinity 流媒体） */
  duration: number;
  /** 上次保存时是否处于播放中（true=自动续播，false=恢复位置等用户点） */
  playing: boolean;
  savedAt: number;
}

const KEY = "ai-radio-resume-v1";

export function saveResume(state: Omit<ResumeState, "savedAt">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    /* localStorage 满/禁用：忽略，续播记忆非关键功能 */
  }
}

export function loadResume(): ResumeState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ResumeState;
    if (!p?.url || !p?.songmid) return null; // 缺关键字段视为无效
    return p;
  } catch {
    return null;
  }
}

export function clearResume(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
