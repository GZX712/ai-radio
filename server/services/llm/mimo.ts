import type { ChatMessage, LLMProvider, LLMRequest } from "./types";
import { LLMError } from "./types";

/**
 * 小米 MiMo Provider（OpenAI 兼容）
 * 端点 https://api.xiaomimimo.com/v1/chat/completions
 * 认证：api-key 头（与 TTS 共用 MIMO_API_KEY，零新增配置）
 * 模型（MIMO_LLM_MODEL 可覆盖，默认 mimo-v2.5 实测 ~900ms 快且质量好）：
 *   - mimo-v2.5       标准（thinking disabled 后实测 ~0.9s）✅ 默认
 *   - mimo-v2.5-pro   旗舰（~2.4s，质量最高）
 *   - （v2-flash / v2-pro / v2-omni 当前账户 400 不可用）
 * 关闭 thinking：DJ 话术是短创意文案，思维链徒增延迟
 */

const MIMO_LLM_BASE_URL =
  process.env.MIMO_LLM_BASE_URL || "https://api.xiaomimimo.com/v1/chat/completions";
const DEFAULT_MODEL = "mimo-v2.5";

interface MiMoResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export class MiMoProvider implements LLMProvider {
  readonly name = "mimo";

  get apiKey() { return process.env.MIMO_API_KEY || ""; }
  get model() { return process.env.MIMO_LLM_MODEL || DEFAULT_MODEL; }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(request: LLMRequest): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError("MiMo 未配置 MIMO_API_KEY", this.name);
    }

    const messages: ChatMessage[] = request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;

    try {
      const res = await fetch(MIMO_LLM_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: request.temperature ?? 0.8,
          max_completion_tokens: request.maxTokens ?? 400,
          // DJ 话术要快：关思维链（flash 默认已关，pro/v2.5 显式关）
          thinking: { type: "disabled" },
        }),
        // 15 秒超时（flash 快；高峰期兜底）
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new LLMError(`MiMo API ${res.status}: ${errBody.slice(0, 200)}`, this.name);
      }

      const data = (await res.json()) as MiMoResponse;
      if (data.error?.message) {
        throw new LLMError(data.error.message, this.name, data.error);
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new LLMError("MiMo 返回空内容", this.name, data);
      return content.trim();
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(err instanceof Error ? err.message : "MiMo 调用失败", this.name, err);
    }
  }
}
