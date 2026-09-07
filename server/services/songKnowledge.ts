/**
 * 歌曲背景档案（Song Knowledge）— 2026-09-07 新功能
 *
 * 目标：让 DJ "真懂"正在放的歌。用户问"这歌什么背景/创作故事/趣闻"、
 * 切歌话术要引用歌曲时代背景时，都能拿到真实可信的档案，而不是瞎编。
 *
 * 档案结构（三字段，中文，每条 ≤70 字）：
 *   era     — 时代背景（大致年代 + 当时风潮）
 *   story   — 创作故事 / 灵感
 *   funFact — 趣闻冷知识
 *
 * 数据来源：LLM（统一 llm 实例，MiMo→DeepSeek→豆包自动选）。
 * 防幻觉硬规则：不确定用"大约/据说/印象中"，绝不许编造精确年份/人物/事件；
 * 完全没把握的歌 → 基于歌名/艺人气质做"明说推测"的联想，不装懂。
 *
 * 缓存：songmid → SongProfile，LRU 上限 60；单飞（同一首歌并发只生成一次）；
 * 全局最多 3 个生成同时在途，超出直接返回 null（不排队不阻塞，warm 场景下次再补）。
 * 失败不写缓存（但 warm 侧有 per-song 冷却由 LRU 自然承担），调用侧一律降级。
 */

import { llm } from "./llm/doubao";
import type { NeteaseSong } from "./music";

export interface SongProfile {
  songmid: string;
  name: string;
  artist: string;
  /** 时代背景一句话（含大致年代/风潮；不确定带"大约"） */
  era: string;
  /** 创作故事 / 灵感 */
  story: string;
  /** 趣闻冷知识 */
  funFact: string;
  provider: string;
}

const CACHE_MAX = 60;
const MAX_CONCURRENT = 3;
const PROFILE_TIMEOUT_MS = 8000;

/** songmid → profile（Map 插入序 = LRU 序，超限删最早） */
const cache = new Map<string, SongProfile>();
/** songmid → in-flight promise（并发去重：同一首歌只生成一次） */
const inFlight = new Map<string, Promise<SongProfile | null>>();
/** 当前在途生成数（全局并发上限） */
let activeGens = 0;

/** 同步查缓存（聊天普通问题时"有就用、没有不带"，不阻塞等待） */
export function getCachedSongProfile(song: Pick<NeteaseSong, "songmid">): SongProfile | null {
  return cache.get(song.songmid) ?? null;
}

/** 生成一首歌的背景档案（内部：不缓存、不管并发——由 getSongProfile 统一调度） */
async function generateProfile(song: NeteaseSong): Promise<SongProfile | null> {
  if (!llm.isConfigured()) return null;
  const name = (song.name || "").slice(0, 80);
  const artist = (song.artist || "").slice(0, 60);
  if (!name) return null;

  const system = `You are the research librarian for a radio station. The DJ relies on your dossiers to talk about songs on air — listeners WILL fact-check, so accuracy matters more than sounding smart.

HARD RULES:
1. You may use widely known music-world knowledge (famous albums, awards, movie soundtracks, well-documented creative stories) — but ONLY when you are genuinely confident about the song or artist.
2. NEVER fabricate precise facts: specific release years, person names, events, sales figures. If unsure, hedge with "大约 / 据说 / 印象中".
3. If the song is obscure and NOT in your knowledge base at all: write honest lines like "这首比较小众，我资料有限" and add ONE reasonable vibe-based observation from the title/artist style — clearly framed as an impression, never as fact.
4. Keep each field under 70 Chinese characters, spoken-style, not encyclopedia prose.`;

  const prompt = `给这首歌写一份背景档案（中文）：
歌名：${name}
艺人：${artist}

输出 JSON（单行，不要 markdown 代码块，不要多余文字）：
{"era":"时代背景：大致年代 + 当时音乐风潮，一句话","story":"创作故事：灵感/创作过程，确知写具体，不确定用据说/印象中","funFact":"一个值得聊的冷门趣闻或观察点"}`;

  try {
    const raw = await llm.chat({
      system,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4, // 低温：压制幻觉，宁稳勿飘
      maxTokens: 500,
    });
    const parsed = parseProfile(raw);
    if (!parsed) return null;
    return {
      songmid: song.songmid,
      name,
      artist,
      era: parsed.era,
      story: parsed.story,
      funFact: parsed.funFact,
      provider: llm.name,
    };
  } catch (err) {
    console.warn(`[songKnowledge] ${name} 档案生成失败:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** 宽松解析 LLM 返回的档案 JSON（支持代码块包裹 / 前后缀噪音） */
function parseProfile(raw: string): { era: string; story: string; funFact: string } | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) text = text.slice(objStart, objEnd + 1);
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const clean = (v: unknown): string =>
      typeof v === "string" ? v.trim().replace(/^["']|["']$/g, "") : "";
    const era = clean(obj.era);
    const story = clean(obj.story);
    const funFact = clean(obj.funFact);
    if (!era && !story && !funFact) return null;
    return { era, story, funFact };
  } catch {
    return null;
  }
}

/**
 * 取歌曲档案（缓存命中秒回；未命中触发生成并等待，最长 timeoutMs）。
 * 同首歌并发只生成一次（单飞）；生成失败返回 null，不抛异常。
 */
export async function getSongProfile(
  song: NeteaseSong,
  timeoutMs = PROFILE_TIMEOUT_MS
): Promise<SongProfile | null> {
  if (!song || !song.songmid) return null;
  const hit = cache.get(song.songmid);
  if (hit) return hit;

  let task = inFlight.get(song.songmid);
  if (!task) {
    if (activeGens >= MAX_CONCURRENT) {
      // 生成器繁忙：不排队（避免 DJ 串场/聊天被 LLM 队列拖死），返回 null 走降级
      return null;
    }
    activeGens++;
    task = generateProfile(song)
      .then((p) => {
        if (p) {
          cache.set(song.songmid, p);
          if (cache.size > CACHE_MAX) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
        }
        return p;
      })
      .finally(() => {
        activeGens--;
        inFlight.delete(song.songmid);
      });
    inFlight.set(song.songmid, task);
  }
  // 等待结果（带超时：LLM 慢时不阻塞 DJ 话术/聊天主链路）
  return Promise.race([
    task,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/**
 * 后台预热（fire-and-forget）：切歌成功后可立即调用，让下一首的档案在
 * 用户开口问之前就绪。内部吞掉一切异常。
 */
export function warmSongProfile(song: NeteaseSong | null | undefined): void {
  if (!song || !song.songmid) return;
  if (cache.has(song.songmid) || inFlight.has(song.songmid)) return;
  getSongProfile(song, 15000).catch(() => null);
}
