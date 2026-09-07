import { ApiResponseSchema, type NowPlaying } from "@/types";

const API_BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function parseResponse(raw: unknown): NowPlaying | null {
  const parsed = ApiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[api] response invalid:", parsed.error.flatten());
    return null;
  }
  return parsed.data.data;
}

/** 切歌响应：[2026-09-07] transition 过渡音已移除（辛老师拍板：不要固定过渡音，DJ 话术由 WS 广播统一来） */
export interface SkipResult {
  song: NowPlaying | null;
}

function parseSkipResponse(raw: unknown): SkipResult {
  const song = parseResponse(raw);
  return { song };
}

export const radioApi = {
  async getNow(): Promise<NowPlaying | null> {
    return parseResponse(await request<unknown>("/now"));
  },
  async next(): Promise<SkipResult> {
    return parseSkipResponse(await request<unknown>("/next", { method: "POST" }));
  },
  async skip(): Promise<SkipResult> {
    return parseSkipResponse(await request<unknown>("/skip", { method: "POST" }));
  },
  async prev(): Promise<SkipResult> {
    return parseSkipResponse(await request<unknown>("/prev", { method: "POST" }));
  },
};
