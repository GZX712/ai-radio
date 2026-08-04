import type { ChatMessage, LLMProvider, LLMRequest } from "./types";
import { LLMError } from "./types";

/**
 * DeepSeek Provider（深度求索）
 * 端点 https://api.deepseek.com/chat/completions
 * model: deepseek-chat（自动映射最新版）
 */

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";

interface DeepSeekResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export class DeepSeekProvider implements LLMProvider {
  readonly name = "deepseek";

  get apiKey() { return process.env.DEEPSEEK_API_KEY || ""; }
  get model() { return process.env.DEEPSEEK_MODEL || DEFAULT_MODEL; }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(request: LLMRequest): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError("DeepSeek 未配置 DEEPSEEK_API_KEY", this.name);
    }

    const messages: ChatMessage[] = request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;

    try {
      const res = await fetch(DEEPSEEK_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: request.temperature ?? 0.8,
          max_tokens: request.maxTokens ?? 200,
        }),
        // 12 秒超时，防止 DeepSeek 高峰期挂起
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new LLMError(`DeepSeek API ${res.status}: ${errBody.slice(0, 200)}`, this.name);
      }

      const data = (await res.json()) as DeepSeekResponse;
      if (data.error?.message) {
        throw new LLMError(data.error.message, this.name, data.error);
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new LLMError("DeepSeek 返回空内容", this.name, data);
      return content.trim();
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(err instanceof Error ? err.message : "DeepSeek 调用失败", this.name, err);
    }
  }
}
