/**
 * 音乐源抽象（MusicSource 深模块）— 2026-09-06 架构重构
 *
 * 背景：项目有两种音乐来源——
 *  1. NeteaseSource：HTTP 调用 vendor/NeteaseCloudMusicApi（端口 3000 或 Render 子节点），
 *     零凭证走免登录接口；支持多节点故障转移 + 云 IP 风控自动切节点。
 *  2. CosLibrarySource：辛老师自购的 97 首 mp3 传到腾讯云 COS（公有读 + Range），
 *     后端读 COS 上的 manifest.json 当歌单 → 彻底绕开网易云对云 IP 的风控循环。
 *
 * 重构动机（体检项 #1）：双模式原来散落在 musicService 的 6 个方法里各写一个
 * if (COS_LIBRARY) 分支，还泄漏到 musicQueue（连队列都在感知模式）。
 * 现在收口成一个接口 + 两个实现，musicQueue 通过构造注入，永不 import isCosLibraryMode。
 *
 * 行为完全等价：本文件重构只动结构不动逻辑（含所有历史修复注释一并保留）。
 */

// ============ 类型 ============

export interface NeteaseSong {
  songmid: string;
  name: string;
  artist: string;
  url: string;
  picUrl?: string;
  lyric?: string;
}

/** 音乐源统一接口：队列/路由只依赖它，不感知具体来源 */
export interface MusicSource {
  /** 显示名（playlistName 用）：COS 本地音乐库 / 我喜欢的音乐 */
  readonly sourceName: string;
  search(keyword: string, limit?: number): Promise<NeteaseSong[]>;
  getSongUrl(songmid: string | string[]): Promise<string>;
  getSongDetail(ids: string | string[]): Promise<NeteaseSong[]>;
  getLyric(id: string): Promise<string>;
  getPlayableIds(ids: string[]): Promise<Set<string>>;
  getCompleteSong(songmid: string): Promise<NeteaseSong>;
  getPlaylistTrackIds(playlistId: string): Promise<string[]>;
}

// ============ 网易云源 ============

