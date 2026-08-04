/**
 * LLM 抽象层：可插拔多提供商
 * 当前实现：豆包 Doubao（火山引擎）
 * 扩展点：DeepSeek / Qwen / GLM 等国产 LLM
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  chat(request: LLMRequest): Promise<string>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LLMError";
  }
}
