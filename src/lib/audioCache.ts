/**
 * 音频 blob 缓存（前端本地，零凭证）。
 *
 * [2026-09-21 切歌观感优化 · 第二轮]
 * 问题：COS 上 `songs/*.mp3` 的响应头 `cache-control` 是 null（实测），浏览器**完全不缓存**，
 *      而单首均值 10.6MB / 最大 16.6MB → 每次切歌都要重下整首，必然白屏缓冲。
 *      改 COS 元数据需要密钥（会阻塞），改用前端自持缓存绕开。
 *
 * 做法：预取时把整首 fetch 成 Blob → `URL.createObjectURL` 存住；真正切歌时若命中
 *      就用 blob: 地址播放 —— 零网络、零 Range 请求、可瞬时 seek。
 *
 * 已验证（scripts/_test_blob_audio.cjs）：blob 源 + `crossOrigin="anonymous"` +
 * `createMediaElementSource` 不会被判异源污染，analyser 波形峰值与 COS 直链一致
 * （peak 47 / currentTime 1.81s vs 1.88s / readyState 4），不会静音。
 *
 * 容量策略：最多留 2 首（≈20–33MB）。淘汰时跳过"正在播放"那首，且先 revoke 旧 objectURL，
 * 避免内存里堆积整首音频。全部 best-effort：任何一步失败都退回原始 COS 直链。
 */

/** 最多缓存几首（1 首够切歌，留 2 首让"上一首"也可能命中；再大对手机内存不友好） */
const MAX_ENTRIES = 2;

interface CacheEntry {
  objectUrl: string;
  /** 最近使用时间，淘汰用 */
  at: number;
}

const cache = new Map<string, CacheEntry>();
/** 正在下载中的 key，防重复拉取 */
const inflight = new Set<string>();
/** 正在播放的 key：淘汰时保护，revoke 掉正在播的 objectURL 会立刻静音 */
let pinnedKey: string | null = null;

/** 命中则返回可直接赋给 audio.src 的 blob 地址 */
export function getCachedAudioUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const hit = cache.get(url);
  if (!hit) return undefined;
  hit.at = Date.now();
  return hit.objectUrl;
}

/** 标记当前正在播放的源（传 undefined 表示没有 blob 在用） */
export function pinPlayingAudio(url: string | undefined): void {
  pinnedKey = url && cache.has(url) ? url : null;
}

/** 观测用：当前缓存条目数（调试面板 / 测试） */
export function audioCacheSize(): number {
  return cache.size;
}

function evict() {
  while (cache.size > MAX_ENTRIES) {
    let victim: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, entry] of cache) {
      if (key === pinnedKey) continue; // 正在播的不能动
      if (entry.at < oldest) {
        oldest = entry.at;
        victim = key;
      }
    }
    if (!victim) return; // 全被 pin 住（理论上不会）→ 放弃淘汰而不是误伤播放
    const gone = cache.get(victim);
    cache.delete(victim);
    if (gone) {
      try {
        URL.revokeObjectURL(gone.objectUrl);
      } catch {
        /* 已 revoke / 不支持的实现：忽略 */
      }
    }
  }
}

/**
 * 静默预取整首音频并缓存。best-effort：失败什么都不做，切歌走原直链路径。
 * 幂等：已在缓存或正在下载中直接返回。
 */
export function prefetchAudio(url: string | undefined): void {
  if (!url || !/^https?:/i.test(url)) return; // 只管 http(s)，blob:/data: 无需缓存
  if (cache.has(url) || inflight.has(url)) return;
  inflight.add(url);

  void (async () => {
    try {
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error("empty body");
      const objectUrl = URL.createObjectURL(blob);
      // 下载期间可能已被别的路径缓存（并发/重复调用）→ 以先到的为准，丢弃本次
      if (cache.has(url)) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      cache.set(url, { objectUrl, at: Date.now() });
      evict();
    } catch {
      /* 预取失败无副作用 */
    } finally {
      inflight.delete(url);
    }
  })();
}

/** 退出前清空（可选，页面卸载时调用避免残留大 Blob） */
export function clearAudioCache(): void {
  for (const [, entry] of cache) {
    try {
      URL.revokeObjectURL(entry.objectUrl);
    } catch {
      /* noop */
    }
  }
  cache.clear();
  inflight.clear();
  pinnedKey = null;
}
