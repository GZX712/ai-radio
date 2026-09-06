/**
 * 冒烟测试：COS 音乐库模式
 * 本地起 http.server serve library/ 模拟 COS，验证：
 * - init() queue = 97（manifest 读取）
 * - getCompleteSong 返回 COS URL（中文文件名 URL 编码）
 * - getPlayableIds 全量返回（本地文件全可播）
 * - search 本地模糊匹配
 */
import { readFileSync } from "node:fs";

const envRaw = readFileSync(new URL("../.env", import.meta.url), "utf-8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && (m[1] === "NETEASE_COOKIE" || m[1] === "COS_LIBRARY" || m[1] === "COS_BASE_URL")) {
    process.env[m[1]] = m[2];
  }
}
process.env.COS_LIBRARY = "1";
process.env.COS_BASE_URL = "http://127.0.0.1:8899";

const { musicQueue } = await import("../server/services/musicQueue.ts");
const { musicService, isCosLibraryMode } = await import("../server/services/music.ts");

console.log("=== 冒烟：COS 音乐库模式 ===");
console.log("isCosLibraryMode:", isCosLibraryMode());

await musicQueue.init();
const q = musicQueue.getQueueInfo();
console.log(`queue=${q.queueSize} playlistName=${q.playlistName}`);
console.log(`playlistName 应为 COS 库: ${q.playlistName.includes("COS") || q.playlistName.includes("我喜欢的音乐") ? "OK" : "?"}`);

// 取第一首完整信息
const first = await musicService.getCompleteSong("L0001");
console.log("\n第一首:");
console.log(`  name=${first.name}`);
console.log(`  artist=${first.artist}`);
console.log(`  url=${first.url}`);
const urlOk = first.url.startsWith("http://127.0.0.1:8899/songs/") ? "PASS" : "FAIL";
console.log(`  URL 前缀: ${urlOk}`);

// 测试带中文的歌曲
const chinese = await musicService.getCompleteSong("L0003"); // CINDY - 私達を信じていて
console.log(`\n中文名歌曲: ${chinese.name} -> ${chinese.url.slice(0, 80)}...`);
const encOk = chinese.url.includes("%") ? "PASS(已编码)" : "FAIL(未编码)";
console.log(`  编码: ${encOk}`);

// 歌词（COS 模式应为空）
const lyric = await musicService.getLyric("L0001");
console.log(`\n歌词(COS 模式应为空): "${lyric.slice(0, 30)}" ${lyric === "" ? "PASS" : "FAIL"}`);

// 搜索
const hits = await musicService.search("Ed", 5);
console.log(`\n搜索 'Ed': ${hits.length} 条`, hits.slice(0, 2).map((h) => `${h.artist}-${h.name}`));

// 预筛
const playable = await musicService.getPlayableIds(["L0001", "L0002", "L0003"]);
console.log(`预筛 3 首可播: ${playable.size}/3 ${playable.size === 3 ? "PASS" : "FAIL"}`);

console.log("\n=== 结论 ===");
if (q.queueSize === 97 && urlOk === "PASS") {
  console.log("PASS: COS 模式队列 97 + URL 正确");
} else {
  console.log("FAIL/WARN");
}
process.exit(0);
