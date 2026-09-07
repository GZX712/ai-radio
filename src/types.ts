import { z } from "zod";

export const NowPlayingSchema = z.object({
  songmid: z.string(),
  name: z.string(),
  artist: z.string(),
  url: z.string().url(),
  // COS 模式无封面 picUrl 为 ""，网易云个别歌 picUrl 为 null —— 都要放行，
  // 否则 zod 校验失败 → parseResponse 返回 null → 前端拿不到歌 → 音乐不加载（"播放不了"）
  picUrl: z.union([z.string().url(), z.literal("")]).nullable().optional(),
  lyric: z.string().nullable().optional(),
});

export type NowPlaying = z.infer<typeof NowPlayingSchema>;

export const ApiResponseSchema = z.object({
  code: z.number(),
  data: NowPlayingSchema.nullable(),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;

export const DJMessageSchema = z.object({
  type: z.literal("dj"),
  en: z.string(),
  zh: z.string(),
  audioUrl: z.string().optional(),
  provider: z.string().optional(),
});

export type DJMessage = z.infer<typeof DJMessageSchema>;

export const ChatReplySchema = z.object({
  type: z.literal("chat-reply"),
  en: z.string(),
  zh: z.string(),
  audioUrl: z.string().optional(),
  provider: z.string().optional(),
});

export type ChatReply = z.infer<typeof ChatReplySchema>;