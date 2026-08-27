import fs from "node:fs";
import path from "node:path";
import { ttsService } from "../server/services/tts";

// tsx 不自动加载 .env，手动灌入（本地脚本运行需要 MIMO_API_KEY）
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const lines = [
  "接下来这首歌，走着！",
  "换首歌，希望你喜欢！",
  "下一首，来咯！",
  "这首歌我超喜欢！",
  "换个心情，听点不一样的！",
];

async function main() {
  for (let i = 0; i < lines.length; i++) {
    try {
      const r = await ttsService.synthesize(lines[i], "transition", "Milo", "活泼、有活力、简短利落");
      console.log(`transition-${i + 1}: ${r.url}`);
    } catch (e) {
      console.error(`transition-${i + 1} FAIL:`, e instanceof Error ? e.message : e);
    }
  }
}
main();