// NETEASE_BASE 支持逗号分隔多个节点，按顺序优先使用；失败自动切换下一个（美国节点优先 → 新加坡备用）
const NETEASE_BASES = (process.env.NETEASE_BASE || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// 只读副本：诊断路由用，避免外部代码修改 activeBaseIndex 影响其他请求
export const NETEASE_BASES_DIAG = [...NETEASE_BASES];

/**
 * 网易云登录 Cookie（环境变量 NETEASE_COOKIE，如 "MUSIC_U=xxxx;__csrf=yyy"）
 * 配了之后所有 API 请求带登录态 → 解除版权限制（未登录大量歌曲拿不到 URL）
 * 未配置则保持游客模式（现状，行为不变）
 */
const NETEASE_COOKIE = process.env.NETEASE_COOKIE || "";

interface NeteaseSearchItem {
  id: number;
  name: string;
  artists: { name: string }[];
  album: { picUrl?: string };
}

interface NeteaseUrlResponse {
  data: { id: number | string; url?: string; size?: number }[];
}

interface NeteaseDetailResponse {
  songs: {
    id: number;
    name: string;
    ar: { name: string }[];
    al: { picUrl?: string };
  }[];
}

class NeteaseSource implements MusicSource {
  readonly sourceName = "我喜欢的音乐";
  private bases = [...NETEASE_BASES];
  private activeBaseIndex = 0;

  constructor() {
    if (this.bases.length === 0) this.bases = ["http://localhost:3000"];
  }

  /** 当前使用的节点 */
  getActiveBase(): string {
    return this.bases[this.activeBaseIndex] ?? this.bases[0] ?? "";
  }

  /**
   * 主动切换到下一个节点（不依赖 fetch 失败）
   * 用法：拉歌单返回数量异常（被风控截断）→ 强制换节点重试
   */
  forceNextNode(): string {
    if (this.bases.length > 1) {
      this.activeBaseIndex = (this.activeBaseIndex + 1) % this.bases.length;
      console.warn(`[netease] 主动切换节点 → ${this.getActiveBase()}`);
    }
    return this.getActiveBase();
  }

  status() {
    return {
      nodes: this.bases,
      active: this.getActiveBase(),
      activeIndex: this.activeBaseIndex,
    };
  }

  /** 给网易云 API 路径追加 cookie 参数（透传给 netease 节点 → 网易云） */
  private withCookie(path: string): string {
    if (!NETEASE_COOKIE) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}cookie=${encodeURIComponent(NETEASE_COOKIE)}`;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    // 多节点故障转移：当前节点失败 → 切换下一个（最多把所有节点试一遍）
    const MAX_RETRY_PER_NODE = 2;
    let lastErr: unknown;
    const attempts = Math.max(this.bases.length, 1);
    const fullPath = this.withCookie(path);
    for (let nodeTry = 0; nodeTry < attempts; nodeTry++) {
      const base = this.getActiveBase();
      for (let attempt = 0; attempt <= MAX_RETRY_PER_NODE; attempt++) {
        try {
          const res = await fetch(`${base}${fullPath}`, {
            signal: AbortSignal.timeout(15000), // 15s：免费节点处理慢，8s 太紧容易误判超时
          });
          if (!res.ok) {
            throw new Error(`Netease API ${res.status}: ${res.statusText}`);
          }
          return (await res.json()) as T;
        } catch (err) {
          lastErr = err;
          if (attempt < MAX_RETRY_PER_NODE) {
            await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          }
        }
      }
      // 当前节点彻底失败 → 切下一个节点
      if (this.bases.length > 1) {
        this.activeBaseIndex = (this.activeBaseIndex + 1) % this.bases.length;
        console.warn(`[netease] 节点 ${base} 失败，切换到 ${this.getActiveBase()}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Netease API 请求失败");
  }

  async search(keyword: string, limit = 10): Promise<NeteaseSong[]> {
    // 用 /cloudsearch（/search 常被风控返回 50000005）
    const data = await this.fetchJson<{ result: { songs?: NeteaseSearchItem[] } }>(
      `/cloudsearch?keywords=${encodeURIComponent(keyword)}&limit=${limit}`
    );
    const songs = data.result?.songs ?? [];
    return songs.map((s) => ({
      songmid: String(s.id),
      name: s.name,
      artist: (s.artists ?? []).map((a) => a.name).join(" / "),
      url: "", // 需要单独调 getSongUrl
      picUrl: s.album?.picUrl ?? undefined,
    }));
  }

  async getSongUrl(songmid: string | string[]): Promise<string> {
    const ids = Array.isArray(songmid) ? songmid.join(",") : songmid;
    const data = await this.fetchJson<NeteaseUrlResponse>(`/song/url?id=${ids}`);
    // [修复 2026-09-06] 网易云 /song/url 返回 data 是数组 [{id,url,...}] 不是对象。
    // 原代码按 Record<id,{url}> 解析，Object.values()[0] 单首时碰巧取到歌曲对象，侥幸工作。
    const first = (data.data ?? [])[0];
    if (!first?.url) {
      throw new Error(`歌曲 ${ids} 无可用播放链接（可能版权限制）`);
    }
    // 音频流转发走 netease 节点（主服务访问网易云流可能被风控超时，netease 节点访问是通的）
    // https 页面加载 http:// 网易云流会被浏览器 Mixed Content 拦截 → 必须中转成同源 https
    const active = this.getActiveBase();
    return `${active}/proxy-audio?url=${encodeURIComponent(first.url)}`;
  }

  async getSongDetail(ids: string | string[]): Promise<NeteaseSong[]> {
    const idStr = Array.isArray(ids) ? ids.join(",") : ids;
    const data = await this.fetchJson<NeteaseDetailResponse>(`/song/detail?ids=${idStr}`);
    return data.songs.map((s) => ({
      songmid: String(s.id),
      name: s.name,
      artist: s.ar.map((a) => a.name).join(" / "),
      url: "",
      picUrl: s.al?.picUrl ?? undefined,
    }));
  }

  async getLyric(id: string): Promise<string> {
    const data = await this.fetchJson<{ lrc?: { lyric?: string } }>(`/lyric?id=${id}`);
    return data.lrc?.lyric ?? "";
  }

  async getPlayableIds(ids: string[]): Promise<Set<string>> {
    const playable = new Set<string>();
    // 网易云 /song/url 支持逗号批量；分批（每批 50）避免超长 URL
    const BATCH = 50;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      try {
        const data = await this.fetchJson<NeteaseUrlResponse>(`/song/url?id=${chunk.join(",")}`);
        // [修复 2026-09-06] 响应 data 是数组 [{id,url}]；原代码按 data[id] 对象解析 → 恒空，
        // 版权预筛形同虚设（所有歌保留在队列 → fillPool/loadAt 反复试版权歌浪费深度）。
        for (const v of data.data ?? []) {
          if (v?.url) playable.add(String(v.id));
        }
      } catch {
        // 该批失败不致命，跳过
      }
    }
    return playable;
  }

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
      picUrl: detail.picUrl ?? undefined,
      lyric,
    };
  }

  async getPlaylistTrackIds(playlistId: string): Promise<string[]> {
    const data = await this.fetchJson<{ playlist?: { trackIds?: { id: number }[] } }>(
      `/playlist/detail?id=${playlistId}`
    );
    const trackIds = data.playlist?.trackIds ?? [];
    return trackIds.map((t) => String(t.id));
  }
}

