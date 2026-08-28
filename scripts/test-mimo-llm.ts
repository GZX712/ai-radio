import fs from "node:fs";
import path from "node:path";
const envFile = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { llm } = await import("../server/services/llm/doubao");
console.log("当前主力:", llm.name, "| model:", (llm as { model?: string }).model ?? "");
const t0 = Date.now();
const r = await llm.chat({
  system: "你是一个幽默电台 DJ，用一句话介绍下一首歌，轻松有趣，20字内。",
  messages: [{ role: "user", content: "接下来播放的是周杰伦的《晴天》" }],
});
console.log("话术:", r);
console.log("耗时:", Date.now() - t0, "ms");
