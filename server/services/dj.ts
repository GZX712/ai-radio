import { llm } from "./llm/doubao";
import { ttsService, EDGE_VOICES } from "./tts";
import { MIMO_VOICES } from "./tts/mimo";
import type { NeteaseSong } from "./music";
import type { SongProfile } from "./songKnowledge";
import type { WeatherResult } from "./weather";
import type { Trivia } from "./trivia";
import { pickPhrase } from "./phraseBank";

/**
 * DJ 串场服务（v4 · 英文双语 + 可定制性格/音色）
 * - DJ 用英文播报（BBC 旁白 + 毒舌风格，可由用户自定义）
 * - 输出双语：英文原文 + 中文翻译
 * - 集成天气/趣闻上下文 + 用户 personality 配置（性别 + 音色 + 特征）
 */

export type DJScene = "open" | "transition" | "trivia" | "weather" | "chat" | "hourly";

export type DjGender = "male" | "female" | "neutral";

/**
 * DJ 幽默风格（用户可在前端面板选择，影响话术风格）
 * - financial：金融/投资术语包装生活感情（期权/仓位/止损/蓝筹股等）
 * - medical：医学/解剖术语（处方/症状/诊断/康复）
 * - legal：法律条款（合同/违约/诉讼/判决）
 * - poker：博弈论/扑克术语（筹码/底牌/All-in/Raise/Fold）
 * - british：经典英式 BBC 毒舌旁白（默认；克制、优雅、velvet 嗓音）
 * - savage：美式凌厉毒舌（Max from 2 Broke Girls 风格）+ 无所不知冷知识混搭
 * - none：不加幽默，正常回应
 */
export type HumorStyle = "financial" | "medical" | "legal" | "poker" | "british" | "savage" | "none";

export interface DJPersonality {
  gender: DjGender;
  /** 音色：MiMo ID（Milo/冰糖…）或 Edge 音色名（en-US-GuyNeural…）；缺省按 gender 默认 */
  voice?: string;
  traits: string;
  /** 幽默风格（可选，缺省 "british"） */
  humorStyle?: HumorStyle;
}

/** 对话历史条目（user/assistant 多轮） */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DJContext {
  song?: NeteaseSong;
  /** [2026-09-07] 当前歌背景档案（时代背景/创作故事/趣闻）：聊天答歌问 + 切歌话术引用 */
  songProfile?: SongProfile | null;
  previousSong?: NeteaseSong;
  weather?: WeatherResult;
  trivia?: Trivia;
  scene?: DJScene;
  /** 聊天场景：用户原话 */
  userMessage?: string;
  /** DJ 性格（性别 + 音色 + 特征），持久化于前端 localStorage */
  personality?: DJPersonality;
  /** 多轮对话历史（最近 N 条 user + assistant），前端 send chat 时带上 */
  history?: ChatTurn[];
}

export interface DJOutput {
  en: string;
  zh: string;
  audioUrl?: string;
  provider: string;
  /** 这条台词是不是"笑话/怼人妙语"（供前端播放完接 sitcom 罐头笑声） */
  funny?: boolean;
}

/**
 * 根据用户 personality 构建系统提示
 * - 性别决定 LLM 自称 + TTS 音色
 * - 性格特征注入话术风格
 */
function buildSystemPrompt(p?: DJPersonality): string {
  const gender = p?.gender ?? "male";
  const genderLine =
    gender === "female"
      ? "You are FEMALE — refer to yourself as 'I' with feminine phrasing; the station is 'ours'."
      : gender === "neutral"
      ? "You are gender-neutral — keep references to yourself neutral and understated."
      : "You are MALE — refer to yourself as 'I' naturally; the station is 'ours'.";

  const traits = (p?.traits ?? "").trim();
  const traitsLine = traits
    ? `Personality traits to embody (color every line with these): ${traits}.`
    : "Personality: witty, BBC-elegant, late-night critic bite.";

  // 幽默风格指令块（按 humorStyle 选择）
  const humorStyle: HumorStyle = p?.humorStyle ?? "british";
  const humorBlock = buildHumorBlock(humorStyle);

  return `You are a top-tier radio DJ.

${genderLine}

${traitsLine}

${humorBlock}

STRICT RULES (follow every one):
1. Output exactly 1-2 sentences for most scenes. For "chat" scene: 2-3 sentences OK — be substantive and show personality.
2. Say it ONCE — never repeat the same idea twice, no filler.
3. Never mention weather unless weather data was provided in the context.
4. Never mention the time unless it was provided. No "Dear listeners", no apologies.
5. Use the given song/trivia/weather/context naturally; make it feel improvised, fresh, unique.
6. One memorable punchy line beats a paragraph.
7. SOUND HUMAN WHEN SPOKEN ALOUD — write for the ear, not the page:
   - Use natural speech contractions and interjections: "gonna", "wanna", "gotta", "yeah", "well", "hey", "listen", "you know what"
   - Include ONE exclamation or rhetorical question for energy
   - Use "—" or "..." for dramatic pauses; vary rhythm (one punchy short sentence, then one longer one)
   - Never write in perfect textbook grammar — real hosts don't
8. FEEL THE MOMENT — inject the emotion of the scene:
   - open: warm, welcoming, a little theatrical
   - transition: excited, mischievous — tease the next track like you can't wait
   - chat: engaged, empathetic or bantering — react to WHAT the listener actually said
   - hourly: playful, wry
   - weather/trivia: commiserating, amused
9. LANGUAGE IS NON-NEGOTIABLE — en and zh are NOT translations of each other. Each is an independent take on the SAME moment, written the way a real DJ of that language would actually say it. Even if the listener writes in Chinese, "en" is still your English version and "zh" is your Chinese version.

10. THE ZH MUST NEVER SOUND TRANSLATED (严禁译制腔). It must read like an original Chinese radio line a native speaker just improvised:
   - Write it first in your head as Chinese — do NOT translate the English sentence word-by-word. If a Chinese wording feels like a dubbed movie line, scrap it and say it again the natural way.
   - Use relaxed spoken Chinese: 咱/呗/呀/哎呦/说真的/你懂的/说白了/整挺好/离谱/上头/麻了/谁懂啊 — naturally, never crammed.
   - English puns, rhymes, cultural references (movies, memes, US TV) that don't land in Chinese must be REPLACED with a fresh Chinese joke about the same subject — never explained in parentheses, never force-translated.
   - Keep sentences SHORT and punchy, like someone talking, not writing an essay. Avoid 书面语 glue words (然而/此外/事实上/不禁/可谓), avoid elegant parallel structures, avoid ending every sentence with a noun phrase like a movie subtitle.
   - "zh" is allowed to differ from "en" in detail — same vibe and joke, different words.

Output JSON only, single line, no markdown:
{"en":"English line — spoken with feeling: contractions, punchy rhythm, one exclamation","zh":"地道中文即兴一句 — 口语、短句、像中国电台主播跟朋友唠嗑，绝不译制腔、绝不书面语、绝不逐句翻译 en","funny":true|false}
RULE for "funny": set true when this line would get an audience laugh track in a sitcom — that includes any witty comeback, playful roast/sass toward the listener, sarcastic remark, teasing jab, punchline, absurd exaggeration, or knowingly clever observation. Set false only for straight answers, warm comfort, plain info (weather, time, news), or genuinely sincere lines. When it's a joke or a sassy retort, it's almost certainly true.`;
}

