/**
 * 网易云音乐服务封装
 * 通过 HTTP 调用 vendor/NeteaseCloudMusicApi（端口 3000）
 * 零凭证，首期只用免登录接口
 */

const NETEASE_BASE = process.env.NETEASE_BASE || "http://localhost:3000";

export interface NeteaseSong {
  songmid: string;
  name: string;
  artist: string;
  url: string;
  picUrl?: string;
  lyric?: string;
}

interface NeteaseSearchItem {
  id: number;
  name: string;
  artists: { name: string }[];
  album: { picUrl?: string };
}

interface NeteaseUrlResponse {
  data: Record<string, { url: string; size: number }>;
}

interface NeteaseDetailResponse {
  songs: {
    id: number;
    name: string;
    ar: { name: string }[];
    al: { picUrl?: string };
  }[];
}

async function fetchJson<T>(path: string): Promise<T> {
  // 超时 + 2 次重试（新加坡节点访问网易云偶发超时/风控，重试可大幅提升成功率）
  const MAX_RETRY = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(`${NETEASE_BASE}${path}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        throw new Error(`Netease API ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Netease API 请求失败");
}

export const musicService = {
  /**
   * 搜索歌曲
   * @param keyword 关键词
   * @param limit 返回条数，默认 10
   */
  async search(keyword: string, limit = 10): Promise<NeteaseSong[]> {
    // 用 /cloudsearch（/search 常被风控返回 50000005）
    const data = await fetchJson<{ result: { songs?: NeteaseSearchItem[] } }>(
      `/cloudsearch?keywords=${encodeURIComponent(keyword)}&limit=${limit}`
    );
    const songs = data.result?.songs ?? [];
    return songs.map((s) => ({
      songmid: String(s.id),
      name: s.name,
      artist: (s.artists ?? []).map((a) => a.name).join(" / "),
      url: "", // 需要单独调 getSongUrl
      picUrl: s.album?.picUrl,
    }));
  },

  /**
   * 获取歌曲播放链接
   * @param songmid 歌曲 ID（可批量，逗号分隔）
   */
  async getSongUrl(songmid: string | string[]): Promise<string> {
    const ids = Array.isArray(songmid) ? songmid.join(",") : songmid;
    const data = await fetchJson<NeteaseUrlResponse>(`/song/url?id=${ids}`);
    const first = Object.values(data.data)[0];
    if (!first?.url) {
      throw new Error(`歌曲 ${ids} 无可用播放链接（可能版权限制）`);
    }
    // 走同源代理：https 页面加载 http:// 网易云流会被浏览器 Mixed Content 拦截（疯狂跳歌）
    // 后端代理带 UA/Referer 拉流，浏览器拿到的是同源 https URL
    return `/api/proxy-audio?url=${encodeURIComponent(first.url)}`;
  },

  /**
   * 获取歌曲详情（名/艺术家/封面）
   */
  async getSongDetail(ids: string | string[]): Promise<NeteaseSong[]> {
    const idStr = Array.isArray(ids) ? ids.join(",") : ids;
    const data = await fetchJson<NeteaseDetailResponse>(`/song/detail?ids=${idStr}`);
    return data.songs.map((s) => ({
      songmid: String(s.id),
      name: s.name,
      artist: s.ar.map((a) => a.name).join(" / "),
      url: "",
      picUrl: s.al?.picUrl,
    }));
  },

  /**
   * 获取歌词
   */
  async getLyric(id: string): Promise<string> {
    const data = await fetchJson<{ lrc?: { lyric?: string } }>(`/lyric?id=${id}`);
    return data.lrc?.lyric ?? "";
  },

  /**
   * 批量检查哪些歌曲有播放链接（版权筛选）
   * 一次请求测一批，返回能播放的 ID 集合（防止逐首碰运气导致连续失败）
   */
  async getPlayableIds(ids: string[]): Promise<Set<string>> {
    const playable = new Set<string>();
    // 网易云 /song/url 支持逗号批量；分批（每批 50）避免超长 URL
    const BATCH = 50;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      try {
        const data = await fetchJson<NeteaseUrlResponse>(`/song/url?id=${chunk.join(",")}`);
        for (const id of chunk) {
          const v = data.data?.[id];
          if (v?.url) playable.add(id);
        }
      } catch {
        // 该批失败不致命，跳过
      }
    }
    return playable;
  },

  /**
   * 完整获取一首歌（详情 + URL + 歌词），一次到位
   */
  async getCompleteSong(songmid: string): Promise<NeteaseSong> {
    const [details, url, lyric] = await Promise.all([
      this.getSongDetail(songmid),
      this.getSongUrl(songmid),
      this.getLyric(songmid).catch(() => ""),
    ]);
    const detail = details[0];
    if (!detail) throw new Error(`歌曲 ${songmid} 不存在`);
    return {
      songmid,
      name: detail.name,
      artist: detail.artist,
      url,
      picUrl: detail.picUrl,
      lyric,
    };
  },

  /**
   * 获取歌单所有歌曲 ID（用于初始化播放队列）
   * @param playlistId 歌单 ID
   */
  async getPlaylistTrackIds(playlistId: string): Promise<string[]> {
    const data = await fetchJson<{ playlist?: { trackIds?: { id: number }[] } }>(
      `/playlist/detail?id=${playlistId}`
    );
    const trackIds = data.playlist?.trackIds ?? [];
    return trackIds.map((t) => String(t.id));
  },
};
