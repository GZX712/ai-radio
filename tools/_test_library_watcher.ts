/**
 * 曲库热刷新回归测试（tools/_test_library_watcher.ts）
 *
 * 目的：验证 musicQueue.startLibraryWatcher() 能在「服务不重启」的前提下，
 * 把云端新增的歌曲追加进队列。
 *
 * 做法：伪造一个 MusicSource（不碰网络），先把歌单伪装成 40 首 → init；
 * 再把「云端歌单」改成 42 首 → 看队列是否自动变成 42。
 *
 * 运行：node node_modules/tsx/dist/cli.mjs tools/_test_library_watcher.ts
 */
import { musicQueue } from "../server/services/musicQueue";

const base = Array.from({ length: 40 }, (_, i) => `L${String(i + 1).padStart(4, "0")}`);
let cloud: string[] = [...base];

const song = (id: string) => ({
  songmid: id,
  name: `测试歌 ${id}`,
  artist: "TEST",
  url: "http://127.0.0.1:1/fake.mp3",
  picUrl: undefined,
  lyric: "",
});

// 伪装音乐源：只需要实现 MusicSource 接口里真正会被调用到的方法
const fakeSource = {
  sourceName: "FAKE-COS",
  search: async () => [],
  getSongUrl: async () => "http://127.0.0.1:1/fake.mp3",
  getSongDetail: async (ids: string | string[]) => (Array.isArray(ids) ? ids : [ids]).map(song),
  getLyric: async () => "",
  getPlayableIds: async (ids: string[]) => new Set(ids),
  getCompleteSong: async (id: string) => song(id),
  getPlaylistTrackIds: async () => [...cloud],
};

// 私有字段在运行时就是普通属性，直接替换
(musicQueue as unknown as { musicSource: unknown }).musicSource = fakeSource;

const size = () => musicQueue.getQueueInfo().queueSize;
let failed = false;

async function main() {
  await musicQueue.init();
  const s0 = size();
  console.log(`[test] init 完成，队列 = ${s0} 首`);
  if (s0 !== 40) {
    console.log(`[test] FAIL: 期望 40，实际 ${s0}`);
    failed = true;
  }

  musicQueue.startLibraryWatcher(700); // 700ms 一次，加快验证

  setTimeout(() => {
    cloud = [...base, "L0041", "L0042"];
    console.log("[test] 模拟云端新增 2 首（L0041 / L0042）");
  }, 400);

  await new Promise((r) => setTimeout(r, 2600));

  const s1 = size();
  const ok = s1 === 42;
  console.log(`[test] 热刷新后队列 = ${s1} 首 → ${ok ? "PASS" : "FAIL"}`);
  if (!ok) failed = true;

  // 再等一轮，确认不会重复追加（幂等）
  await new Promise((r) => setTimeout(r, 1600));
  const s2 = size();
  const idem = s2 === 42;
  console.log(`[test] 重复检查一轮后队列 = ${s2} 首 → ${idem ? "PASS（幂等，未重复追加）" : "FAIL"}`);
  if (!idem) failed = true;

  console.log(failed ? "[test] 结果：FAIL" : "[test] 结果：全部 PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[test] 异常:", e);
  process.exit(1);
});
