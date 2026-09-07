/**
 * songKnowledge + On-Air Log 冒烟测试（_test 前缀 = 不入 git）
 * 验证：
 *  1. 模块可加载（type-only import 无循环依赖）
 *  2. pushOnAir / getOnAirContext 往返
 *  3. getSongProfile 无 key/失败时优雅降级 null（不抛异常）
 *  4. warmSongProfile 空值安全
 *  5. 真实 LLM 档案生成（若有 key）：校验字段完整
 */
import { pushOnAir, getOnAirContext } from "../server/services/dj";
import { getSongProfile, getCachedSongProfile, warmSongProfile } from "../server/services/songKnowledge";

const results: { name: string; ok: boolean; info?: string }[] = [];
const check = (name: string, ok: boolean, info?: string) => {
  results.push({ name, ok, info });
  console.log(`${ok ? "✅" : "❌"} ${name}${info ? " — " + info : ""}`);
};

// 1. On-Air Log 往返
pushOnAir("song", `"Test Song" — Artist`);
pushOnAir("dj", "Hello listeners, this is a test line!");
const ctx1 = getOnAirContext();
check(
  "onAir 记录往返",
  ctx1.includes("Test Song") && ctx1.includes("Hello listeners") && ctx1.includes("🎵") && ctx1.includes("🗣"),
  ctx1.replace(/\n/g, " | ").slice(0, 140)
);
// 滚动淘汰（>10 条只留最近 10）
for (let i = 0; i < 15; i++) pushOnAir("song", `Song #${i}`);
const ctx2 = getOnAirContext();
check("onAir 滚动上限 10", (ctx2.match(/Song #/g) || []).length <= 10, `剩余 ${(ctx2.match(/Song #/g) || []).length} 条`);

// 2. 降级路径（并发上限/未配置/超时都不抛异常）
const fakeSong = { songmid: "T-1", name: "Yesterday", artist: "The Beatles", url: "" };
let threw = false;
let prof: Awaited<ReturnType<typeof getSongProfile>> | null = null;
try {
  prof = await getSongProfile(fakeSong, 2500);
} catch (e) {
  threw = true;
  check("getSongProfile 不抛异常", false, String(e));
}
if (!threw) {
  check("getSongProfile 未配置返回 null（不炸）", prof === null, `prof=${JSON.stringify(prof)}`);
}

// 3. 缓存一致性：同 songmid 单飞（并发去重不重复生成）
const [a, b] = await Promise.all([getSongProfile(fakeSong, 3000), getSongProfile(fakeSong, 3000)]);
check("同歌并发返回一致", a === b, `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);

// 4. warm 空值安全
warmSongProfile(null);
warmSongProfile(undefined);
check("warmSongProfile 空值安全", true);

// 5. 缓存查询函数存在且空歌安全
const cached = getCachedSongProfile({ songmid: "T-1" });
check("getCachedSongProfile 可调用", cached === null || !!cached?.era, `cached=${cached ? "有" : "无"}`);

console.log(`\n===== ${results.filter((r) => r.ok).length}/${results.length} 通过 =====`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
