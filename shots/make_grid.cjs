/**
 * 用 sharp 把 round3-shots 里的关键截图拼成对比图
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "round3-shots");
const cols = 3;
const rows = 3;
const w = 360;
const h = 700;

const filenames = [
  "01-chat-header.png",
  "02-settings-pulse.png",
  "03-settings-cream.png",
  "04-settings-pop.png",
  "08-settings-custom.png",
  "12-viewport-picker-scrolled.png",
  "14-narrow-picker-top.png",
  "16-narrow-picker-custom.png",
  "17-narrow-picker-custom-scrolled.png",
];

async function main() {
  const tileW = 360;
  const tileH = 720;
  const padX = 24;
  const padY = 24;
  const outW = tileW * cols + padX * 2;
  const outH = tileH * rows + padY * 2;

  // 创建深色底色合成图
  const composites = [];
  for (let i = 0; i < filenames.length; i++) {
    const fp = path.join(OUT_DIR, filenames[i]);
    if (!fs.existsSync(fp)) continue;
    const buf = await sharp(fp).resize(tileW, tileH, { fit: "contain", background: "#101014" }).toBuffer();
    const cx = padX + (i % cols) * tileW;
    const cy = padY + Math.floor(i / cols) * tileH;
    composites.push({ input: buf, left: cx, top: cy });
  }
  await sharp({
    create: { width: outW, height: outH, channels: 3, background: { r: 16, g: 16, b: 20 } }
  })
  .composite(composites)
  .png()
  .toFile(path.join(OUT_DIR, "_grid-overview.png"));
  console.log("saved _grid-overview.png");
}

main().catch(e => { console.error(e); process.exit(1); });
