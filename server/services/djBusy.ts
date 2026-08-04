/**
 * DJ 广播互斥锁
 * 同一时刻只生成/广播一条 DJ（防"跳说"：切歌 transition + 天气/趣闻同时触发时抢播）
 */

let busy = false;

export function isDjBusy(): boolean {
  return busy;
}

/**
 * 获取锁执行任务。锁被占用时返回 false（任务跳过）
 */
export async function withDjLock(fn: () => Promise<void>): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    await fn();
    return true;
  } finally {
    busy = false;
  }
}