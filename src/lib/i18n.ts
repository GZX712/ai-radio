/**
 * 极简 i18n（零依赖）
 * ------------------------------------------------------------
 * 设计：**中文原文当 key**，英文词典查得到就翻译、查不到自动回退中文。
 * 好处：改造是渐进的、任何漏翻的地方只会显示中文，不会出现 key 乱码。
 *
 * 语言决定优先级：URL ?lang= > localStorage > 系统语言 > zh
 * 说明：只作用于界面 chrome（按钮/标题/提示），DJ 对话本身自带 {en, zh} 双字段，不在此处理。
 */
import { useEffect, useState } from "react";

export type Lang = "zh" | "en";

const LANG_KEY = "ai-radio-lang";

/** 英文词典：中文原文 → English */
const EN: Record<string, string> = {
  // ── 开始卡片（访客入口） ──────────────────────────────
  "辛老师的 AI 电台": "Xin's AI Radio",
  "284 首你的歌 · 双语 DJ · 语音操控": "284 tracks · Bilingual DJ · Voice control",
  "开始电台": "Start Radio",
  "点击开始听歌，DJ 会先跟你打个招呼": "Tap to start — the DJ will say hi first",
  "轻触开启声音": "Tap to enable sound",
  "选择界面语言": "Interface language",

  // ── 下拉刷新 ────────────────────────────────────────
  "↓ 继续下拉": "↓ Keep pulling",
  "↑ 松开刷新电台": "↑ Release to refresh",
  "🔄 刷新中…": "🔄 Refreshing…",

  // ── 头部 ───────────────────────────────────────────
  "切换壁纸": "Switch wallpaper",
  "当前壁纸：": "Wallpaper: ",
  "壁纸": "Wallpaper",
  "搞笑音效：开（点击关闭）": "Fun SFX: on (click to mute)",
  "搞笑音效：关（点击开启）": "Fun SFX: off (click to enable)",
  "搞笑音效开关": "Fun SFX toggle",
  "😄 音效开": "😄 SFX On",
  "🔇 音效关": "🔇 SFX Off",
  "本次使用时长": "Session time",

  // ── 播放器 ─────────────────────────────────────────
  "上一首": "Previous track",
  "下一首": "Next track",
  "后退 15 秒": "Rewind 15s",
  "前进 15 秒": "Forward 15s",

  // ── 聊天面板 ───────────────────────────────────────
  "DJ 性格设置": "DJ Personality",
  "点击打开 DJ 性格设置（可在此上传/更换头像、选音色、调性格）":
    "Open DJ personality — avatar, voice and traits",
  "上传我的头像": "Upload my avatar",
  "点击上传/更换头像": "Tap to upload / change avatar",
  "显示中文": "Show Chinese",
  "隐藏中文": "Hide Chinese",
  "你": "You",
  "我": "Me",
  "跟 DJ 聊聊，或按 🎤 语音说话": "Chat with the DJ, or tap 🎤 to talk",
  "正在敲碗回复": "Waiting for the DJ",
  "📡 这条好像没送到 DJ 耳朵里（连接断了一下）":
    "📡 That didn't reach the DJ (connection dropped)",
  "｜重发": "Resend",
  "打字或点 🎤 说话...": "Type or tap 🎤 to talk...",
  "停止录音": "Stop recording",
  "语音输入": "Voice input",

  // DJ 性格设置弹窗
  "🎙 DJ 性格设置": "🎙 DJ Personality",
  "DJ 头像（点击更换，影响所有 DJ 气泡左侧）":
    "DJ avatar (tap to change; shown on every DJ bubble)",
  "点击上传 DJ 头像": "Upload DJ avatar",
  "清除 DJ 头像": "Remove DJ avatar",
  "性别": "Gender",
  "男声": "Male",
  "女声": "Female",
  "中性": "Neutral",
  "音色（点 ▶ 试听）": "Voice (tap ▶ to preview)",
  "音色加载中...": "Loading voices...",
  "MiMo 音色需配置 API Key（限时免费）；未配置时自动用 Edge-TTS":
    "MiMo voices require an API key (free for a limited time); falls back to Edge-TTS",
  "性格特征（逗号分隔）": "Personality traits (comma-separated)",
  "风趣、毒舌、BBC 风格、温暖、简洁...": "witty, savage, BBC style, warm, concise...",
  "风趣, 毒舌, BBC 旁白": "witty, savage, BBC narrator",
  "→ DJ 会按这些特征即兴发挥": "→ The DJ improvises around these traits",
  "例如：": "e.g. ",
  "幽默风格（用专业领域包装日常）": "Humor style (wrap daily life in a profession)",
  "取消": "Cancel",
  "保存": "Save",
  "试听": "Preview",
  "播放这段回复": "Play this reply",
  "暂停这段回复": "Pause this reply",
  "正在用新音色合成语音": "Synthesizing with the new voice",
  "点击听 DJ 的这段回复": "Tap to hear this DJ reply",
  "点击暂停这段回复": "Tap to pause this reply",
  "正在用当前音色重新合成…": "Re-synthesizing with the current voice…",
  "正在敲碗回复.": "Waiting for the DJ.",

  // 幽默风格
  "金融": "Finance",
  "医学": "Medical",
  "法律": "Legal",
  "博弈": "Poker",
  "经典": "Classic",
  "毒舌": "Savage",
  "无": "None",
  "用股票/期权/仓位包装感情": "Wraps feelings in stocks, options and positions",
  "处方/诊断/临床口吻": "Prescriptions, diagnoses, clinical tone",
  "合同/条款/判决口吻": "Contracts, clauses and verdicts",
  "扑克/筹码/All-in 口吻": "Poker chips and all-in talk",
  "BBC 毒舌旁白（默认）": "Snarky BBC narration (default)",
  "Max 风凌厉毒舌 + 无所不知冷知识": "Max-style savage wit + know-it-all trivia",
  "不加幽默，正常回应": "No humor, straight answers",
  "例「金融」风格：聊失恋 → DJ 回「您的情绪正在破发，建议长线持有」；例「医学」风格：聊失眠 → DJ 回「建议暂停摄入午夜碳水，先做一次基础 CT」":
    "e.g. Finance: heartbreak → “Your sentiment is breaking support; advise holding long term.” · Medical: insomnia → “Pause midnight carbs and run a baseline CT.”",

  // ── 壁纸面板 ───────────────────────────────────────
  "🎨 选择壁纸": "🎨 Choose Wallpaper",
  "选择壁纸": "Choose wallpaper",
  "关闭": "Close",
  "切换配色方案，频谱紫色 LED 设计保留不变。":
    "Switch color schemes — the purple LED spectrum design stays.",
  "选择会保存到本地，下次打开自动应用。":
    "Your choice is saved locally and applied next time.",
  "仅支持图片文件（jpg/png/webp/gif）": "Images only (jpg/png/webp/gif)",
  "图片过大（建议 ≤2MB），浏览器已拒绝": "Image too large (≤2MB recommended)",
  "本地存储空间已满，请换一张更小的图": "Local storage full — try a smaller image",
  "上传失败": "Upload failed",
  "文件读取失败": "Failed to read the file",
  "点击上传图片": "Tap to upload",
  "点击更换图片": "Tap to change",
  "点击更换 Player 卡片背景图": "Change player card background",
  "点击上传 Player 卡片背景图": "Upload player card background",
  "清除自定义壁纸": "Remove custom wallpaper",
  "清除图片": "Remove image",
  "🖼 自定义壁纸": "🖼 Custom Wallpaper",
  "点击更换 · Player 背景": "Tap to change · Player background",
  "上传图片 · Player 背景": "Upload image · Player background",

  // 壁纸名称
  "霓虹脉冲": "Neon Pulse",
  "默认 · 紫青 LED": "Default · Purple-cyan LED",
  "极简黑白": "Minimal Mono",
  "克制 · 干净": "Restrained · Clean",
  "奶油新拟态": "Cream Neumorph",
  "浅灰 · 同色系凹凸": "Light gray · Soft relief",
  "玻璃拟态": "Glassmorph",
  "通透 · 灵动": "Translucent · Fluid",
  "波普艺术": "Pop Art",
  "撞色 · 多色拼贴": "Bold clash · Color collage",
  "复古漫画": "Retro Comic",
  "黑底 · 超英 KAPOW": "Black base · Superhero KAPOW",

  // ── 其他 ───────────────────────────────────────────
  "出错了": "Something went wrong",
  "刷新页面": "Reload page",
};

function detectLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "en" || q === "zh") return q;
  } catch { /* ignore */ }
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch { /* ignore */ }
  try {
    // 非中文系统 → 英文界面（英文访客体验优先）
    if (navigator.language && !/^zh/i.test(navigator.language)) return "en";
  } catch { /* ignore */ }
  return "zh";
}

let currentLang: Lang = detectLang();
const listeners = new Set<() => void>();

function syncHtmlLang(lang: Lang): void {
  try { document.documentElement.lang = lang === "en" ? "en" : "zh-CN"; } catch { /* ignore */ }
}

syncHtmlLang(currentLang);

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  syncHtmlLang(lang);
  listeners.forEach((fn) => fn());
}

/** 翻译：中文原文当 key；英文缺失时回退中文 */
export function t(zh: string): string {
  return currentLang === "zh" ? zh : (EN[zh] ?? zh);
}

/**
 * 音色目录本地化：name/desc 由服务端 /api/voices 下发（中文），
 * 英文界面按固定 id 映射；未命中回退原文（新增音色不会崩）。
 */
const VOICES_EN: Record<string, { name: string; desc: string }> = {
  mimo_default: { name: "MiMo Default", desc: "Auto zh/en · Steady" },
  default_zh: { name: "Chinese Female", desc: "Standard Mandarin" },
  default_en: { name: "English Female", desc: "Standard English" },
  "冰糖": { name: "Bingtang", desc: "Chinese female · Sweet" },
  "茉莉": { name: "Jasmine", desc: "Chinese female · Gentle" },
  "苏打": { name: "Soda", desc: "Chinese male · Lively" },
  "白桦": { name: "Birch", desc: "Chinese male · Calm" },
  Mia: { name: "Mia", desc: "English female · Bright" },
  Chloe: { name: "Chloe", desc: "English female · Elegant" },
  Milo: { name: "Milo", desc: "English male · Natural" },
  Dean: { name: "Dean", desc: "English male · Magnetic" },
  "en-US-GuyNeural": { name: "Guy (US Male)", desc: "Steady news tone · Classic" },
  "en-US-DavisNeural": { name: "Davis (US Male)", desc: "Young, warm · Natural" },
  "en-US-TonyNeural": { name: "Tony (US Male)", desc: "Dramatic · Powerful" },
  "en-US-JennyNeural": { name: "Jenny (US Female)", desc: "Bright, clear · Classic" },
  "en-US-AriaNeural": { name: "Aria (US Female)", desc: "Newsy · Professional" },
  "en-US-SaraNeural": { name: "Sara (US Female)", desc: "Playful, sweet" },
  "zh-CN-YunxiNeural": { name: "Yunxi (CN Male)", desc: "Young male · Lively" },
  "zh-CN-XiaoxiaoNeural": { name: "Xiaoxiao (CN Female)", desc: "Warm female · Natural" },
};

export function voiceName(id: string, zhName: string): string {
  if (currentLang === "zh") return zhName;
  return VOICES_EN[id]?.name ?? zhName;
}

export function voiceDesc(id: string, zhDesc: string): string {
  if (currentLang === "zh") return zhDesc;
  return VOICES_EN[id]?.desc ?? zhDesc;
}

/** 组件内使用：语言切换时自动重渲染 */
export function useLang(): Lang {
  const [lang, setLangState] = useState<Lang>(currentLang);
  useEffect(() => {
    const fn = () => setLangState(currentLang);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return lang;
}
