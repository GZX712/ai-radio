import { llm } from "./llm/doubao";

/**
 * 趣闻服务：金融/科技/历史/荒唐新闻
 * LLM 正常时生成真实趣闻；LLM 失败时用内置真实趣闻库兜底
 */

export type TriviaCategory = "finance" | "tech" | "history" | "weird";

export interface Trivia {
  category: TriviaCategory;
  en: string;
  zh: string;
}

const CATEGORY_PROMPTS: Record<TriviaCategory, string> = {
  finance: "Give me one real, verifiable finance or market anecdote that would entertain a radio listener. 1-2 sentences. Include the year. Reply in English.",
  tech: "Give me one real, verifiable tech history anecdote — a quirky product launch, an odd patent, a strange hack. 1-2 sentences with year. Reply in English.",
  history: "Give me one real, bizarre or absurd historical event that sounds made up but is true. 1-2 sentences with year. Reply in English.",
  weird: "Give me one truly weird real news story — strange laws, bizarre competitions, odd scientific experiments. 1-2 sentences with year. Reply in English.",
};

const ZONE: Record<TriviaCategory, string> = {
  finance: "金融",
  tech: "科技",
  history: "历史",
  weird: "奇闻",
};

/**
 * 内置真实趣闻库（LLM 不可用时的兜底，全部真实可查）
 */
const FALLBACK_TRIVIA: Record<TriviaCategory, Trivia[]> = {
  finance: [
    {
      category: "finance",
      en: "In 1637, a single tulip bulb sold for more than 10 times a skilled craftsman's annual income in the Netherlands — before the market collapsed overnight.",
      zh: "1637 年，荷兰一朵郁金香球茎的价格超过熟练工匠年薪的十倍——然后市场一夜崩盘。",
    },
    {
      category: "finance",
      en: "In 1720, the South Sea Company's stock rose 900% in one year on pure rumor, dragging half of England's gentry into ruin when it popped.",
      zh: "1720 年，南海公司股票靠纯谣言一年暴涨 900%，泡沫破裂时拖垮了半个英格兰的贵族。",
    },
  ],
  tech: [
    {
      category: "tech",
      en: "In 1971, Ray Tomlinson sent the first email — and later admitted he couldn't remember what he wrote, likely just something like 'QWERTYUIOP'.",
      zh: "1971 年，雷·汤姆林森发出了人类第一封电子邮件——但他事后承认自己都忘了写了啥，可能只是敲了一行键盘乱序。",
    },
    {
      category: "tech",
      en: "The first computer 'bug' was an actual moth stuck in a relay of the Harvard Mark II in 1947. Engineers taped it into the logbook.",
      zh: "人类第一个电脑「bug」（虫子）是 1947 年卡在哈佛 Mark II 继电器里的一只真飞蛾——工程师把它贴进了值班日志。",
    },
  ],
  history: [
    {
      category: "history",
      en: "In 1913, a suffragette named Emily Davison stepped in front of the King's horse at the Derby to make a point about voting rights. She did not survive.",
      zh: "1913 年，英国女权斗士艾米丽·戴维森冲进德比赛马场挡在国王的马前抗议选举权——她没有活下来。",
    },
    {
      category: "history",
      en: "The Great Emu War of 1932: Australia declared war on 20,000 emus and lost. The military withdrew after the birds outran their machine guns.",
      zh: "1932 年「大战鸸鹋」：澳大利亚向两万只鸸鹋宣战并战败——鸸鹋跑赢了机关枪，军方无奈撤兵。",
    },
  ],
  weird: [
    {
      category: "weird",
      en: "In Longyearbyen, Norway, it is illegal to die: corpses would never decompose in the permafrost, so the sick are flown south to pass away.",
      zh: "挪威朗伊尔城禁止死亡：冻土里尸体永远不会腐烂，所以病危者会被空运到南方安息。",
    },
    {
      category: "weird",
      en: "Japan once appointed a cat named Tama as station master of Kishi Station. She worked for 8 years, wearing a custom conductor hat.",
      zh: "日本曾任命一只叫「小玉」的猫担任贵志站站长，她戴着定制站长帽工作了整整 8 年。",
    },
  ],
};

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const triviaService = {
  /**
   * 生成一条趣闻：英文 + 中文翻译（一次调用双语；失败用内置库）
   */
  async generate(category: TriviaCategory = "history"): Promise<Trivia> {
    const prompt = CATEGORY_PROMPTS[category];

    try {
      const raw = await llm.chat({
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nAlso provide the Chinese translation. Output JSON: {"en": "...", "zh": "..."}`,
          },
        ],
        temperature: 0.9,
        maxTokens: 300,
      });
      const parsed = parseBilingual(raw);
      if (parsed && parsed.en) {
        return { category, en: parsed.en, zh: parsed.zh || "（中文翻译暂缺）" };
      }
    } catch {
      // LLM 不可用，走内置库
    }

    return pick(FALLBACK_TRIVIA[category]);
  },

  categoryLabel(category: TriviaCategory): string {
    return ZONE[category];
  },
};

/**
 * 宽松解析 LLM 返回的 JSON 双语
 */
function parseBilingual(raw: string): { en: string; zh: string } | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    const obj = JSON.parse(text) as { en?: unknown; zh?: unknown };
    if (typeof obj.en === "string" && obj.en.trim()) {
      return { en: obj.en.trim(), zh: typeof obj.zh === "string" ? obj.zh.trim() : "" };
    }
  } catch { /* 行解析 */ }
  const enMatch = text.match(/["']?en["']?\s*[:：]\s*["']?([^"'\n]+)/i);
  const zhMatch = text.match(/["']?zh["']?\s*[:：]\s*["']?([^"'\n]+)/i);
  if (enMatch?.[1]) {
    return { en: enMatch[1].trim(), zh: zhMatch?.[1]?.trim() ?? "" };
  }
  return null;
}