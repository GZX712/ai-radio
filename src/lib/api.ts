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

export const radioApi = {
  async getNow(): Promise<NowPlaying | null> {
    return parseResponse(await request<unknown>("/now"));
  },
  async next(): Promise<NowPlaying | null> {
    return parseResponse(await request<unknown>("/next", { method: "POST" }));
  },
  async skip(): Promise<NowPlaying | null> {
    return parseResponse(await request<unknown>("/skip", { method: "POST" }));
  },
  async prev(): Promise<NowPlaying | null> {
    return parseResponse(await request<unknown>("/prev", { method: "POST" }));
  },
};
