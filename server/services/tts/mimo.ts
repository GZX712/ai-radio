import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 小米 MiMo TTS Provider（OpenAI 兼容 Chat Completions）
 * - 官方平台 https://platform.xiaomimimo.com（限时免费）
 * - Base URL: https://api.xiaomimimo.com/v1（可用 MIMO_BASE_URL 覆盖，如 mimo-v2.com）
 * - 认证：Header api-key: $MIMO_API_KEY
 * - 文本放 assistant 消息；风格指令放 user 消息（可选，DJ 性格 traits 直接生效）
 * - 返回 choices[0].message.audio.data（base64）
 */

const MIMO_BASE_URL = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
const MIMO_MODEL = process.env.MIMO_MODEL || "mimo-v2.5-tts";

export interface MiMoVoice {
  /** voice 参数值 */
  id: string;
  /** 显示名 */
  name: string;
  lang: "zh" | "en" | "auto";
  gender: "male" | "female" | "neutral";
  /** 一句话描述（前端卡片展示） */
  desc: string;
}

/** MiMo 内置音色目录（mimo-v2.5-tts 实测全部可用） */
export const MIMO_VOICES: MiMoVoice[] = [
  { id: "mimo_default", name: "MiMo 默认", lang: "auto", gender: "neutral", desc: "中英自适应 · 稳" },
  { id: "default_zh", name: "中文女声", lang: "zh", gender: "female", desc: "标准普通话女声" },
  { id: "default_en", name: "英文女声", lang: "en", gender: "female", desc: "标准英文女声" },
  { id: "冰糖", name: "冰糖", lang: "zh", gender: "female", desc: "中文女声 · 清甜" },
  { id: "茉莉", name: "茉莉", lang: "zh", gender: "female", desc: "中文女声 · 温柔" },
  { id: "苏打", name: "苏打", lang: "zh", gender: "male", desc: "中文男声 · 活力" },
  { id: "白桦", name: "白桦", lang: "zh", gender: "male", desc: "中文男声 · 沉稳" },
  { id: "Mia", name: "Mia", lang: "en", gender: "female", desc: "英文女声 · 明亮" },
  { id: "Chloe", name: "Chloe", lang: "en", gender: "female", desc: "英文女声 · 优雅" },
  { id: "Milo", name: "Milo", lang: "en", gender: "male", desc: "英文男声 · 自然" },
  { id: "Dean", name: "Dean", lang: "en", gender: "male", desc: "英文男声 · 磁性" },
];

const MIMO_VOICE_IDS = new Set(MIMO_VOICES.map((v) => v.id));

export function isMiMoVoice(voiceId: string): boolean {
  return MIMO_VOICE_IDS.has(voiceId);
}

export function isMiMoConfigured(): boolean {
  return !!process.env.MIMO_API_KEY;
}

/**
 * MiMo TTS 合成
 * @param text 要合成的文本（英文 DJ 话术或中文）
 * @param voiceId 音色 ID（如 "Milo" / "冰糖"）
 * @param style 风格指令（可选，如 "毒舌、BBC 风格、慵懒"）
 * @returns mp3 Buffer
 */
export async function mimoSynthesize(text: string, voiceId: string, style?: string): Promise<Buffer> {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) throw new Error("MIMO_API_KEY 未配置");

  const messages: { role: string; content: string }[] = [];
  // 风格指令放 user 消息（MiMo 支持自然语言风格描述）
  if (style && style.trim()) {
    messages.push({ role: "user", content: style.trim().slice(0, 100) });
  }
  messages.push({ role: "assistant", content: text });

  const res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model: MIMO_MODEL,
      messages,
      audio: { format: "mp3", voice: voiceId },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`MiMo TTS ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const j = (await res.json()) as {
    choices?: { message?: { audio?: { data?: string } } }[];
  };
  const b64 = j.choices?.[0]?.message?.audio?.data;
  if (!b64) throw new Error("MiMo TTS 返回空音频");
  return Buffer.from(b64, "base64");
}

/** 试听/合成后写文件（复用 tts 输出目录） */
export async function mimoSynthesizeToFile(
  text: string,
  voiceId: string,
  style: string | undefined,
  prefix = "dj"
): Promise<{ filename: string; filepath: string; url: string }> {
  const buf = await mimoSynthesize(text, voiceId, style);
  const OUTPUT_DIR = path.resolve(__dirname, "../../../public/audio");
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const filename = `${prefix}-${Date.now()}-mimo.mp3`;
  const filepath = path.join(OUTPUT_DIR, filename);
  await fs.writeFile(filepath, buf);
  return { filename, filepath, url: `/audio/${filename}` };
}
