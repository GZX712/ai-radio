import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { llm } from "./llm/doubao";
import { ttsService } from "./tts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 每日话术库（phraseBank）
 * - 每天定时用 LLM 生成 100 条话术（分场景 × 幽默风格），TTS 合成音频后持久化到磁盘
 * - DJ 说话时按「场景 + 当前幽默风格」从库里随机取一条 → 不再死板重复
 * - 数据结构：JSON 文件 {generatedAt, items: [{scene, style, en, zh, audioUrl}]}
 */

export type PhraseScene = "transition" | "open" | "chat" | "weather" | "trivia" | "night";
export type PhraseStyle = "financial" | "medical" | "legal" | "poker" | "british" | "none";

export interface PhraseItem {
  scene: PhraseScene;
  style: PhraseStyle;
  en: string;
  zh: string;
  audioUrl: string;
  /** 预合成时用的音色 ID（为空 = 老数据默认音色）；取话术时与当前音色不符需重新合成 */
  voice?: string;
}

export const PHRASE_SCENES: PhraseScene[] = ["transition", "open", "chat", "weather", "trivia", "night"];
export const PHRASE_STYLES: PhraseStyle[] = ["financial", "medical", "legal", "poker", "british", "none"];

const SCENE_TARGETS: Record<PhraseScene, number> = {
  transition: 30,
  open: 15,
  chat: 25,
  weather: 10,
  trivia: 10,
  night: 10,
};

const DB_PATH = path.resolve(__dirname, "../../data/phrase-bank.json");
const STYLE_DESC: Record<PhraseStyle, string> = {
  financial: "用金融/股票术语包装日常（K线、回调、仓位、蓝筹股、止损、软着陆），冷面幽默",
  medical: "用医学/诊断术语包装日常（处方、诊断、CT、康复、临床），一本正经",
  legal: "用法律/合同术语包装日常（条款、违约、诉讼、合同、责任），严肃讲荒谬",
  poker: "用博弈/德州术语包装日常（筹码、底牌、All-in、bluff、梭哈），痞气幽默",
  british: "英式 BBC 毒舌旁白，优雅揶揄，克制中带锋利",
  none: "自然口语、温暖俏皮，不刻意套术语",
};

let bank: PhraseItem[] = [];
let bankLoaded = false;
let generating = false;
// 冷却池：最近用过的话术不重复（避免连续 2 次切换听到同一句）
const COOLING_LIMIT = 12;
const recentUsed: PhraseItem[] = [];

function scenePrompt(scene: PhraseScene): string {
  switch (scene) {
    case "transition":
      return "正在切歌/即将播放下一首歌时的过渡语——即兴引入即将到来的音乐，不指定歌名，自由联想节奏/心情/生活/荒诞场景";
    case "open":
      return "电台开场白——欢迎听众，介绍今天的氛围，温暖带点戏剧性";
    case "chat":
      return "回复听众留言/聊天消息——先接住对方说了什么，再即兴发挥，像真人对话";
    case "weather":
      return "播报天气时的开场/点评——把天气聊出人情味";
    case "trivia":
      return "分享趣闻/冷知识时的引入语——把知识点聊得有趣";
    case "night":
      return "深夜档陪伴话术——温柔、治愈、有点深夜电台的孤独感";
  }
}