// ============ COS 本地音乐库源 ============
// 辛老师把 97 首歌（自己下载的网易云文件）转 mp3 传到腾讯云 COS（公有读），
// 后端直接读 COS 上的 manifest.json 当歌单 → 彻底绕开网易云对云 IP 的风控循环。
// 启用：COS_LIBRARY=1 + COS_BASE_URL=https://bucket.cos.ap-xxx.myqcloud.com

const COS_LIBRARY = process.env.COS_LIBRARY === "1";
const COS_BASE_URL = (process.env.COS_BASE_URL || "").replace(/\/+$/, "");

interface CosManifest {
  total?: number;
  songs: {
    id: string; // L0001...
    file: string; // 相对 songs/ 的文件名（可能含中文）
    name: string;
    artist: string;
    /** 相对 covers/ 的封面文件名, 如 "L0001.jpg" 或 "L0010.png"; 老 manifest 可能无此字段 */
    picUrl?: string;
  }[];
}

class CosLibrarySource implements MusicSource {
  readonly sourceName = "COS 本地音乐库";
  private manifestCache: CosManifest | null = null;
  private manifestAt = 0;
  private manifestFetching: Promise<CosManifest> | null = null;

  /** 拉 COS manifest（带 60s 缓存 + 并发去重） */
  private async getManifest(force = false): Promise<CosManifest> {
    if (!force && this.manifestCache && Date.now() - this.manifestAt < 60_000) {
      return this.manifestCache;
    }
    if (!this.manifestFetching) {
      this.manifestFetching = (async () => {
        const res = await fetch(`${COS_BASE_URL}/manifest.json`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`COS manifest HTTP ${res.status}`);
        const m = (await res.json()) as CosManifest;
        this.manifestCache = m;
        this.manifestAt = Date.now();
        return m;
      })().finally(() => {
        this.manifestFetching = null;
      });
    }
    return this.manifestFetching;
  }

  /** 从 manifest 找歌曲（id 或文件名模糊） */
  private async findSong(songmid: string): Promise<CosManifest["songs"][number] | undefined> {
    const m = await this.getManifest();
    return m.songs.find((s) => s.id === songmid);
  }

