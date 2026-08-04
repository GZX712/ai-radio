import { z } from "zod";

export const NowPlayingSchema = z.object({
  songmid: z.string(),
  name: z.string(),
  artist: z.string(),
  url: z.string().url(),
  picUrl: z.string().url().optional(),
  lyric: z.string().optional(),
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