import { musicService, type NeteaseSong } from "./music";

const IS_DEPLOYED = !!process.env.NETEASE_BASE; // 部署到 Render 时 NETEASE_BASE 已设

/**
 * 播放队列管理 v4
 * - 默认从网易云歌单拉取（辛老师"我喜欢的音乐" 294 首），失败 5 分钟后自动重试
 * - 随机播放 + 最近播放去重（避免短时间内重复）
 * - 预取下一首：切歌零等待
 * - 版权限制歌曲自动跳过
 * - prev 从 history 回退（prefetch 分支也正确记录历史）
 */

const USER_PLAYLIST_ID = process.env.PLAYLIST_ID || "6920950691"; // 辛老师"我喜欢的音乐" (284首)

const DEFAULT_PLAYLIST = [
  "186016", "28815230", "436514312", "254574",
  "5308001", "401015035", "28949444", "347230",
  "25906124", "65812", "5264641", "65528",
];

export class MusicQueue {
  private queue: string[] = [...DEFAULT_PLAYLIST];
  private history: string[] = [];
  private cursor = 0;
  private currentSong: NeteaseSong | null = null;
  private playlistName = "内置热门歌单";
  private initialized = false;
  private initRetryAt = 0; // 歌单拉取失败后的重试时间戳（5 分钟）
  // 预取池（辛老师设计）：15 首一组；播到第 12 首 → 后台预取下一组；第 15 首播完直接切新组，无缝切歌
  private prefetchPool: { index: number; song: NeteaseSong }[] = []; // 当前组
  private nextPool: { index: number; song: NeteaseSong }[] = [];     // 下一组（提前预取）
  private poolUsed = 0;                                               // 当前组已播数量
  private readonly POOL_SIZE = 15;                                    // 每组 15 首
  private readonly REFILL_AT = 12;                                    // 播到第 12 首开始预取下一组
  private prefetching = false;                                        // 当前组填充中
  private nextPrefetching = false;                                    // 下一组填充中
  // 最近播放集合（随机去重）
  private recent: string[] = [];
  private readonly RECENT_LIMIT = 40;
  // 本会话失败的歌曲 ID（移到队列末尾，下次不再尝试；进程重启后清空）
  private failedIds = new Set<string>();
  // 版权预筛进行中标记
  private screening = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    // 拉取失败后等待（避免每次切歌都卡在网易云请求上）
    if (Date.now() < this.initRetryAt) return;
    try {
      const ids = await musicService.getPlaylistTrackIds(USER_PLAYLIST_ID);
      if (ids.length === 0) throw new Error("empty playlist");
      this.queue = ids;
      this.playlistName = "我喜欢的音乐";
      this.initialized = true;
      this.initRetryAt = 0; // 重置，下次可以重新拉
      console.log(`[musicQueue] 已加载歌单「${this.playlistName}」共 ${ids.length} 首`);
      // 立即后台预取第一组 15 首（不依赖用户首次点播放）
      this.prefetchNext();
      // 后台预筛版权可播歌曲（不阻塞 init；筛完只保留能播的）
      this.screenPlayable();
    } catch (err) {
      // 部署环境（Render）netease 服务可能冷启动（首次 502），8 秒后再试
      // 本地开发 netease 子进程启动慢，30 秒后再试
      const wait = IS_DEPLOYED ? 8000 : 30000;
      this.initRetryAt = Date.now() + wait;
      console.warn(`[musicQueue] 歌单拉取失败，${wait / 1000} 秒后重试:`, err instanceof Error ? err.message : err);
    }
  }

  /** 后台批量检查版权，把拿不到 URL 的歌曲移出 queue（避免逐首碰运气连续失败） */
  private async screenPlayable(): Promise<void> {
    if (this.screening) return;
    this.screening = true;
    try {
      const playable = await musicService.getPlayableIds(this.queue);
      if (playable.size === 0) {
        console.warn("[musicQueue] 预筛 0 首可播（netease 可能刚冷启动），保留原队列稍后重筛");
      } else {
        this.queue = this.queue.filter((id) => playable.has(id));
        this.cursor = 0;
        this.failedIds.clear();
        console.log(`[musicQueue] 版权预筛完成：保留 ${this.queue.length}/${playable.size} 首可播`);
      }
    } catch (err) {
      console.warn("[musicQueue] 版权预筛失败（稍后重试）:", err instanceof Error ? err.message : err);
    } finally {
      this.screening = false;
    }
  }

  /** 强制重新拉歌单（队列太短时自动调用） */
  async refresh(): Promise<void> {
    this.initialized = false;
    this.initRetryAt = 0;
    this.recent = []; // 清空 recent 让所有歌都能被选
    this.prefetchPool = [];
    await this.init();
  }

  async current(): Promise<NeteaseSong | null> {
    await this.init();
    if (this.currentSong) return this.currentSong;
    if (this.queue.length === 0) return null;
    const song = await this.loadAt(this.cursor);
    if (song) this.pushRecent(song.songmid);
    this.prefetchNext(); // 后台预取下一首
    return song;
  }

  /** 记录最近播放（去重用） */
  private pushRecent(id: string): void {
    this.recent.push(id);
    if (this.recent.length > this.RECENT_LIMIT) this.recent.shift();
  }

  /** 随机选下一首索引：避开当前 + 最近播放过的歌 + 本会话失败的歌 */
  private pickRandomIndex(): number {
    if (this.queue.length <= 1) return 0;
    const candidates: number[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      if (i === this.cursor) continue;
      if (this.recent.includes(this.queue[i])) continue;
      if (this.failedIds.has(this.queue[i])) continue;
      candidates.push(i);
    }
    if (candidates.length === 0) {
      // 候选全在 recent/failed 里 → 清掉 recent（让所有歌都能被选）
      this.recent = [];
      const others: number[] = [];
      for (let i = 0; i < this.queue.length; i++) if (i !== this.cursor) others.push(i);
      if (others.length === 0) return 0;
      return others[Math.floor(Math.random() * others.length)];
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  async next(): Promise<NeteaseSong | null> {
    await this.init();
    if (this.queue.length === 0) {
      // 队列空了 → 强制重新拉歌单
      await this.refresh();
      if (this.queue.length === 0) return null;
    }

    // 队列太短时（多数歌曲被 splice 或版权踢掉） → 重新拉歌单补充
    if (this.queue.length < 5 && this.initialized) {
      console.log(`[musicQueue] 队列仅剩 ${this.queue.length} 首，触发重新拉歌单`);
      await this.refresh();
    }

    // 记录上一首（prefetch 命中也要记录，否则 prev 失效）
    if (this.currentSong) {
      this.history.push(this.currentSong.songmid);
    }

    // 优先用当前预取池（零等待）
    if (this.prefetchPool.length > 0) {
      const cached = this.prefetchPool.shift()!;
      this.currentSong = cached.song;
      this.cursor = cached.index;
      this.poolUsed++;
      this.pushRecent(this.currentSong.songmid);
      // 播到第 12 首 → 后台预取下一组（提前准备，避免第 15 首后无歌）
      if (this.poolUsed >= this.REFILL_AT && !this.nextPrefetching && this.nextPool.length === 0) {
        this.prefetchNextGroup();
      }
      // 当前组播完（第 15 首）→ 直接切到已预取的下一组
      if (this.prefetchPool.length === 0 && this.nextPool.length > 0) {
        this.prefetchPool = this.nextPool;
        this.nextPool = [];
        this.poolUsed = 0;
        this.prefetchNextGroup(); // 继续预取再下一组
      } else if (this.prefetchPool.length < this.REFILL_AT) {
        // 组内补充到 15 首（异常消耗时兜底）
        this.prefetchNext();
      }
      return this.currentSong;
    }
    // 当前组空了但下一组有 → 直接用下一组（兜底切换）
    if (this.nextPool.length > 0) {
      this.prefetchPool = this.nextPool;
      this.nextPool = [];
      this.poolUsed = 0;
      this.prefetchNextGroup();
      return this.next();
    }

    // 池子空了（刚启动/全部预取失败）→ 先尝试从池子没有的其他歌 loadAt，若失败再清 failedIds 重试一次
    const nextIndex = this.pickRandomIndex();
    this.cursor = nextIndex;
    let song = await this.loadAt(this.cursor);
    if (!song) {
      // 连跳失败（loadAt 深度耗尽）→ 清空 failedIds 强制重试一次（可能只是瞬时失败）
      console.warn(`[musicQueue] 连续失败，清空 failedIds 重试（当前 ${this.failedIds.size} 个失败）`);
      this.failedIds.clear();
      song = await this.loadAt(this.pickRandomIndex());
    }
    if (song) {
      this.pushRecent(song.songmid);
    }
    this.prefetchNext();
    return song;
  }

  async skip(): Promise<NeteaseSong | null> {
    return this.next();
  }

  /**
   * 上一首：从历史记录回退（没有历史则返回当前）
   */
  async prev(): Promise<NeteaseSong | null> {
    await this.init();
    const prevId = this.history.pop();
    if (!prevId) return this.current();
    const idx = this.queue.indexOf(prevId);
    if (idx >= 0) {
      this.cursor = idx;
      return this.loadAt(this.cursor);
    }
    // 历史歌曲已被删除（版权等）→ 返回当前
    return this.current();
  }

  /**
   * 后台随机预取"下一首"（详情 + URL + 歌词），版权失败时再随机换一首
   */
  /**
   * 后台预取：把当前组填满 POOL_SIZE 首（版权失败自动换下一首）
   */
  private prefetchNext(): void {
    if (this.prefetching || this.queue.length <= 1) return;
    this.prefetching = true;
    this.fillPool(this.prefetchPool, () => {
      this.prefetching = false;
    });
  }

  /**
   * 预取下一组（播到第 12 首时后台启动）
   */
  private prefetchNextGroup(): void {
    if (this.nextPrefetching || this.queue.length <= 1) return;
    this.nextPrefetching = true;
    this.fillPool(this.nextPool, () => {
      this.nextPrefetching = false;
    });
  }

  /** 通用填充逻辑：往指定池里塞歌，直到 POOL_SIZE 或队列耗尽 */
  private fillPool(pool: { index: number; song: NeteaseSong }[], done: () => void, depth = 0): void {
    if (depth > 20 || pool.length >= this.POOL_SIZE) {
      done();
      return;
    }
    const idx = this.pickRandomIndex();
    // 避开当前播放 + 两个池子已有的
    if (
      idx === this.cursor ||
      this.prefetchPool.some((p) => p.index === idx) ||
      this.nextPool.some((p) => p.index === idx)
    ) {
      this.fillPool(pool, done, depth + 1);
      return;
    }
    const songmid = this.queue[idx];
    if (!songmid) { done(); return; }
    musicService
      .getCompleteSong(songmid)
      .then((song) => {
        pool.push({ index: idx, song });
        this.fillPool(pool, done, depth + 1);
      })
      .catch(() => {
        // 版权/网络失败 → 换下一首继续填
        this.failedIds.add(songmid);
        this.fillPool(pool, done, depth + 1);
      });
  }

  private async loadAt(index: number, depth = 0): Promise<NeteaseSong | null> {
    const songmid = this.queue[index];
    if (!songmid) return null;
    // 限制递归深度（真实尝试失败 8 次就停）
    if (depth > 8) return null;
    // 本会话已经失败的歌 → 直接移到末尾 + 跳过（**不消耗深度**，一直找到能播的为止）
    if (this.failedIds.has(songmid)) {
      // 防死循环：如果几乎所有歌都被标记失败 → 清空 failedIds 重新试（可能只是瞬时风控）
      if (this.failedIds.size >= this.queue.length - 1) {
        console.warn(`[musicQueue] failedIds 已覆盖整个队列（${this.failedIds.size}），清空重试`);
        this.failedIds.clear();
      }
      if (this.queue.length > 1) {
        this.queue.splice(index, 1);
        this.queue.push(songmid);
        const nextIdx = index >= this.queue.length ? 0 : index;
        this.cursor = nextIdx;
        return this.loadAt(this.cursor, depth); // 不 +1
      }
      return null;
    }
    try {
      this.currentSong = await musicService.getCompleteSong(songmid);
      return this.currentSong;
    } catch (err) {
      console.error(`[musicQueue] 加载 ${songmid} 失败（版权限制，移到末尾）`);
      this.failedIds.add(songmid); // 标记本会话失败
      if (this.queue.length > 1) {
        // 移到队列末尾（不再尝试）
        this.queue.splice(index, 1);
        this.queue.push(songmid);
        const nextIdx = index >= this.queue.length ? 0 : index;
        this.cursor = nextIdx;
        return this.loadAt(this.cursor, depth + 1);
      }
      return null;
    }
  }

  async searchAndEnqueue(keyword: string, limit = 5): Promise<NeteaseSong[]> {
    const results = await musicService.search(keyword, limit);
    this.queue.push(...results.map((s) => s.songmid));
    return results;
  }

  reset(): void {
    this.queue = [...DEFAULT_PLAYLIST];
    this.history = [];
    this.cursor = 0;
    this.currentSong = null;
    this.prefetchPool = [];
    this.nextPool = [];
    this.poolUsed = 0;
    this.recent = [];
  }

  getQueueInfo() {
    return {
      playlistName: this.playlistName,
      queueSize: this.queue.length,
      cursor: this.cursor,
      historySize: this.history.length,
      current: this.currentSong?.songmid ?? null,
      prefetched: this.prefetchPool.length,                       // 当前组剩余
      nextPrefetched: this.nextPool.length,                       // 下一组已预取
      poolUsed: this.poolUsed,
    };
  }
}

// 单例
export const musicQueue = new MusicQueue();