  /** 给歌曲文件拼 COS 公开 URL（文件名 URL 编码，COS 支持 Range → 续播 OK） */
  private fileUrl(file: string): string {
    return `${COS_BASE_URL}/songs/${encodeURIComponent(file)}`;
  }

  /** 给封面拼 COS 公开 URL（manifest.picUrl 是相对路径如 "covers/L0001.jpg"） */
  private coverUrl(relPath: string | undefined): string | undefined {
    if (!relPath) return undefined;
    // 防双层编码: relPath 已是明文 "covers/L0001.jpg", 直接拼接
    // 真名文件用 ID 命名不会再含空格/中文, 但防御性 encodeURIComponent 仍保留
    return `${COS_BASE_URL}/${relPath.split("/").map(encodeURIComponent).join("/")}`;
  }

  async search(keyword: string, limit = 10): Promise<NeteaseSong[]> {
    // [COS 模式] 在本地 manifest 里模糊搜（艺术家/歌名）
    const m = await this.getManifest();
    const kw = keyword.toLowerCase();
    const hits = m.songs
      .filter((s) => `${s.artist} ${s.name}`.toLowerCase().includes(kw))
      .slice(0, limit);
    return hits.map((s) => ({
      songmid: s.id,
      name: s.name,
      artist: s.artist,
      url: this.fileUrl(s.file),
      picUrl: this.coverUrl(s.picUrl as string | undefined),
    }));
  }

  async getSongUrl(songmid: string | string[]): Promise<string> {
    // [COS 模式] URL 直指 COS 文件（公有读 + Range 支持 → 续播/seek 可用）
    const id = Array.isArray(songmid) ? songmid[0] : songmid;
    const song = await this.findSong(id);
    if (!song) throw new Error(`歌曲 ${id} 不在 COS 音乐库`);
    return this.fileUrl(song.file);
  }

  async getSongDetail(ids: string | string[]): Promise<NeteaseSong[]> {
    // [COS 模式] 从 manifest 取元数据
    const idArr = Array.isArray(ids) ? ids : ids.split(",");
    const m = await this.getManifest();
    const out: NeteaseSong[] = [];
    for (const id of idArr) {
      const s = m.songs.find((x) => x.id === id);
      if (s) {
        out.push({
          songmid: s.id,
          name: s.name,
          artist: s.artist,
          url: "",
          picUrl: this.coverUrl(s.picUrl as string | undefined),
        });
      }
    }
    return out;
  }

  async getLyric(_id: string): Promise<string> {
    // [COS 模式] 无歌词源 → 返回空（前端不展示歌词行）
    return "";
  }

  async getPlayableIds(ids: string[]): Promise<Set<string>> {
    // [COS 模式] 本地文件全部可播，直接全量返回
    return new Set(ids);
  }

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
      picUrl: detail.picUrl ?? undefined,
      lyric,
    };
  }

  async getPlaylistTrackIds(_playlistId: string): Promise<string[]> {
    // [COS 模式] 直接读 manifest 当歌单（无需 playlistId）
    const m = await this.getManifest();
    return m.songs.map((s) => s.id);
  }
}

// ============ facade：启动时按 env 选一个源 ============

const neteaseSource = new NeteaseSource();
const cosSource = new CosLibrarySource();

/** 当前激活的音乐源（队列/路由只依赖它） */
export const musicService: MusicSource = COS_LIBRARY ? cosSource : neteaseSource;

export function isCosLibraryMode(): boolean {
  return COS_LIBRARY;
}

// ---- 网易云节点诊断/切换兼容导出（health 路由、diag 路由、musicQueue 风控重试用）----

/** 当前使用的网易云节点 */
export function getActiveNeteaseBase(): string {
  return neteaseSource.getActiveBase();
}

/** 主动切换到下一个网易云节点（拉歌单数量异常被风控截断时强制换节点重试） */
export function forceNextNeteaseNode(): string {
  return neteaseSource.forceNextNode();
}

export function neteaseNodeStatus() {
  return neteaseSource.status();
}
