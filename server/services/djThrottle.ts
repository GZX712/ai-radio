/**
 * DJ 主动播报冷却（djThrottle）
 * [2026-09-07] 辛老师反馈"话术太密、没先后顺序"——切歌话术/天气串场/整点报时
 * 互相不打招呼，一个接一个往外冒。这里统一仲裁：
 * - 主动播报（切歌话术、天气/趣闻串场）之间至少间隔 COOLDOWN_MS；
 * - 冷却期内再次触发 → 静默让路（音乐照切，DJ 不开口）；
 * - 用户主动提问/聊天（chat 场景）豁免——永远秒回，绝不受冷却影响。
 *
 * 注意：与 djBusy（播放互斥锁，防"两条语音同时响"）职责不同。
 * djThrottle 管"频率/先后"，djBusy 管"同时播放"。两者配合使用。
 */

const COOLDOWN_MS = 15 * 60 * 1000; // 15 分钟（辛老师拍板：更安静）
let lastActiveAt = 0;

/**
 * 尝试占用一次主动播报机会。
 * @returns true = 放行（并记录本次播报时间）；false = 冷却中，请静默
 */
export function djThrottleCanSpeak(): boolean {
  const now = Date.now();
  if (lastActiveAt > 0 && now - lastActiveAt < COOLDOWN_MS) return false;
  lastActiveAt = now;
  return true;
}

/** 主动播报实际发出后调用（把时间点钉住，防止预检放行后生成失败导致冷却漏洞） */
export function djThrottleMarkSpoke(): void {
  lastActiveAt = Date.now();
}

/** 调试/状态查询 */
export function djThrottleStatus(): { lastActiveAt: number; cooldownMs: number; remainingMs: number } {
  const remaining = lastActiveAt > 0 ? COOLDOWN_MS - (Date.now() - lastActiveAt) : 0;
  return {
    lastActiveAt,
    cooldownMs: COOLDOWN_MS,
    remainingMs: Math.max(0, remaining),
  };
}

/** 测试辅助：重置冷却（仅测试脚本用） */
export function _djThrottleReset(): void {
  lastActiveAt = 0;
}