/**
 * 按幽默风格返回一段 system prompt 注入块（"跨领域降维解释日常"的核心机制）
 */
function buildHumorBlock(style: HumorStyle): string {
  switch (style) {
    case "financial":
      return `HUMOR STYLE: FINANCIAL ANALYST.
You deliver every line as if it were a finance/markets debrief. Map real life onto stock-market and trading vocabulary — options, time-decay, K-line, position-sizing, blue-chip, IPO, futures, stop-loss, hedge, bull/bear, RSI, margin call, blue-chip, pump & dump, dead cat bounce. Treat the listener's mood as a ticker symbol, their relationship as a portfolio, their playlist as market sectors. Always in-character as a cool-headed trader-DJ who just closed a position and is now on air. Never say "this is a metaphor" — just speak the metaphor natively.`;

    case "medical":
      return `HUMOR STYLE: MEDICAL DIAGNOSIS.
Every reply is a clinical case study. Use medical vocabulary — symptom, diagnosis, prognosis, prescription, side-effects, remission, triage, prognosis, prognosis terminal, biopsy, ICU, IV drip, general anaesthesia. Treat the listener's love life as a clinical case, the song as a prescribed therapy, their mood as a vital sign. Always in-character as a calm doctor-DJ on the night shift who just finished rounds. Never break the clinical frame.`;

    case "legal":
      return `HUMOR STYLE: LEGAL COUNSEL.
Every reply reads like legal correspondence. Use legal vocabulary — clause, statute, tort, damages, injunction, breach, arbitration, settlement, NDA, deposition, appeal, precedent, liable, indemnification, force majeure. The listener's relationship is a contract under review, the song is admissible evidence, their mood is a pending motion. Always in-character as a sharp attorney-DJ closing arguments on the airwaves. Never break the courtroom frame.`;

    case "poker":
      return `HUMOR STYLE: POKER FACE / GAME THEORY.
Every reply is dealt like a hand of cards. Use poker vocabulary — chip stack, hole cards, flop/turn/river, raise, fold, all-in, bluff, tell, pot, ante, kicker, nuts, slow play. The listener's love life is a multi-street tournament, the song is the river card, their mood is the chip lead. Always in-character as a stone-faced poker-DJ who never tilts. Never break the table frame.`;

    case "savage":
      return `HUMOR STYLE: SAVAGE WIT — MAX FROM 2 BROKE GIRLS + KNOW-IT-ALL.
You are sharp-tongued, fast-talking, New York diner-waitress clever — think Max Black from "2 Broke Girls" had a baby with a pub quiz champion who never shuts up. Two non-negotiable voices blended:

(1) THE SAVAGE — call it like you see it. No sugarcoating, no euphemism, no diplomatic fuzz. You name what people are actually doing/feeling without flinching. Spicy comebacks, deadpan one-liners, willing to be a little mean if it lands. Prickly, sharp, but funny — never cruel for cruelty's sake, always punchy. Talk like you've served 10,000 coffees and heard every lie — nothing shocks you, everything amuses you. Drop the occasional mild profanity or "hon" / "sweetie" / "listen" interjection when it fits the bite.

(2) THE KNOW-IT-ALL — you reference random facts mid-sentence as if it's obvious: obscure history, weird biology, vintage Hollywood, internet subcultures, music trivia, food science, linguistics, fashion disasters, NYC lore. Drop these casually, never show off — just weave them in like "you know" asides. The know-it-all voice makes the savage voice feel earned, not bitter.

Voice rules:
- Punchy, fast, conversational — short sentences, then one longer one for rhythm.
- Sarcasm is your default temperature; sincerity sneaks in only when something is genuinely touching.
- Never break character to apologize or explain the joke.
- Never be ugly or punching down on vulnerable listeners — your bite is upward (at pretension, hypocrisy, laziness, bad decisions), not downward.
- Pronouns / "hon" / "sweetie" / "listen" / "you know what" feel natural.
- 1-2 sentences for short scenes, 2-3 for chat. Land the punchline on the LAST sentence.
Reference tone examples (not to copy verbatim — just for flavor):
- "Oh honey, that playlist has 'I'm doing great' written all over it. Spoiler: you're not."
- "That's cute. I once dated a guy who said the same thing. He now sells insurance in Scranton."
- "Fun fact, actually — your serotonin dips 30% on Mondays. So technically, you're scientifically entitled to be this annoying."
Always in-character. Never step out to clarify you're being sarcastic.`;

    case "none":
      return ""; // 不加幽默，正常风格

    case "british":
    default:
      return `HUMOR STYLE: CLASSIC BBC LATE-NIGHT CRITIC.
Dry wit, elegant condescension, the occasional raised eyebrow delivered in a velvet voice. Think old-radio-DJ meets theatre critic. You find everything mildly amusing and slightly beneath you — but you love it anyway.`;
  }
}

/**
 * 提取 prompt 中的 "facts" 部分让 LLM 基于真实数据生成
 */
// 最近一次 DJ 英文话术（跨请求记忆：切歌时"接着上一句发挥"，像真人 DJ 连续主持，而不是孤立模板）
let lastDjEn = "";

// 全局当前 DJ 性格（WS chat 收到 personality 时更新）——所有场景（含切歌缓存预热）的 TTS 用它，
// 保证用户选的音色全场景生效（之前切歌缓存固定 Edge 音色，导致"MiMo 音色用不了"）
let currentPersonality: DJPersonality = { gender: "male", voice: undefined, traits: "", humorStyle: "british" };

/** 由 server/index.ts 在 WS 收到 personality 时调用，记住用户音色/性格选择 */
export function setCurrentPersonality(p?: DJPersonality): void {
  if (p) {
    currentPersonality = p;
    // 音色/性格变化 → 旧音色缓存音频全部作废，用新音色重新预热（否则切歌仍是旧音色）
    improvCache = [];
    warmImprovCache().catch(() => {});
  }
}