/** 生成一批指定场景+风格的话术（LLM 一次出 5 条，逐条翻译 + TTS） */
async function generateBatch(scene: PhraseScene, style: PhraseStyle, count: number): Promise<PhraseItem[]> {
  const out: PhraseItem[] = [];
  const rounds = Math.ceil(count / 5);
  for (let r = 0; r < rounds && out.length < count; r++) {
    try {
      const rawEn = await llm.chat({
        system: `You are a witty radio DJ with a ${style === "none" ? "natural, warm" : "signature"} style. Output ONLY the requested lines as plain text — no JSON, no quotes, no labels, no numbering. Write for the EAR: contractions (gonna, wanna, yeah, well, hey), one exclamation or rhetorical question, dash or ellipsis for rhythm. Sound like a live host, never an essay.`,
        messages: [{
          role: "user",
          content: `Write 5 DIFFERENT lines for this radio scenario: ${scenePrompt(scene)}.\nHumor style: ${STYLE_DESC[style]}.\nEach line: 1-2 sentences, max 25 words, punchy, improvised, genuinely funny or touching. Separate lines with newlines. Output only the 5 lines.`,
        }],
        temperature: 0.95,
        maxTokens: 300,
      });
      const lines = rawEn
        .split("\n")
        .map((l) => l.trim().replace(/^["']|["']$/g, ""))
        .filter((l) => l.length > 8)
        .slice(0, 5);
      if (lines.length === 0) continue;

      for (const clean of lines) {
        if (out.length >= count) break;
        try {
          const zhRaw = await llm.chat({
            messages: [{ role: "user", content: `Translate to concise colloquial Chinese (keep the wit, 1 sentence):\n${clean}` }],
            temperature: 0.2,
            maxTokens: 60,
          });
          const zh = zhRaw.trim().replace(/^["']|["']$/g, "") || clean;
          // 预合成用默认音色（undefined）；取话术时若用户选了其他音色会实时重新合成
          const audio = await ttsService.synthesize(`${clean} ${zh}`, "dj", undefined, "");
          out.push({ scene, style, en: clean, zh, audioUrl: audio.url, voice: undefined });
        } catch {
          /* 单条失败跳过 */
        }
      }
    } catch {
      /* LLM 忙，跳过本轮 */
    }
  }
  return out;
}

/** 生成完整 100 条（所有场景 × 指定风格，数量按 SCENE_TARGETS） */
export async function regeneratePhraseBank(style: PhraseStyle = "british"): Promise<number> {
  if (generating) return bank.length;
  generating = true;
  try {
    const items: PhraseItem[] = [];
    for (const scene of PHRASE_SCENES) {
      const batch = await generateBatch(scene, style, SCENE_TARGETS[scene]);
      items.push(...batch);
      console.log(`[phraseBank] ${scene}: +${batch.length} 条`);
    }
    if (items.length === 0) {
      console.warn("[phraseBank] 生成 0 条（LLM 不可用？）");
      return bank.length;
    }
    bank = items;
    await saveToDisk();
    console.log(`[phraseBank] 话术库已更新：${items.length} 条（${new Date().toISOString()}）`);
    return items.length;
  } finally {
    generating = false;
  }
}

async function saveToDisk(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), items: bank }, null, 2), "utf8");
  } catch (err) {
    console.warn("[phraseBank] 写入磁盘失败:", err instanceof Error ? err.message : err);
  }
}

async function loadFromDisk(): Promise<void> {
  if (bankLoaded) return;
  bankLoaded = true;
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const j = JSON.parse(raw) as { items?: PhraseItem[] };
    if (Array.isArray(j.items) && j.items.length > 0) {
      bank = j.items;
      console.log(`[phraseBank] 已从磁盘加载 ${bank.length} 条话术`);
      return;
    }
  } catch {
    /* 无缓存文件，首次生成 */
  }
  // 首次启动：后台生成
  console.log("[phraseBank] 无缓存话术，后台生成中…");
  regeneratePhraseBank().catch(() => {});
}

/** 按场景+风格取一条（带冷却：最近 COOLING_LIMIT 条不再用） */
export function pickPhrase(scene: PhraseScene, style?: PhraseStyle): PhraseItem | null {
  if (bank.length === 0) return null;
  const s = style && PHRASE_STYLES.includes(style) ? style : "british";
  // 优先精确匹配 场景+风格 - 冷却
  const exact = bank.filter((p) => p.scene === scene && p.style === s && !recentUsed.includes(p));
  const sceneAny = bank.filter((p) => p.scene === scene && !recentUsed.includes(p));
  const pool = exact.length > 0 ? exact : sceneAny.length > 0 ? sceneAny : bank.filter((p) => !recentUsed.includes(p));
  if (pool.length === 0) {
    // 库全部冷却过了 → 清空冷却重启（库本来 30+ 条场景，多样性够用）
    recentUsed.length = 0;
    return pickPhrase(scene, style);
  }
  const item = pool[Math.floor(Math.random() * pool.length)];
  // 记入冷却池
  recentUsed.push(item);
  if (recentUsed.length > COOLING_LIMIT) recentUsed.shift();
  return item;
}

export function phraseBankStatus() {
  return {
    count: bank.length,
    loaded: bankLoaded,
    generatedAt: bank.length > 0 ? "见数据文件" : null,
    scenes: PHRASE_SCENES.map((s) => ({ scene: s, count: bank.filter((p) => p.scene === s).length })),
  };
}

// 启动即加载（后台）
loadFromDisk();
