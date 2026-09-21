import { useEffect, useRef } from "react";
import { radioApi } from "@/lib/api";
import { useRadioStore } from "@/store/useRadioStore";

/** 播到这个比例后开始预取下一首（85% ≈ 30 秒余量，足够拉完一首 10MB 的歌） */
const THRESHOLD = 0.85;
/** 预取用的 <link> 存活时长：够下载就行，之后撤掉不挂 DOM */
const LINK_TTL_MS = 120_000;

/**
 * 下一首预取（封面 + 音频）。
 *
 * [2026-09-21 观感优化]
 * 背景：曲库单首平均 10.6MB（最大 16.6MB），原来的时序是「歌播完 → /api/next → 才开始下载」
 * → 切歌瞬间必然白屏 + 缓冲，这是辛老师反馈"卡顿、影响观感"的直接来源。
 *
 * 做法：播到 85% 时问后端要一次「下一首是谁」（/api/peek，只读不推进队列），
 * 然后静默把封面与音频塞进浏览器缓存；真正切歌时资源已在本地，起播几乎无等待。
 *
 * 安全性：预取完全 best-effort —— 失败、被取消、后端没准备都没副作用，
 * 切歌逻辑仍然走原来的 /api/next 路径，不依赖本 hook。
 *
 * ※ 实现要点：本 effect 只做「一次性副作用」，**不注册任何 cleanup**。
 *   progress 每 250ms 更新一次会让 effect 反复执行，若在 cleanup 里取消预取，
 *   预取会在启动后立刻被自己取消掉（曾经踩过）。这里靠 doneRef 按 songmid 去重，
 *    <link> 由定时器自行回收。
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

        // 2) 音频：<link rel=prefetch> 静默拉取。
        // 注意：COS 音频目前未设 Cache-Control，能命中多少取决于浏览器会话缓存；
        // 后端补上 cache-control 后此处收益会拉满。
        if (next.url) {
          const link = document.createElement("link");
          link.rel = "prefetch";
          link.as = "audio";
          link.href = next.url;
          link.crossOrigin = "anonymous";
          document.head.appendChild(link);
          window.setTimeout(() => link.remove(), LINK_TTL_MS);
        }
      } catch {
        /* 预取失败：无副作用，切歌走原路径 */
      }
    })();
  }, [progress, duration, isPlaying, songmid]);
}