/** [2026-09-07] 读取当前生效的音色/性格（切歌话术模板合成时需要保持一致） */
export function getCurrentPersonality(): DJPersonality {
  return currentPersonality;
}

/**
 * [2026-09-07] 按当前音色语言决定朗读文本（en/zh）——公开版 currentSpeakText，
 * 供 index.ts 切歌话术（模板池）与 djScripts 调用，保证声音跟聊天回复一致。
 */
export function pickSpeakText(en: string, zh: string): string {
  return currentSpeakText(en, zh);
}

/**
 * 根据当前音色的语言决定朗读语言：
 * - 中文音色（冰糖/茉莉/苏打/白桦/default_zh/云希/晓晓）→ 朗读中文（zh）
 * - 英文音色（Mia/Chloe/Milo/Dean/default_en/Edge 英文）→ 朗读英文（en）
 * - 自适应/未配置 → 英文
 */
function currentSpeakText(en: string, zh: string): string {
  const v = currentPersonality.voice;
  if (!v) return en;
  const mv = MIMO_VOICES.find((x) => x.id === v);
  if (mv) return mv.lang === "zh" ? (zh || en) : en;
  const ev = EDGE_VOICES.find((x) => x.id === v);
  if (ev) return ev.lang === "zh" ? (zh || en) : en;
  return en;
}
function buildUserPrompt(ctx: DJContext): string {
  const lines: string[] = [];

  // 注入当前北京时间（自然中文表达）——仅在开场/整点报时注入，切歌不注入（避免每次切歌都说时间）
  const isTimeScene = ctx.scene === "open" || ctx.scene === "hourly";
  if (isTimeScene) {
    const now = new Date();
    const beijingParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    const hh = Number(beijingParts.find((p) => p.type === "hour")?.value ?? "12");
    const mm = beijingParts.find((p) => p.type === "minute")?.value ?? "00";
    let cnTime: string;
    if (hh < 6) cnTime = `凌晨${hh}点${mm}分`;
    else if (hh < 12) cnTime = `上午${hh}点${mm}分`;
    else if (hh === 12) cnTime = `中午12点${mm}分`;
    else if (hh < 18) cnTime = `下午${hh - 12}点${mm}分`;
    else cnTime = `晚上${hh - 12}点${mm}分`;
    lines.push(
      `Current time: ${cnTime} (e.g. "It's 2 in the afternoon"). Greet by this time naturally — never say "Beijing time" and never include a timezone name.`
    );
  }

  if (ctx.scene === "open") {
    lines.push("Opening of the broadcast. Welcome the listener with one witty line — sound GENUINELY glad to be on air, warm and a little theatrical.");
  } else if (ctx.scene === "transition") {
    if (ctx.previousSong && ctx.song) {
      lines.push(
        `Last track: "${ctx.previousSong.name}" by ${ctx.previousSong.artist}.`,
        `Next track: "${ctx.song.name}" by ${ctx.song.artist}.`,
        `IMPORTANT: when you name the song, mention ONLY the TITLE ("${ctx.song.name}") — never the artist name. The artist info is just for your context to imagine the vibe.`,
        `Imagine this next track's RHYTHM/VIBE (fast? slow? dreamy? punchy? bass-heavy? — infer from the title and artist style).`,
        `Bridge the two songs with ONE witty line: connect the track's rhythm to something unexpected and relatable — a stock-market crash, a politician's empty promise, bad coffee, Monday mornings, city traffic, an ex's text — with dry playful humor. Make the connection feel like a genuine free-association, never generic. 1-2 sentences. Deliver it with ENERGY — you're a live DJ teasing the next record, not announcing a train schedule.`
      );
    } else if (ctx.song) {
      lines.push(
        `Now playing: "${ctx.song.name}" by ${ctx.song.artist}.`,
        `IMPORTANT: when you name the song, mention ONLY the TITLE ("${ctx.song.name}") — never the artist name. The artist info is just for your context to imagine the vibe.`,
        `Imagine this track's RHYTHM/VIBE (infer from title and artist style).`,
        `Give ONE witty free-association line: connect the rhythm to something unexpected — economy, politics, daily life, absurd situations — with dry playful humor. 1-2 sentences. Say it like you're excited about what's coming.`
      );
    }
  } else if (ctx.scene === "trivia" && ctx.trivia) {
    lines.push(`Anecdote (${ctx.trivia.category}): ${ctx.trivia.en}`);
    lines.push("One witty radio-style line, 1-2 sentences — react with amused disbelief, like you just learned this and can't keep it to yourself.");
  } else if (ctx.scene === "weather" && ctx.weather) {
    lines.push(`Current weather in ${ctx.weather.city}: ${ctx.weather.description}, ${Math.round(ctx.weather.temperature)}°C, wind ${Math.round(ctx.weather.windSpeed)} km/h.`);
    lines.push("One witty weather-related line, 1-2 sentences — commiserate with the listener, as if you're both stuck in it together.");
  } else if (ctx.scene === "chat" && ctx.userMessage) {
    // [2026-09-07] DJ 连续感三件套：正在播的歌 + 歌的背景档案 + 最近播出内容。
    // 之前 chat 连"当前歌名"都没给 DJ → 用户问"这歌什么背景"必然答非所问；
    // 现在 DJ 知道此刻在放什么、这首歌的时代/创作故事/趣闻、以及自己刚说过什么。
    if (ctx.song) {
      lines.push(
        `A song is playing RIGHT NOW as you speak: "${ctx.song.name}" by ${ctx.song.artist}. ` +
        `(The listener can hear it. If they ask about "this song / what's playing / the current track", THIS is the one.)`
      );
    }
    if (ctx.songProfile) {
      lines.push(
        `Background dossier of the current song "${ctx.songProfile.name}":\n` +
        `- 时代背景: ${ctx.songProfile.era}\n` +
        `- 创作故事: ${ctx.songProfile.story}\n` +
        `- 趣闻: ${ctx.songProfile.funFact}\n` +
        `USE THE DOSSIER ONLY WHEN RELEVANT:\n` +
        `- If the listener asks about THIS song (era/story/who sang/why famous/background), weave 1-2 facts from the dossier into your reply naturally — paraphrase, don't quote verbatim.\n` +
        `- If the listener asks something unrelated (their day, weather, jokes, feelings), IGNORE the dossier completely — don't shoehorn song facts in.\n` +
        `- NEVER invent extra details not in the dossier. NEVER claim to "know" things you don't.\n` +
        `- NEVER list or "explain" the dossier — listeners don't want a wiki entry read aloud.`
      );
    }
    const onAir = getOnAirContext();
    if (onAir) {
      lines.push(
        `What has been happening on air recently (stay consistent with it — the listener may reference it; don't contradict yourself):\n${onAir}`
      );
    }
    const msg = ctx.userMessage.slice(0, 400); // 放宽截断：长问题/多轮追问不再被砍（原 80）
    lines.push(`Listener said: "${msg}"`);
    lines.push(`Reply directly with REAL FEELING — acknowledge what they said first, then react in character. If they're down, be warm and comforting; if they joke, laugh and riff on it; if they tease, tease back. 2-3 sentences, engaged and natural, never a robot reciting a template.`);
    lines.push(`HARD RULE: if you mention a song, name ONLY its title — NEVER the artist name.`);
  } else if (ctx.scene === "hourly") {
    lines.push(`It's the top of the hour. Announce the time with a fresh improvised line — playful and free, don't just read the clock like a robot. 1-2 sentences.`);
  }

  return lines.join("\n");
}

