import { EdgeTTS } from "node-edge-tts";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isMiMoVoice, mimoSynthesizeToFile, MIMO_VOICES } from "./tts/mimo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * TTS 服务（v2 · 双引擎）
 * - MiMo（小米，限时免费，9 个内置音色，自然语言风格控制）—— 配置 MIMO_API_KEY 后优先
 * - Edge-TTS（微软，零成本兜底，多语言神经音色）
 * voice 参数支持两种：
 *   1. MiMo 音色 ID（如 "Milo" / "冰糖" / "mimo_default"）→ 走 MiMo API
 *   2. Edge 音色名（如 "en-US-GuyNeural" / "zh-CN-YunxiNeural"）→ 走 Edge-TTS
 */

/** Edge-TTS 兜底音色目录（免费） */
export interface EdgeVoice {
  id: string;
  name: string;
  lang: "zh" | "en";
  gender: "male" | "female" | "neutral";
  desc: string;
}

export const EDGE_VOICES: EdgeVoice[] = [
  { id: "en-US-GuyNeural", name: "Guy (美式男)", lang: "en", gender: "male", desc: "沉稳新闻腔 · 经典" },
  { id: "en-US-DavisNeural", name: "Davis (美式男)", lang: "en", gender: "male", desc: "年轻温暖 · 自然" },
  { id: "en-US-TonyNeural", name: "Tony (美式男)", lang: "en", gender: "male", desc: "戏剧化 · 有力" },
  { id: "en-US-JennyNeural", name: "Jenny (美式女)", lang: "en", gender: "female", desc: "明亮清晰 · 经典" },
  { id: "en-US-AriaNeural", name: "Aria (美式女)", lang: "en", gender: "female", desc: "新闻感 · 专业" },
  { id: "en-US-SaraNeural", name: "Sara (美式女)", lang: "en", gender: "female", desc: "活泼甜美" },
  { id: "zh-CN-YunxiNeural", name: "云希 (中文男)", lang: "zh", gender: "male", desc: "青年男声 · 活力" },
  { id: "zh-CN-XiaoxiaoNeural", name: "晓晓 (中文女)", lang: "zh", gender: "female", desc: "温暖女声 · 自然" },
];

const DEFAULT_VOICE = process.env.TTS_VOICE || "en-US-GuyNeural";
const OUTPUT_DIR = path.resolve(__dirname, "../../public/audio");

async function ensureDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

export interface TTSResult {
  filename: string;
  filepath: string;
  url: string;
  duration?: number;
}

export const ttsService = {
  /**
   * 合成语音
   * @param text 要朗读的文本
   * @param prefix 文件名前缀（dj / weather / trivia / preview）
   * @param voiceId 音色：MiMo ID（Milo/冰糖…）或 Edge 名（en-US-GuyNeural…）；缺省用默认
   * @param style 风格指令（仅 MiMo 生效，DJ 性格 traits）
   */
  async synthesize(text: string, prefix = "dj", voiceId?: string, style?: string): Promise<TTSResult> {
    await ensureDir();
    const voice = voiceId || DEFAULT_VOICE;

    // MiMo 音色：优先（配置了 key 才可用）
    if (isMiMoVoice(voice) && process.env.MIMO_API_KEY) {
      try {
        // 情感指令增强：MiMo 支持自然语言风格控制，让朗读有温度
        const emotionHint = "用自然、有感情、口语化的语调朗读，抑扬顿挫，像真人广播主持那样有感染力";
        const enhancedStyle = style && style.trim() ? `${style.trim()}。${emotionHint}` : emotionHint;
        const r = await mimoSynthesizeToFile(text, voice, enhancedStyle, prefix);
        return r;
      } catch (err) {
        console.warn("[TTS] MiMo 合成失败，降级 Edge-TTS:", err instanceof Error ? err.message : err);
        // 降级 Edge（用同语言 Edge 音色兜底）
        const fallbackEdge = style && /[\u4e00-\u9fa5]/.test(text) ? "zh-CN-YunxiNeural" : DEFAULT_VOICE;
        const tts = new EdgeTTS({ voice: fallbackEdge, lang: "en-US", volume: "+40%" });
        const filename = `${prefix}-${Date.now()}.mp3`;
        const filepath = path.join(OUTPUT_DIR, filename);
        await tts.ttsPromise(text, filepath);
        return { filename, filepath, url: `/audio/${filename}` };
      }
    }

    // Edge-TTS（voice 若是 MiMo 音色但未配 key → 降级默认 Edge 音色，避免无效音色报错）
    const edgeVoice = isMiMoVoice(voice) ? DEFAULT_VOICE : voice;
    const tts = new EdgeTTS({ voice: edgeVoice, lang: "en-US", volume: "+40%" });
    const filename = `${prefix}-${Date.now()}.mp3`;
    const filepath = path.join(OUTPUT_DIR, filename);
    await tts.ttsPromise(text, filepath);
    return { filename, filepath, url: `/audio/${filename}` };
  },

  /** 音色目录（前端选择器用）：MiMo + Edge 合并 */
  getVoiceCatalog() {
    return [
      ...MIMO_VOICES.map((v) => ({ ...v, engine: "mimo" as const, free: true })),
      ...EDGE_VOICES.map((v) => ({ ...v, engine: "edge" as const, free: true })),
    ];
  },

  async cleanup(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    await ensureDir();
    const files = await fs.readdir(OUTPUT_DIR);
    const now = Date.now();
    let deleted = 0;
    for (const f of files) {
      const m = f.match(/^(dj|weather|trivia|preview)-(\d+).*\.mp3$/);
      if (!m) continue;
      const ts = parseInt(m[2], 10);
      if (now - ts > maxAgeMs) {
        await fs.unlink(path.join(OUTPUT_DIR, f)).catch(() => {});
        deleted++;
      }
    }
    return deleted;
  },

  getAudioDir() {
    return OUTPUT_DIR;
  },
};
