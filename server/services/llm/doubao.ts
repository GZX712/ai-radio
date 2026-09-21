import type { ChatMessage, LLMProvider, LLMRequest } from "./types";
import { LLMError } from "./types";
import { loadEnv } from "../env";

/**
 * 豆包 Doubao（字节火山引擎）
 * 零依赖原生 fetch 调 OpenAI 兼容端点。
 * .env 加载：见 server/services/env.ts（server 入口已统一加载）。
 *
 * 凭证：
 * - ARK_API_KEY: 火山引擎 API key（必填）
 * - ARK_ENDPOINT_ID: 推理接入点 ID，默认 "doubao-lite-4k"
 */

// 独立运行时（非 server/index.ts 入口）也确保 .env 已加载
loadEnv();

const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

interface ArkResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message: string };
}

export class DoubaoProvider implements LLMProvider {
  readonly name = "doubao";

  get apiKey() { return process.env.ARK_API_KEY || ""; }
  get endpointId() { return process.env.ARK_ENDPOINT_ID || "doubao-lite-4k"; }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(request: LLMRequest): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError("豆包未配置 ARK_API_KEY", this.name);
    }

    const model = this.endpointId || "doubao-lite-4k";

    const messages: ChatMessage[] = request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;

    try {
      const res = await fetch(ARK_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: request.temperature ?? 0.8,
          max_tokens: request.maxTokens ?? 200,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new LLMError(`豆包 API ${res.status}: ${errBody.slice(0, 200)}`, this.name);
      }

      const data = (await res.json()) as ArkResponse;
      if (data.error) {
        throw new LLMError(data.error.message, this.name, data.error);
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new LLMError("豆包返回空内容", this.name, data);
      return content.trim();
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(err instanceof Error ? err.message : "豆包调用失败", this.name, err);
    }
  }
}

export const doubao = new DoubaoProvider();

// 智能选择：MiMo 优先（辛老师主力，key 与 TTS 共用）→ DeepSeek → 豆包兜底
// dj.ts / trivia.ts 里的 `doubao` 引用无需改动
import { DeepSeekProvider } from "./deepseek";
import { MiMoProvider } from "./mimo";

/**
 * LLM 故障切换包装（2026-09-21 新增）
 *
 * 背景（实测到的线上/本地真实故障）：原来是**导入时静态选一次** ——
 *   `mimo.isConfigured() ? mimo : ...`
 * 只要 MiMo 的 key 存在就会被选中，而「key 存在 ≠ key 可用」。
 * 实际情况：MiMo 账号余额为 0 → 每次返回 402 Insufficient account balance，
 * 于是 [songKnowledge] 曲目档案生成失败、[DJ-chat] 全部降级成模板池，
 * 而**完全可用的 DeepSeek 通道从头到尾没被尝试过一次**（实测 DeepSeek 200 OK）。
 *
 * 现在改为运行时按序尝试：谁成功就临时「锁定」谁（默认 5 分钟），
 * 期间直接走可用通道（不再白等失败方），冷却到期后重新从首选试起，
 * 这样 MiMo 充值恢复后会自动切回，不需要重启服务。
 */
class FailoverProvider {
  private preferred: LLMProvider | null = null;
  private preferredAt = 0;
  /** 锁定备份通道的时长：到期后重试首选，兼顾「快速恢复」与「不每次都白等」 */
  private static readonly COOLDOWN_MS = 5 * 60 * 1000;

  constructor(private readonly chain: LLMProvider[]) {}

  /** 实际生效的通道名（供响应体的 provider 字段 / 日志使用） */
  get name(): string {
    return (this.preferred ?? this.chain[0])?.name ?? "none";
  }

  /** 只保留已配置凭证的通道；一个都没有时退回豆包（让报错信息保持一致） */
  private configured(p: LLMProvider): boolean {
    const cfg = (p as { isConfigured?: () => boolean }).isConfigured;
    return typeof cfg === "function" ? cfg.call(p) : true;
  }

  private available(): LLMProvider[] {
    const ok = this.chain.filter((p) => this.configured(p));
    return ok.length > 0 ? ok : [this.chain[this.chain.length - 1]];
  }

  /** 供调用方「没配任何 LLM 就别生成了」的前置判断（保持与原 provider 接口一致） */
  isConfigured(): boolean {
    return this.chain.some((p) => this.configured(p));
  }

  private order(): LLMProvider[] {
    const list = this.available();
    const head = list[0];
    const cooldownOver = Date.now() - this.preferredAt > FailoverProvider.COOLDOWN_MS;
    if (!this.preferred || this.preferred === head || cooldownOver) return list;
    if (!list.includes(this.preferred)) return list; // 锁定的通道已失配（key 被撤）→ 回到默认顺序
    return [this.preferred, ...list.filter((p) => p !== this.preferred)];
  }

  async chat(request: LLMRequest): Promise<string> {
    const order = this.order();
    let lastErr: unknown = null;
    for (const provider of order) {
      try {
        const out = await provider.chat(request);
        if (this.preferred !== provider) {
          console.warn(`[llm] 切换到 ${provider.name}（原通道不可用，${Math.round(FailoverProvider.COOLDOWN_MS / 60000)} 分钟后重试首选）`);
        }
        this.preferred = provider;
        this.preferredAt = Date.now();
        return out;
      } catch (err) {
        lastErr = err;
        console.warn(`[llm] ${provider.name} 失败，试下一个：${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new LLMError("所有 LLM 通道均失败", "failover");
  }

  /** 诊断用：当前通道顺序与实际生效通道（供 /api/health 观察） */
  status(): { chain: string[]; active: string } {
    return { chain: this.order().map((p) => p.name), active: this.name };
  }
}

export const deepseek = new DeepSeekProvider();
export const mimo = new MiMoProvider();

export const llm = new FailoverProvider([mimo, deepseek, doubao]);

