import type { ChatMessage, LLMProvider, LLMRequest } from "./types";
import { LLMError } from "./types";
import fs from "node:fs";
import path from "node:path";

/**
 * 豆包 Doubao（字节火山引擎）
 * 零依赖原生 fetch 调 OpenAI 兼容端点。
 * .env 加载：运行时读项目根目录的 .env 文件，不依赖 dotenv 包。
 *
 * 凭证：
 * - ARK_API_KEY: 火山引擎 API key（必填）
 * - ARK_ENDPOINT_ID: 推理接入点 ID，默认 "doubao-lite-4k"
 */

// ES module 顶层 load .env（覆盖 process.env）
loadEnv();

function loadEnv() {
  try {
    const root = path.resolve(".");
    const content = fs.readFileSync(path.join(root, ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
    console.log("[doubao] .env loaded");
  } catch {
    // .env 不存在或不可读，继续
  }
}

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

// 智能选择：DeepSeek 优先（配置了就用），否则用豆包
// dj.ts / trivia.ts 里的 `doubao` 引用无需改动
import { DeepSeekProvider } from "./deepseek";
const deepseek = new DeepSeekProvider();
export const llm = deepseek.isConfigured() ? deepseek : doubao;
export { deepseek };
