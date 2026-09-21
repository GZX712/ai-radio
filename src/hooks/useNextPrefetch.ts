import { useEffect, useRef } from "react";
import { radioApi } from "@/lib/api";
import { prefetchAudio } from "@/lib/audioCache";
import { useRadioStore } from "@/store/useRadioStore";

/**
 * 播到这个比例后开始预取下一首。
 *
 * [2026-09-21] 0.85 → 0.5：单曲 10.6MB，85% 的余量在慢网下根本不够。
 * 实测 Slow 4G（约 200KB/s）拉完一首 13MB 要 60 秒以上，而一首 4 分钟的歌
 * 85% 只剩 36 秒 —— 预取必然赶不上，切歌照样白屏缓冲。提前到 50% 后
 * 余量约 2 分钟，慢网也能备齐（Blob 最多留 2 首，代价可控）。
 */
const THRESHOLD = 0.5;

/**
 * 下一首预取（封面 + 音频）。
 *
 * [2026-09-21 观感优化]
 * 背景：曲库单首平均 10.6MB（最大 16.6MB），原来的时序是「歌播完 → /api/next → 才开始下载」
 * → 切歌瞬间必然白屏 + 缓冲，这是辛老师反馈"卡顿、影响观感"的直接来源。
 *
 * 做法：播到 85% 时问后端要一次「下一首是谁」（/api/peek，只读不推进队列），
 * 然后静默把封面与音频塞进本地缓存；真正切歌时资源已在本地，起播几乎无等待。
 *
 * 音频不是用 <link rel=prefetch>，而是整首 fetch 成 Blob 存在 src/lib/audioCache.ts ——
 * 因为 COS 的 mp3 没有 Cache-Control（实测 header 为 null），<link> 预取进不了缓存，
 * 切歌照样重下 10MB。Blob 由前端自持，切歌命中即零网络（详见该文件注释）。
 *
 * 安全性：预取完全 best-effort —— 失败、被取消、后端没准备都没副作用，
 * 切歌逻辑仍然走原来的 /api/next 路径，不依赖本 hook。
 *
 * ※ 实现要点：本 effect 只做「一次性副作用」，**不注册任何 cleanup**。
 *   progress 每 250ms 更新一次会让 effect 反复执行，若在 cleanup 里取消预取，
 *   预取会在启动后立刻被自己取消掉（曾经踩过）。这里靠 doneRef 按 songmid 去重。
 */
export function useNextPrefetch() {
  const progress = useRadioStore((s) => s.progress);
  const duration = useRadioStore((s) => s.duration);
  const isPlaying = useRadioStore((s) => s.isPlaying);
  const songmid = useRadioStore((s) => s.now?.songmid);
  /** 已预取过的歌：同一次播放里只触发一次 */
  const doneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isPlaying || !songmid) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (progress / duration < THRESHOLD) return;
    if (doneRef.current === songmid) return;
    // [2026-09-21] 弱网/省流模式不预取：
    // 实测 Chrome 起播前要预读约 60 秒音频，慢网下当前曲自己都还在抢带宽；
    // 此时再整首预取下一首（10MB 量级）会把正在播的那首饿死 → 反而卡顿。
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return;
    doneRef.current = songmid;

    void (async () => {
      try {
        const next = await radioApi.peek();
        if (!next) return;

        // 1) 封面：Image 预热。COS 封面带 max-age=30d，命中后切歌瞬间显示
        if (next.picUrl) {
          const im = new Image();
          im.decoding = "async";
          im.src = next.picUrl;
        }

        // 2) 音频：整首拉成 Blob 存本地（切歌命中即零网络）。
        // COS 音频无 Cache-Control，靠 HTTP 缓存兜不住，必须前端自持（见 audioCache.ts）
        prefetchAudio(next.url);
      } catch {
        /* 预取失败：无副作用，切歌走原路径 */
      }
    })();
  }, [progress, duration, isPlaying, songmid]);
}