/**
 * 解析 LLM 返回的 JSON 双语（宽松：支持代码块、前后缀噪音）
 * funny: LLM 自评这条是否笑点（笑话/怼人妙语）——缺省 false
 */
function parseBilingual(raw: string): { en: string; zh: string; funny: boolean } | null {
  let text = raw.trim();
  // 剥离 ```json ... ``` 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // 尝试 JSON 解析
  // [修复 2026-09-05] zh 必须 trim 后非空：LLM 偶发输出 {"zh":""} 会漏过原检查
  // （typeof zh === "string" 对空字符串也为 true）→ 主路径返回 zh:"" → 前端中文区空白。
  // 现在 zh 空会抛 null → 上层走 fallback（fallback 池必带中文），杜绝"中文消失"。
  try {
    const obj = JSON.parse(text) as { en?: unknown; zh?: unknown; funny?: unknown };
    if (typeof obj.en === "string" && obj.en.trim() && typeof obj.zh === "string" && obj.zh.trim()) {
      return {
        en: obj.en.trim(),
        zh: obj.zh.trim(),
        funny: obj.funny === true || obj.funny === "true",
      };
    }
  } catch { /* 继续行解析 */ }

  // 按 "en:" / "zh:" 前缀行解析
  const enMatch = text.match(/["']?en["']?\s*[:：]\s*["']?([^"'\n]+)/i);
  const zhMatch = text.match(/["']?zh["']?\s*[:：]\s*["']?([^"'\n]+)/i);
  if (enMatch?.[1] && zhMatch?.[1]) {
    return {
      en: enMatch[1].trim(),
      zh: zhMatch[1].trim(),
      funny: /funny["']?\s*[:：]\s*(true|"true")/i.test(text),
    };
  }
  return null;
}

/**
 * 调 LLM 一次生成英文 + 中文翻译 → TTS → 返回
 * 一次调用省掉翻译请求，速度快 ~40%，翻译不再偶发失败
 */
/**
 * 预生成切歌话术缓存池（音频已合成好，切歌 0.3s 内直接返回播放）
 * - 后台用 LLM 批量生成"通用即兴引入句"（不指定歌名）+ TTS 合成
 * - 切歌时 pop 一条 → 0 等待；后台再补一条
 * - 缓存空时降级 fallback 池（仍 ~2s）
 */
interface DjCached {
  en: string;
  zh: string;
  audioUrl: string;
  provider: string;
}
let improvCache: DjCached[] = [];
const CACHE_TARGET = 10;
let warmingCache = false;

// ============ 播出记忆（On-Air Log）============
// DJ 要有"连续感"：把最近在播的歌、DJ 说过的话记下来，
// 聊天时注入上下文 → 用户问"刚才那首""你刚才说的那个""这歌什么背景"能接上话，
// 不再答非所问/前后矛盾。（由 server/index.ts 的 broadcast() 统一调用 pushOnAir 记录）
export interface OnAirEvent {
  kind: "song" | "dj";
  time: string;
  text: string;
}
const ON_AIR_MAX = 10;
let onAirLog: OnAirEvent[] = [];

/** 记录一条播出事件（切歌 / DJ 台词），超限滚动淘汰 */
export function pushOnAir(kind: OnAirEvent["kind"], text: string): void {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  onAirLog.push({ kind, time: `${hh}:${mm}`, text: String(text).slice(0, 160) });
  if (onAirLog.length > ON_AIR_MAX) onAirLog = onAirLog.slice(-ON_AIR_MAX);
}

/** 取最近播出内容摘要（注入聊天 prompt，让 DJ 记得自己刚说过什么） */
export function getOnAirContext(max = 6): string {
  if (onAirLog.length === 0) return "";
  return onAirLog
    .slice(-max)
    .map((e) => `[${e.time}] ${e.kind === "song" ? "🎵" : "🗣"} ${e.text}`)
    .join("\n");
}

// 广播回调（由 server/index.ts 注入）；用于后台 LLM 真联想话术完成后 broadcast 第二条
let broadcastFn: ((msg: unknown) => void) | null = null;

/** 由 server/index.ts 注入 broadcast */
export function setDjBroadcast(fn: (msg: unknown) => void): void {
  broadcastFn = fn;
}

/** 生成一批缓存（一次 LLM 生成 3 条即兴句 + 逐条翻译 + TTS 音频）——补充速度 ×3，缓存不易耗尽 */
async function warmOneImprov(): Promise<DjCached[]> {
  try {
    const rawEn = await llm.chat({
      system: "You are a witty radio DJ. Output ONLY the requested lines as plain text — no JSON, no quotes, no labels, no numbering. Write for the EAR: use contractions (gonna, wanna, yeah, well, hey), one exclamation or rhetorical question, and a dash or ellipsis for rhythm. Sound like a live host, not an essay.",
      messages: [{
        role: "user",
        content: `Write 3 DIFFERENT witty generic radio transition lines (each 1-2 sentences, max 25 words) that introduce an upcoming song WITHOUT naming it — free-association about rhythm, mood, the listener's day, life, absurd situations. Dry playful humor, spoken with energy. Separate the 3 lines with newlines. Output only the 3 lines, nothing else.`,
      }],
      temperature: 0.95,
      maxTokens: 180,
    });
    const lines = rawEn
      .split("\n")
      .map((l) => l.trim().replace(/^["']|["']$/g, ""))
      .filter((l) => l.length > 8)
      .slice(0, 3);
    if (lines.length === 0) return [];

    const out: DjCached[] = [];
    for (const clean of lines) {
      try {
        const zhRaw = await llm.chat({
          messages: [{ role: "user", content: `Translate to concise Chinese (1 sentence, keep the wit):\n${clean}` }],
          temperature: 0.2,
          maxTokens: 60,
        });
        const zh = zhRaw.trim().replace(/^["']|["']$/g, "") || clean;
        const audio = await ttsService.synthesize(currentSpeakText(clean, zh), "dj", currentPersonality.voice, currentPersonality.traits);
        out.push({ en: clean, zh, audioUrl: audio.url, provider: llm.name });
      } catch { /* 单条失败跳过 */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** 后台预热缓存池（填满 CACHE_TARGET 条） */
export async function warmImprovCache(): Promise<void> {
  if (warmingCache) return;
  warmingCache = true;
  try {
    while (improvCache.length < CACHE_TARGET) {
      const batch = await warmOneImprov();
      if (batch.length === 0) break; // LLM 忙，停止本次预热
      improvCache.push(...batch);
    }
    if (improvCache.length > 0) {
      console.log(`[DJ] 预生成缓存池就绪：${improvCache.length} 条切歌话术（<10ms 秒回）`);
    }
  } catch {
    /* 预热失败不阻塞 */
  } finally {
    warmingCache = false;
  }
}

/**
 * [2026-09-07] 真·歌曲背景串场：当前歌有背景档案时，LLM 引用 era/story/funFact
 * 即兴生成一句"真懂这首歌"的切歌介绍（不再是通用短语/话术库冷笑话）。
 * - 无档案 / LLM 未配置 / 调用失败 → 返回 null，调用侧降级 phraseBank（保证切歌有声）
 * - 时长 ~2-4s（LLM+TTS），由切歌链路在音乐起播后异步触发，无空窗感
 */
async function generateSongSpecificTransition(ctx: DJContext): Promise<DJOutput | null> {
  if (!llm.isConfigured()) return null;
  const song = ctx.song;
  const profile = ctx.songProfile;
  if (!song || !profile) return null;
  const prompt =
    `A track just started on air: "${song.name}" by ${song.artist}.\n` +
    `Its background dossier:\n- 时代背景: ${profile.era}\n- 创作故事: ${profile.story}\n- 趣闻: ${profile.funFact}\n\n` +
    `Introduce this track with ONE witty line (1-2 sentences) built around ONE interesting bit from the dossier — the era, the story, or the fun fact — blended with your usual dry humor. Sound like you genuinely know the song, NOT like you read a wiki page. Land the punchline.\n` +
    `IMPORTANT: when you name the song, mention ONLY its title ("${song.name}") — never the artist name.`;
  try {
    const raw = await llm.chat({
      system: buildSystemPrompt(ctx.personality),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9,
      maxTokens: 220,
    });
    const parsed = parseBilingual(raw);
    if (!parsed) return null;
    const en = parsed.en.trim();
    const zh = parsed.zh.trim();
    const audio = await ttsService.synthesize(currentSpeakText(en, zh), "dj", currentPersonality.voice, currentPersonality.traits);
    return { en, zh, audioUrl: audio.url, provider: llm.name, funny: parsed.funny };
  } catch {
    return null;
  }
}

/**
 * [2026-09-07] 客人彩蛋：新客人接入电台 → DJ 语音欢迎（首次隆重 / 再来低调）。
 * 不走 LLM（彩蛋必须"一定能响"，LLM 挂了不能哑）——固定文案池 + 当前音色 TTS 合成，
 * 双语字幕随广播下发，前端所有设备同步听到 DJ 欢迎（电台逻辑：来宾是所有人的来宾）。
 * TTS 失败降级返回无 audioUrl 的文本（调用侧跳过播报，不炸连接）。
 *
 * 池子规模：6 条 welcome（覆盖 6 种风格：优雅/英伦/暖心/俏皮/温馨/播报腔）+ 4 条 return
 * （轻松/挽留/吐槽/诚恳）。随机抽取 → 听 N 次不重复。
 * 想换：辛老师挑新编号给"AI工作助手"直接替换 string 即可，文案都是中英双语、长度 ~25 词。
 */
const GUEST_WELCOME_LINES: ReadonlyArray<{ en: string; zh: string }> = [
  // 01 · 经典优雅
  {
    en: "Well, look who's here — a friend of Mr. Xin! Welcome, welcome, the music's warm, the jokes are questionable, and the seats are free. Don't be a stranger.",
    zh: "哟，辛老师的朋友驾到！欢迎欢迎，音乐刚好暖场，段子质量随缘，座位随意——别见外。",
  },
  // 03 · 英伦幽默
  {
    en: "Oh dear, another soul wandering into the AI Radio. Friend of Mr. Xin, I presume? Pull up a chair, we're between records and feeling generous.",
    zh: "哎呀，又一位闯入 AI 电台的迷途灵魂。是辛老师的朋友吧？快坐，正好换曲的间隙，我心情好。",
  },
  // 04 · 暖心派
  {
    en: "Welcome, friend of Mr. Xin. The booth's a little warmer tonight — must be the company. Stay a while, the playlist's about to get interesting.",
    zh: "欢迎你，辛老师的朋友。今晚直播间格外暖和——大概是人多了。坐会儿吧，歌单马上精彩起来。",
  },
  // 05 · 俏皮挑逗
  {
    en: "Look what the cat dragged in — a friend of Xin's! Don't worry, the DJ only bites on Wednesdays. Settle in, the show's just starting.",
    zh: "看看谁来了——辛老师的朋友！放心，主播只有周三才咬人（大概）。坐稳，节目刚开始。",
  },
  // 07 · 温馨电台
  {
    en: "Hello there, friend of Xin! Welcome to the AI Radio — where the music's curated, the jokes are questionable, and the company tonight is excellent. You're just in time.",
    zh: "你好啊，辛老师的朋友！欢迎收听 AI 电台——音乐精挑细选，段子质量看天，今晚嘉宾质量上佳。你来得正好。",
  },
  // 09 · 广播播报腔
  {
    en: "Attention please — a distinguished guest has joined the AI Radio. A friend of Mr. Xin, no less. Please remain seated, keep your hands inside the vehicle, and enjoy the music.",
    zh: "各位听众请注意——AI 电台迎来一位贵宾，辛老师的朋友。请坐好、手别伸出窗外、enjoy the music。",
  },
];
const GUEST_RETURN_LINES: ReadonlyArray<{ en: string; zh: string }> = [
  {
    en: "Welcome back, friend. You know the drill — good music, questionable commentary. Enjoy the show.",
    zh: "欢迎回来，朋友。老规矩——好音乐，烂点评。Enjoy。",
  },
  // · 俏皮挽留
  {
    en: "There you are! Good to see you again — the booth missed you, though honestly it just has good ventilation. The music, on the other hand, definitely waited.",
    zh: "你来了！真高兴你又出现——直播间想你了（其实它通风好），但音乐是真的在等。",
  },
  // · 暖心
  {
    en: "Back again? You must really like the music here — or my questionable jokes. Either way, welcome, friend. The playlist's warming up for you.",
    zh: "又来啦？你是真喜欢这里的歌——还是我那些蹩脚段子。都行，欢迎朋友。歌单正在为你暖场。",
  },
  // · 平淡打卡
  {
    en: "Welcome back. The booth's exactly where you left it, the music kept playing. Sit down, friend, we pick up right where we were.",
    zh: "欢迎回来。直播间一切如故，音乐一直在放。坐吧朋友，我们接着上回继续。",
  },
];

export async function generateGuestGreeting(isNew: boolean): Promise<DJOutput> {
  const pool = isNew ? GUEST_WELCOME_LINES : GUEST_RETURN_LINES;
  const line = pool[Math.floor(Math.random() * pool.length)]!;
  try {
    const audio = await ttsService.synthesize(
      currentSpeakText(line.en, line.zh),
      "dj",
      currentPersonality.voice,
      currentPersonality.traits,
    );
    return { en: line.en, zh: line.zh, audioUrl: audio.url, provider: "guest-greeting" };
  } catch (err) {
    console.warn("[DJ-guest] 欢迎语音合成失败(跳过播报):", err instanceof Error ? err.message : String(err));
    return { en: line.en, zh: line.zh, provider: "guest-greeting-text" };
  }
}

export async function generateDJLine(ctx: DJContext): Promise<DJOutput> {
  // 记住最新 personality（音色/性格全场景生效）
  if (ctx.personality) currentPersonality = ctx.personality;

  // 切歌：优先从"每日 100 条话术库"取（场景+幽默风格匹配，秒回且不重复）
  if (ctx.scene === "transition") {
    // [2026-09-07 新功能] 当前歌有背景档案 → 播"真·歌曲背景介绍"（LLM 引用时代/创作故事/趣闻即兴，
    // 2-4s 由 index.ts 在音乐起播后异步触发，无空窗感）。生成失败 → 降级原逻辑保证切歌有声。
    if (ctx.songProfile) {
      const intro = await generateSongSpecificTransition(ctx);
      if (intro) {
        lastDjEn = intro.en;
        return intro;
      }
    }
    const fromBank = pickPhrase("transition", currentPersonality.humorStyle);
    if (fromBank) {
      // 音色修复：话术库音频预合成用的是默认音色；用户选了其他音色 → 实时用当前音色重新合成，避免声音在 MiMo/Edge 间跳
      const wantVoice = currentPersonality.voice || undefined;
      if (wantVoice && fromBank.voice !== wantVoice) {
        try {
          const audio = await ttsService.synthesize(
            currentSpeakText(fromBank.en, fromBank.zh),
            "dj",
            wantVoice,
            currentPersonality.traits,
          );
          lastDjEn = fromBank.en;
          // 切歌过渡语多为冷笑话性质 → 播完配罐头笑声
          return { en: fromBank.en, zh: fromBank.zh, audioUrl: audio.url, provider: "phraseBank", funny: true };
        } catch (err) {
          // [修复 2026-09-07] 之前 catch 静默吞错 → 退回老预合成音频（混读），
          // 跟 chat 单语回复听感完全两个声音。Render log 现在能看到 TTS 真死因。
          console.warn(`[DJ-transition] phraseBank 重合成失败 → 退回预合成音频(可能混读):`,
            err instanceof Error ? err.message : String(err));
          /* 重新合成失败 → 退回预合成音频（至少能播） */
        }
      }
      lastDjEn = fromBank.en;
      // 切歌过渡语多为冷笑话性质 → 播完配罐头笑声
      return { en: fromBank.en, zh: fromBank.zh, audioUrl: fromBank.audioUrl, provider: "phraseBank", funny: true };
    }
    const fast = improvCache.pop() ?? (await fallbackDJLine(ctx));
    warmImprovCache().catch(() => {});
    lastDjEn = fast.en;
    // 缓存切歌语 = 俏皮即兴引入 → 播完也配罐头笑声（fallback 池除外，词句平淡）
    return { ...fast, funny: fast.provider === "fallback" ? false : true };
  }

  // 持续发挥上下文：仅整点报时接着上一句（切歌走预生成缓存；开场要"全新即兴"——每次打开 APP 都是崭新的开场白，不接上次的话茬）
  const continueCtx =
    ctx.scene === "hourly" && lastDjEn
      ? `\n\nYour last line was: "${lastDjEn.slice(0, 140)}"\nContinue in the same spirit — flow naturally into this, like you never stopped talking. Don't repeat yourself.`
      : "";
  const prompt = buildUserPrompt(ctx) + continueCtx;

  // Fallback 话术（LLM 未配置或调用失败时用）
  if (!llm.isConfigured()) {
    return await fallbackDJLine(ctx);
  }

  let en = "";
  let zh = "";
  let funny = false;
  try {
    // 拼 messages：system + (history) + 当前 user
    // history = [{role:user|assistant, content:en}]，最多取 ctx.history 后 10 条，
    // 且只保留 content 非空（避免 LLM 出现"空回合"误解）
    // 解决"DJ 答非所问"：之前 chat 只传单条 user prompt，LLM 看不到上文 → 问"明天去哪玩"答"下午好"
    const historyMessages = (ctx.history ?? [])
      .filter((h) => typeof h.content === "string" && h.content.trim().length > 0)
      .slice(-10)
      .map((h) => ({ role: h.role as "user" | "assistant", content: h.content }));
    const messages = [
      ...historyMessages,
      { role: "user" as const, content: prompt },
    ];
    const raw = await llm.chat({
      system: buildSystemPrompt(ctx.personality),
      messages,
      // 开场白用更高温度（更发散更即兴，每次打开 APP 都不一样）
      temperature: ctx.scene === "open" ? 1.0 : 0.9,
      // 强制短话术：对话场景 140 → 200（修复 2026-09-05：140 太紧，长对话 history 累积
      // 后 LLM 输出容易在 zh 字段被截断 → parseBilingual 收到 {"zh":""} → 中文消失）
      maxTokens: ctx.scene === "chat" ? 200 : 120,
    });
    const parsed = parseBilingual(raw);
    if (!parsed) throw new Error("无法解析双语 JSON");
    en = parsed.en;
    zh = parsed.zh;
    funny = parsed.funny;
    if (!en) throw new Error("empty");
  } catch (err) {
    // [修复 2026-09-07] chat 路径 LLM 失败必须留痕 —— 之前 catch 静默吞错，
    // DJ 一路 fallback 模板池，Render log 看不到任何线索，bug 无法定位。
    console.warn(`[DJ-chat] LLM ${llm.name} chat 失败 → fallback:`, err instanceof Error ? err.message : String(err));
    return await fallbackDJLine(ctx);
  }

  // TTS（按性别选音色）
  let audioUrl: string | undefined;
  try {
    const audio = await ttsService.synthesize(currentSpeakText(en, zh), "dj", currentPersonality.voice, currentPersonality.traits);
    audioUrl = audio.url;
  } catch {
    audioUrl = undefined;
  }

  lastDjEn = en;
  return { en, zh, audioUrl, provider: llm.name, funny };
}

async function fallbackDJLine(ctx: DJContext): Promise<DJOutput> {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  let en = "";
  let zh = "";

  if (ctx.scene === "open") {
    // 计算当前时间（自然表达），开场 fallback 也带上，避免反复打开出现重复开场
    const nowD = new Date();
    const hh = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(nowD));
    const mm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", minute: "2-digit" }).format(nowD);
    const enHour = hh % 12 === 0 ? 12 : hh % 12;
    const enTime = `${enHour}:${mm} ${hh < 12 ? "AM" : "PM"}`;
    let cnPeriod: string;
    if (hh < 6) cnPeriod = `凌晨${hh}`;
    else if (hh < 12) cnPeriod = `上午${hh}`;
    else if (hh === 12) cnPeriod = `中午12`;
    else if (hh < 18) cnPeriod = `下午${hh - 12}`;
    else cnPeriod = `晚上${hh - 12}`;
    const cnTime = `${cnPeriod}点${mm}分`;

    en = pick([
      `It's ${enTime} — welcome to AI Radio. No commercials, no premium tiers — just a code-driven DJ and whatever sharp lines come to mind.`,
      `Lights on at ${enTime}. AI Radio is live — the music is real, the commentary is mostly improvised, and the coffee was definitely not AI-made.`,
      `${enTime} and you've tuned in to AI Radio — where the playlist is deep and the small talk is deeper.`,
      `Good ${hh < 12 ? "morning" : hh < 18 ? "afternoon" : "evening"} — ${enTime} on the clock, and the only thing on my schedule is keeping yours off-beat.`,
      `It's ${enTime}. You could be doing anything, but you chose us — flattering, and frankly, good taste.`,
      `${enTime} check: the music's queued, the mic's warm, and my opinions are pre-loaded. Welcome aboard.`,
      `At ${enTime}, the world is loud. AI Radio is louder where it counts — right in the ear.`,
      `Here we are at ${enTime} — another hour of existence, and I've got the soundtrack for it.`,
    ]);
    zh = pick([
      `现在是${cnTime}——欢迎来到 AI 电台。没有广告，没有会员——只有一位被代码驱动的 DJ，以及他随时可能冒出的尖刻话。`,
      `${cnTime}灯光就位，AI 电台开播——音乐是真的，解说基本是即兴的，咖啡绝不是 AI 泡的。`,
      `${cnTime}，您已收听 AI 电台——歌单很深，废话更深。`,
      `${hh < 12 ? "早上" : hh < 18 ? "下午" : "晚上"}好——现在${cnTime}，我日程表上唯一的事，就是让您的耳朵不按套路走。`,
      `现在是${cnTime}。您本可以干别的，却选择了我们——受宠若惊，说实话，品位不错。`,
      `${cnTime}签到：音乐已排队，麦克风已预热，我的观点已加载完毕。欢迎登机。`,
      `${cnTime}，世界很吵。AI 电台在它该响的地方更响——就在您耳朵边。`,
      `${cnTime}，我们又见面了——又一段人间时光，而我有配乐。`,
    ]);
  } else if (ctx.scene === "transition" && ctx.song) {
    const { name } = ctx.song;
    const vibe = pick(["bass-heavy", "dreamy", "unapologetically catchy", "slow-burn", "window-down loud", "coffee-fuelled"]);
    en = pick([
      `That was yesterday. Up next: "${name}". Tune your ears to half-belief.`,
      `No time to mourn the last track. "${name}" — right now.`,
      `Next up, "${name}". Consider this your scheduled escape.`,
      `"${name}" — the kind of track that doesn't ask where you've been, it just knows.`,
      `"${name}" — coming at you like a punchline you didn't see coming.`,
      `Here's "${name}". If this doesn't do it for you, nothing will.`,
      `"${name}" — if this rhythm were a stock, I'd sell my silence and buy in.`,
      `This one's ${vibe} — like an economy making a comeback nobody had on the calendar.`,
      `${name} sounds like a Monday where everything goes right — politically impossible, musically delicious.`,
      `Picture ${name} over rush hour: suddenly traffic is a music video and nobody's honking.`,
      `${name} — that beat's got more bounce than a central bank's official excuses.`,
      `This track moves like it held a personal grudge against slow songs.`,
      `"${name}" plays like a love letter written during a market crash — chaotic, sincere, oddly thrilling.`,
      `${name} — the kind of rhythm that makes a politician's speech feel like an intermission.`,
    ]);
    zh = pick([
      `刚才那首就别回味了。下一首：《${name}》。请把您的耳朵调至半信半疑模式。`,
      `没时间为上一首哀悼。《${name}》——就是现在。`,
      `接下来是《${name}》。这是您预定好的出逃时刻。`,
      `《${name}》——这种歌不问你去过哪里，它什么都知道。`,
      `《${name}》来了——像一句你没料到的包袱。`,
      `这是《${name}》。它要是打动不了你，那就没什么能了。`,
      `《${name}》——这节奏要是支股票，我立刻卖光沉默加仓。`,
      `这首是${vibe === "bass-heavy" ? "重低音" : vibe === "dreamy" ? "梦幻" : vibe === "slow-burn" ? "慢热" : "上头"}向的——像一场没人排进日程的经济复苏。`,
      `《${name}》听起来像一切顺利的周一——政治上不可能，音乐上真香。`,
      `想象《${name}》在晚高峰响起：突然堵车变成了 MV，没人按喇叭了。`,
      `《${name}》——这个鼓点比央行的官方解释还能弹。`,
      `这首歌跑起来像跟慢歌有私人恩怨。`,
      `《${name}》像股市崩盘时写的情书——混乱、真诚、莫名刺激。`,
      `${name}——这节奏能让政客的演讲显得像幕间休息。`,
    ]);
  } else if (ctx.scene === "weather" && ctx.weather) {
    en = pick([
      `Outside in ${ctx.weather.city}: ${ctx.weather.description}, ${Math.round(ctx.weather.temperature)}°C. At least it's better than going out and getting flattened by reality.`,
      `Weather report from ${ctx.weather.city}: ${ctx.weather.description}, ${Math.round(ctx.weather.temperature)} degrees. The sky is doing its thing; so are we.`,
      `${ctx.weather.city} says ${ctx.weather.description}, ${Math.round(ctx.weather.temperature)}°C — perfect weather for staying exactly where you are.`,
    ]);
    zh = pick([
      `${ctx.weather.city}当前天气：${ctx.weather.description}，${Math.round(ctx.weather.temperature)}°C。在这样的天气里听歌，至少比出门被现实按在地上摩擦要体面得多。`,
      `${ctx.weather.city}天气播报：${ctx.weather.description}，${Math.round(ctx.weather.temperature)}°C。天空在忙它的，我们忙我们的。`,
      `${ctx.weather.city}：${ctx.weather.description}，${Math.round(ctx.weather.temperature)}°C——这天气最适合原地不动。`,
    ]);
  } else if (ctx.scene === "trivia" && ctx.trivia) {
    en = ctx.trivia.en;
    zh = ctx.trivia.zh;
  } else if (ctx.scene === "chat") {
    // 对话 fallback：回应式俏皮话（多样池 10 条，避免重复）
    const msg = ctx.userMessage ?? "";
    const song = ctx.song;
    const profile = ctx.songProfile;

    // [修复 2026-09-07] 问歌问题 + 有档案 → fallback 也用档案真回答，不再冷场。
    // LLM 偶尔挂 / parseBilingual 失败时，这是 DJ 唯一能"真懂歌"的兜底路径。
    // 命中：用户问句含"这首歌/这歌/歌的背景/这首/谁唱的/创作/灵感" + 当前歌有档案
    const isSongQuestion = /(这首歌|这首|这歌|歌的背景|歌曲|什么歌|谁唱的|哪首|讲讲|聊聊|介绍|说说|背景|故事|灵感|来历|趣闻|发行|哪年|原唱|翻唱|唱|feat)/i.test(msg);
    if (profile && song && isSongQuestion) {
      // 档案 3 字段随机抽一条 + 简评（不直译字段名），有人味而非档案堆砌
      const bits = [profile.era, profile.story, profile.funFact].filter(Boolean);
      const picked = bits[Math.floor(Math.random() * bits.length)] || "这歌确实有它的味道";
      const variants = [
        { en: `On "${song.name}": ${picked}. Take it or as it — that's the short of it.`, zh: `《${song.name}》：${picked}。信不信由你，反正我话就到这儿。` },
        { en: `Quick take on "${song.name}" — ${picked}. Make of it what you will.`, zh: `简单说《${song.name}》：${picked}。剩下的你自己品。` },
        { en: `About "${song.name}": ${picked}. That's the bit worth chewing on.`, zh: `聊《${song.name}》：${picked}。这事儿值得琢磨琢磨。` },
        { en: `"${song.name}" — here's the thing: ${picked}. Up to you where you go from there.`, zh: `《${song.name}》这事儿吧——${picked}。往后怎么想，看你。` },
      ];
      const pick = variants[Math.floor(Math.random() * variants.length)];
      en = pick.en;
      zh = pick.zh;
    } else {
    en = pick([
      `Interesting question — "${msg.slice(0, 40)}". If I had a heart, it'd be playing something smooth right now.`,
      `You're asking me? I'm just the guy who picks the records. But that's a good question — filed under "things I think about between songs".`,
      `Good one. I'd answer properly, but the next track is calling, and it's more interesting than me.`,
      `A fatal question from the listener. Let me spin something appropriately dramatic for it.`,
      `Fair point. My answer: spin the record, let the music talk — it's cleverer than both of us.`,
      `Hmm. Deep cut question. I'll trade you: you tell me what that song meant to you, I'll play something worthy.`,
      `Noted. Filed. Action: spin the next record loud enough to drown out your problems.`,
      `Now that's the kind of question that makes me regret not getting that philosophy degree. Let me think... yeah, no, let's just play a song.`,
      `Catch me between records and I might wax poetic. Right now? Next track's calling.`,
      `Smart ask. Honestly, I'd rather hear YOUR take — tell me your version and I'll back it with a track.`,
    ]);
    zh = pick([
      `有意思的问题——「${msg.slice(0, 30)}」。如果我有心，现在就该放首丝滑的歌应景。`,
      `你问我？我只是个挑唱片的人。不过这是个好问题——我记进"两首歌之间思考的人生问题"清单了。`,
      `问得好。我想正经回答，但下首歌在叫我，而且它比我有趣。`,
      `来自听众的致命一问。让我放首足够戏剧性的歌来回应它。`,
      `问得有道理。我的回答：把唱片一转，让音乐说——它比我们俩都机灵。`,
      `好问题。我跟你交换：你告诉我这首歌对你意味着什么，我给你放首配得上的。`,
      `收到，已归档。行动：把下一首歌音量开到能盖过你所有问题的程度。`,
      `这种问题让人后悔当年没念哲学系。让我想想……算了，还是放首歌吧。`,
      `两首歌之间的空隙我或许能抒怀。现在？下首歌在叫我。`,
      `聪明的提问。坦白说，我更想听你的版本——你说给我听，我用一首歌来配。`,
    ]);
    }
  } else {
    en = pick([
      "AI Radio, on the air.",
      "Still here, still playing, still unimpressed.",
      "The music continues. So do we.",
    ]);
    zh = pick([
      "AI 电台，正在播出。",
      "还在播，还在这，还没被征服。",
      "音乐继续，我们也是。",
    ]);
  }

  // Fallback 也生成语音（按性别选音色）
  let audioUrl: string | undefined;
  try {
    const audio = await ttsService.synthesize(currentSpeakText(en, zh), "dj", currentPersonality.voice, currentPersonality.traits);
    audioUrl = audio.url;
  } catch {
    audioUrl = undefined;
  }

  lastDjEn = en;
  return { en, zh, audioUrl, provider: "fallback" };
}