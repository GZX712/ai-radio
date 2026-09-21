/**
 * audioCache 单元验证：命中 / 去重 / 淘汰 / pin 保护 / 非法输入。
 * 用桩 fetch + 桩 URL.createObjectURL，不联网。
 * 运行：node node_modules/tsx/dist/cli.mjs scripts/_test_audio_cache.ts
 */
import {
  audioCacheSize,
  clearAudioCache,
  getCachedAudioUrl,
  pinPlayingAudio,
  prefetchAudio,
} from "../src/lib/audioCache";

let created = 0;
let revoked = 0;
let fetchCalls = 0;

function stub(): void {
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
    created += 1;
    return `blob:test/${created}`;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {
    revoked += 1;
  };
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    fetchCalls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array(1024).fill(7)]),
      __url: url,
    };
  };
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);

(async () => {
  stub();

  // 1) 基本命中
  prefetchAudio("https://cos/a.mp3");
  prefetchAudio("https://cos/a.mp3"); // 并发去重
  await tick();
  const a = getCachedAudioUrl("https://cos/a.mp3");
  check("预取后可命中 blob 地址", !!a && a.startsWith("blob:"), String(a));
  check("并发重复预取只发一次请求", fetchCalls === 1, `fetchCalls=${fetchCalls}`);
  check("缓存条目数=1", audioCacheSize() === 1, String(audioCacheSize()));
  check("已缓存的不再重复下载", (() => { prefetchAudio("https://cos/a.mp3"); return fetchCalls === 1; })(), `fetchCalls=${fetchCalls}`);

  // 2) 非法输入不缓存
  prefetchAudio(undefined);
  prefetchAudio("blob:test/1");
  prefetchAudio("data:audio/mp3;base64,AA");
  await tick();
  check("非 http(s) 源不发起预取", fetchCalls === 1, `fetchCalls=${fetchCalls}`);
  check("undefined 查询返回 undefined", getCachedAudioUrl(undefined) === undefined);

  // 3) 淘汰：最多留 2 条，且 revoke 旧地址
  prefetchAudio("https://cos/b.mp3");
  await tick();
  prefetchAudio("https://cos/c.mp3");
  await tick();
  check("超限后条目数=2", audioCacheSize() === 2, String(audioCacheSize()));
  check("最旧的 a 被淘汰", getCachedAudioUrl("https://cos/a.mp3") === undefined);
  check("b/c 仍命中", !!getCachedAudioUrl("https://cos/b.mp3") && !!getCachedAudioUrl("https://cos/c.mp3"));
  check("淘汰时 revoke 了地址", revoked === 1, `revoked=${revoked}`);

  // 4) pin 保护：正在播的不会被淘汰
  pinPlayingAudio("https://cos/b.mp3");
  prefetchAudio("https://cos/d.mp3");
  await tick();
  prefetchAudio("https://cos/e.mp3");
  await tick();
  check("pin 住的 b 未被淘汰", !!getCachedAudioUrl("https://cos/b.mp3"));
  check("未 pin 的 c 被淘汰", getCachedAudioUrl("https://cos/c.mp3") === undefined);

  // 5) 清空
  clearAudioCache();
  check("清空后条目数=0", audioCacheSize() === 0);

  let bad = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) bad += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
  }
  console.log(`\n${results.length - bad}/${results.length} 通过`);
  process.exit(bad === 0 ? 0 : 1);
})();
