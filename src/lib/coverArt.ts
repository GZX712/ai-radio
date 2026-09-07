/**
 * coverArt.ts — 字母封面生成器（COS 模式无封面时 fallback）
 *
 * 输入：歌曲名 + 艺人 + (可选) songmid
 * 输出：data URL 形式的 SVG，喂给 <PixelCover src={...}> 复用整条马赛克翻转特效管线
 * 风格：Spotify/Siri 风字母封面 — 渐变 + 大首字 + 顶部艺人/底部歌名 + 圆盘装饰
 *
 * 设计要点：
 * - 0 网络/0 依赖：纯字符串拼接，浏览器原生解析
 * - 颜色 H/S/L 全由哈希派生 → 同一首歌每次得到同一张图（视觉一致性）
 * - 安全：name/artist 都做 XML 转义，防 SVG XSS（恶意后端响应也最多改个色）
 * - 字符支持 CJK + Latin：字体 stack 跨平台覆盖
 */

/**
 * djb2 字符串哈希 → [0, mod) 整数。
 * 用歌曲名+艺人+songmid 作输入，保证同一首歌永远稳定派生同色。
 */
function hash(str: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  // Math.abs 防负数（djb2 在 |0 后可能为负），再 mod 取范围
  return Math.abs(h) % mod;
}

/**
 * XML 实体转义，防 SVG XSS（防恶意歌曲名注入脚本/事件）。
 * 只需要防这五个字符：& < > " '
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 截断字符串到 maxChars 字符（不严格按 width），多余加 "…"
 */
function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + "…";
}

export interface LetterCoverInput {
  name: string;
  artist: string;
  songmid?: string;
}

/**
 * 生成 SVG 字母封面，返回 `data:image/svg+xml;charset=utf-8,xxx` URL。
 */
export function buildLetterCoverSvg(input: LetterCoverInput): string {
  const name = (input.name || "").trim() || "UNKNOWN";
  const artist = (input.artist || "").trim() || "AI RADIO";
  const seed = `${name}::${artist}::${input.songmid || ""}`;

  // 派生色彩：色相 h ∈ [0, 360)，饱和度 s ∈ [55, 78]，亮度 l ∈ [42, 60]（深而不黑）
  const h = hash(seed, 360);
  const s = 55 + hash(seed + "s", 24); // 55–78
  const l1 = 42 + hash(seed + "l1", 12); // 42–53
  const l2 = 20 + hash(seed + "l2", 16); // 20–35

  const color1 = `hsl(${h}, ${s}%, ${l1}%)`;
  const color2 = `hsl(${(h + 40) % 360}, ${s - 8}%, ${l2}%)`;

  // 渐变方向：4 选 1（按哈希决定），避免每首都是同方向
  const gradDir = hash(seed + "g", 4);
  const grad = [
    { x1: "0%", y1: "0%", x2: "100%", y2: "100%" },
    { x1: "100%", y1: "0%", x2: "0%", y2: "100%" },
    { x1: "0%", y1: "100%", x2: "100%", y2: "0%" },
    { x1: "100%", y1: "100%", x2: "0%", y2: "0%" },
  ][gradDir];

  // 中央首字符（取名字第一个非空白字符；emoji 也能渲染）
  const initialChar = Array.from(name)[0] || "♪";
  const initialCharEsc = xmlEscape(initialChar);

  // 文本溢出保护：CJK 一字≈2 拉丁字符=1，预算 24 字≈视觉合理
  const nameDisplay = xmlEscape(truncate(name, 24));
  const artistDisplay = xmlEscape(truncate(artist, 28));

  // 字体栈：拉丁优先 Inter/Helvetica，CJK 走 Hiragino / PingFang / Yahei，保证两端都能渲染
  const fontStack = [
    "Inter",
    '"Helvetica Neue"',
    "Arial",
    '"Hiragino Kaku Gothic ProN"',
    '"PingFang SC"',
    '"Microsoft YaHei"',
    '"Noto Sans CJK SC"',
    "sans-serif",
  ].join(", ");

  // 唱片盘装饰（哈希微调透明度/缩放，避免每首完全一样）
  const decorOpacity = 0.06 + (hash(seed + "o", 8) / 100); // 0.06–0.13
  const decorSize = 80 + hash(seed + "d", 40); // 80–120 px 半径

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bg" x1="${grad.x1}" y1="${grad.y1}" x2="${grad.x2}" y2="${grad.y2}">
      <stop offset="0%" stop-color="${color1}"/>
      <stop offset="100%" stop-color="${color2}"/>
    </linearGradient>
    <radialGradient id="vinyl" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,${decorOpacity + 0.05})"/>
      <stop offset="60%" stop-color="rgba(255,255,255,${decorOpacity})"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>

  <!-- 背景渐变（斜线对角 / 反斜线 / etc，按 hash 切） -->
  <rect width="400" height="400" fill="url(#bg)"/>

  <!-- 唱片盘装饰：右下角 radial，圆心透明，更像黑胶质感 -->
  <circle cx="340" cy="340" r="${decorSize}" fill="url(#vinyl)"/>
  <circle cx="60" cy="60" r="${decorSize * 0.5}" fill="rgba(255,255,255,${decorOpacity * 0.6})"/>

  <!-- 顶部 AI RADIO 角标（紧凑品牌识别） -->
  <text x="32" y="40" font-family="${fontStack}" font-size="13" font-weight="700" fill="rgba(255,255,255,0.7)" letter-spacing="3">AI · RADIO</text>

  <!-- 顶部艺人（小字，平移顶部） -->
  <text x="32" y="68" font-family="${fontStack}" font-size="18" font-weight="700" fill="rgba(255,255,255,0.88)">${artistDisplay}</text>

  <!-- 中央首字符（巨型） -->
  <text x="200" y="250" text-anchor="middle" font-family="${fontStack}" font-size="240" font-weight="900" fill="rgba(255,255,255,0.93)">${initialCharEsc}</text>

  <!-- 底部歌名 -->
  <text x="32" y="352" font-family="${fontStack}" font-size="22" font-weight="900" fill="rgba(255,255,255,0.96)">${nameDisplay}</text>

  <!-- 底部分隔线 + 副标 -->
  <line x1="32" y1="368" x2="120" y2="368" stroke="rgba(255,255,255,0.5)" stroke-width="2"/>
  <text x="32" y="386" font-family="${fontStack}" font-size="11" font-weight="500" fill="rgba(255,255,255,0.6)" letter-spacing="2">NOW PLAYING</text>
</svg>`;

  // SVG 内嵌 data URL 用 utf8 编码（兼容现代浏览器，无须 base64 体量翻倍）
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
