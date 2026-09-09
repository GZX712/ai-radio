import { musicService, forceNextNeteaseNode, type MusicSource, type NeteaseSong } from "./music";

const IS_DEPLOYED = !!process.env.NETEASE_BASE; // 部署到 Render 时 NETEASE_BASE 已设

/**
 * 播放队列管理 v4
 * - 默认从网易云歌单拉取（辛老师"我喜欢的音乐" 294 首），失败 5 分钟后自动重试
 * - 随机播放 + 最近播放去重（避免短时间内重复）
 * - 预取下一首：切歌零等待
 * - 版权限制歌曲自动跳过
 * - prev 从 history 回退（prefetch 分支也正确记录历史）
 */

const USER_PLAYLIST_ID = process.env.PLAYLIST_ID || "18342860645"; // 辛老师新默认歌单 (https://music.163.com/playlist?id=18342860645)

const DEFAULT_PLAYLIST = [
  "186016", "28815230", "436514312", "254574",
  "5308001", "401015035", "28949444", "347230",
  "25906124", "65812", "5264641", "65528",
];

export class MusicQueue {
  // [架构重构 2026-09-06] 依赖注入 MusicSource（默认线上激活的 musicService）：
  // 队列永不感知"现在是 COS 还是网易云"，双模式判断收口在 music.ts 的 facade 里。
  // 测试可注入 fake source，彻底摆脱真实网易云/COS 网络依赖。
  private musicSource: MusicSource;
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
  // 已成功消费（播放）的歌曲数——server 用它判断"是否首播"：
  // 打开电台第一次取歌（consumed 0→1）不广播 LLM 串场，只留开场白一句
  private consumed = 0;
  // 本会话失败的歌曲 ID（移到队列末尾，下次不再尝试；进程重启后清空）
  private failedIds = new Set<string>();
  // 版权预筛进行中标记
  private screening = false;
  // 本会话累计被版权拦截的歌曲数（聚合日志用，进程重启清零）
  private sessionBlockedCount = 0;

  constructor(musicSource?: MusicSource) {
    this.musicSource = musicSource ?? musicService;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // 拉取失败后等待（避免每次切歌都卡在网易云请求上）
    if (Date.now() < this.initRetryAt) return;
    // [修复 2026-09-06] 网易云节点对云 IP 间歇风控 → playlist/detail 返回 trackIds 截断（4 首 / 97 首）
    // 老逻辑：拿到几首就 init 成功，池子永远填不满 → 用户听到"那几首"循环
    // 新逻辑：trackIds 数量 < 30 视为异常（用户歌单 97 首 < 30 明显截断）
    //         → 主动 forceNextNeteaseNode() 切节点重试，最多 5 次
    //         → 5 次全败再等 30s 让风控窗口过期，再来一轮（最多 3 轮 = 15 次 ≈ 3 分钟）
    //         → 3 轮全败才走定时兜底（10 秒后再试）
    const MIN_TRACKS = 30;
    const MAX_ATTEMPTS_PER_ROUND = 5;
    const MAX_ROUNDS = 3;
    const COOLDOWN_MS = 30000; // 等网易云风控窗口过期
    let lastErr: unknown;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ROUND; attempt++) {
        try {
          const ids = await this.musicSource.getPlaylistTrackIds(USER_PLAYLIST_ID);
          if (ids.length >= MIN_TRACKS) {
            this.queue = ids;
            this.playlistName = this.musicSource.sourceName;
            this.initialized = true;
            this.initRetryAt = 0;
            console.log(`[musicQueue] 已加载歌单「${this.playlistName}」共 ${ids.length} 首（第 ${round + 1} 轮第 ${attempt + 1} 次尝试）`);
            this.prefetchNext();
            this.screenPlayable();
            return;
          }
          // 数量不足 → 当前节点被风控，强制切下一个重试
          lastErr = new Error(`trackIds 截断: ${ids.length}/${MIN_TRACKS}`);
          console.warn(`[musicQueue] 歌单数量异常（${ids.length} 首），切换节点重试 第${round + 1}轮 ${attempt + 1}/${MAX_ATTEMPTS_PER_ROUND}`);
          if (attempt < MAX_ATTEMPTS_PER_ROUND - 1) {
            forceNextNeteaseNode();
            await new Promise((r) => setTimeout(r, 1500));
          }
        } catch (err) {
          lastErr = err;
          console.warn(`[musicQueue] 歌单拉取失败 第${round + 1}轮 ${attempt + 1}/${MAX_ATTEMPTS_PER_ROUND}:`, err instanceof Error ? err.message : err);
          if (attempt < MAX_ATTEMPTS_PER_ROUND - 1) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
      // 本轮 5 次都失败 → 等待风控窗口过期，再来一轮
      if (round < MAX_ROUNDS - 1) {
        console.warn(`[musicQueue] 第 ${round + 1} 轮 5 次全败，等 ${COOLDOWN_MS / 1000}s 跨过风控窗口后重试`);
        await new Promise((r) => setTimeout(r, COOLDOWN_MS));
      }
    }
    // 3 轮 15 次都失败 → 走兜底（定时重试）
    const wait = IS_DEPLOYED ? 10000 : 30000;
    this.initRetryAt = Date.now() + wait;
    console.warn(`[musicQueue] 歌单拉取彻底失败（${MAX_ROUNDS} 轮 × ${MAX_ATTEMPTS_PER_ROUND} 次重试后），${wait / 1000} 秒后再试:`, lastErr instanceof Error ? lastErr.message : lastErr);
    setTimeout(() => {
      void this.init();
    }, wait + 1000).unref?.();
  }

  /** 后台批量检查版权，把拿不到 URL 的歌曲移出 queue（避免逐首碰运气连续失败） */
  private async screenPlayable(): Promise<void> {
    if (this.screening) return;
    this.screening = true;
    try {
      const playable = await this.musicSource.getPlayableIds(this.queue);
      if (playable.size === 0) {
        console.warn("[musicQueue] 预筛 0 首可播（netease 可能刚冷启动），保留原队列稍后重筛");
      } else {
        this.queue = this.queue.filter((id) => playable.has(id));
        this.cursor = 0;
        this.failedIds.clear();
        console.log(`[musicQueue] 版权预筛完成：保留 ${this.queue.length}/${playable.size} 首可播`);
        // [修复 2026-09-06] 预筛后 queue 太短（< 30 首）→ 大概率网易云仍被风控，
        // 主动重拉歌单（强制切节点）直到凑够可播歌。
        if (this.queue.length < 30) {
          console.warn(`[musicQueue] 预筛后仅剩 ${this.queue.length} 首，5 秒后强制重拉歌单`);
          setTimeout(() => {
            this.initialized = false;
            this.initRetryAt = 0;
            this.prefetchPool = [];
            this.queue = [];
            void this.init();
          }, 5000).unref?.();
        }
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
    // [铁壁 2026-09-07] 理论上 fillPool 会避开 cursor，但 cursor 可能在填充期间被
    // loadAt 失败 splice / prev 回退改掉 → 池里混入"当前正在播的歌"。
    // 实测（快进 ended 场景）出现过 /api/next 返回当前歌 L0071 —— 前端拿它 loadAndPlay
    // 会形成"同一首反复播放"的观感。这里消费时再做一次守卫：取到当前歌就跳过重取。
    while (this.prefetchPool.length > 0) {
      const cached = this.prefetchPool.shift()!;
      const isCurrent =
        this.currentSong?.songmid === cached.song.songmid ||
        cached.index === this.cursor;
      if (isCurrent) {
        console.warn(`[musicQueue] 预取池混入当前歌 ${cached.song.songmid}，跳过防循环`);
        if (this.prefetchPool.length > 0) continue; // 池里还有别的 → 换一首
        break; // 池已空且只此一首 → 跳出走 nextPool / 随机兜底（严格避开当前歌）
      }
      this.currentSong = cached.song;
      this.cursor = cached.index;
      this.poolUsed++;
      this.consumed++;
      this.pushRecent(this.currentSong.songmid);
      // [修复 2026-09-06] 池偏低立刻异步补充：原逻辑只在 poolUsed >= 12 才触发
      // prefetchNextGroup()；但网易云对云 IP 偶发风控时 fillPool 提前 done()，
      // 第一组只填到 5 首就停，5 首播完池空时根本没机会触发补充 → 用户听到 5 首循环。
      // 现在：消费后池 ≤ 3 首立刻 prefetchNext()，保证池不满时持续填充。
      if (this.prefetchPool.length <= 3 && !this.prefetching && this.queue.length > 1) {
        this.prefetchNext();
      }
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

    // [refill 2026-09-09] 池空但填充仍在跑 → 先等 in-flight 补货(最多 ~1.5s)，再走 loadAt。
    // 背景:fillPool 是后台自愈式(2 并发慢填),切歌瞬间恰好池空+prefetching 中时,
    // 原逻辑直接 loadAt 现场拉 → 与 fillPool 并发抢同一批歌的 URL(重复请求更慢+更乱)。
    // 现在:给填充 3×500ms 窗口,补到货就走正常消费路径(零现场拉取),真真空才 loadAt。
    if (this.prefetching || this.nextPrefetching) {
      for (let wait = 0; wait < 3; wait++) {
        await new Promise((r) => setTimeout(r, 500));
        if (this.prefetchPool.length > 0 || this.nextPool.length > 0) break;
      }
      if (this.prefetchPool.length > 0 || this.nextPool.length > 0) {
        return this.next(); // 递归一次走正常消费(池已补货,不会再次空转)
      }
      console.warn("[musicQueue] refill 等待 1.5s 后池仍空，走 loadAt 兜底(冷启动/网易云风控窗口)");
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
      this.consumed++;
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

  /** 判断 getCompleteSong 失败是否属于"永久失败"（版权/不存在）。
   *  网络超时/连接抖动是瞬时错误——标记 failedIds 会让整首歌本会话永久跳过，
   *  网易云限流几秒后池子就缩水成"那几首"循环。只有明确版权失败才永久标记。 */
  private isPermanentFail(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /无可用播放链接|不存在|版权|no url/i.test(msg);
  }

  /** 后台随机预取"下一首"（详情 + URL + 歌词），版权失败时再随机换一首 */
  /**
   * 后台预取：把当前组填满 POOL_SIZE 首（版权失败自动换下一首）
   */
  private prefetchNext(): void {
    if (this.prefetching || this.queue.length <= 1) return;
    this.prefetching = true;
    const before = this.prefetchPool.length;
    this.fillPool(this.prefetchPool, () => {
      this.prefetching = false;
      // [自愈 2026-09-06] fillPool 可能因网易云瞬时限流提前 done（池没填满）。
      // 原逻辑：done 后干等，直到用户下次点歌才触发 prefetchNext → 池长期 1-2 首，
      // 用户听到的就是池里那几首循环。现在：池没满就自动续填——
      // 本轮 0 新增（风控中）→ 15s 退避重试；有新增 → 立即续填到满。
      if (this.prefetchPool.length >= this.POOL_SIZE) return;
      const added = this.prefetchPool.length - before;
      const delay = added === 0 ? 15000 : 500;
      setTimeout(() => this.prefetchNext(), delay).unref?.();
    });
  }

  /**
   * 预取下一组（播到第 12 首时后台启动）
   */
  private prefetchNextGroup(): void {
    if (this.nextPrefetching || this.queue.length <= 1) return;
    this.nextPrefetching = true;
    const before = this.nextPool.length;
    this.fillPool(this.nextPool, () => {
      this.nextPrefetching = false;
      if (this.nextPool.length >= this.POOL_SIZE) return;
      const added = this.nextPool.length - before;
      const delay = added === 0 ? 15000 : 500;
      setTimeout(() => this.prefetchNextGroup(), delay).unref?.();
    });
  }

  /** 通用填充逻辑：并发预取，快速填满 POOL_SIZE（一次并行 5 个请求，15 首约 3 轮 ≈ 4 秒） */
  private fillPool(pool: { index: number; song: NeteaseSong }[], done: () => void, depth = 0): void {
    if (depth > 10 || pool.length >= this.POOL_SIZE) {
      done();
      return;
    }
    // 批量挑歌（避开当前播放 + 两个池子已有的）
    // [修复 2026-09-06 v2] 每轮并发从 5 → 2：Render 免费节点(0.1 vCPU)扛不住并发批量
    // （getCompleteSong 内部 3 接口 × 每轮 N 首 = 3N 个请求同时打节点 → 排队超时全 reject）。
    // 线上实测：单首拉歌 1-3s 成功率高，批量 9 并发就超时 → 退化成小并发慢填，
    // 靠 prefetchNext 自愈循环补满。慢(1-2 分钟填满)但稳，杜绝"卡死/循环那几首"。
    const picks: number[] = [];
    let guard = 0;
    while (picks.length < 2 && guard < 40) {
      guard++;
      const idx = this.pickRandomIndex();
      if (
        idx === this.cursor ||
        this.prefetchPool.some((p) => p.index === idx) ||
        this.nextPool.some((p) => p.index === idx) ||
        picks.includes(idx)
      ) continue;
      picks.push(idx);
    }
    if (picks.length === 0) { done(); return; }

    // 并发拉取
    Promise.allSettled(
      picks.map((idx) => {
        const songmid = this.queue[idx];
        if (!songmid) return Promise.reject(new Error("empty"));
        return this.musicSource.getCompleteSong(songmid).then((song) => ({ idx, song }));
      })
    ).then((results) => {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          // 逐条检查上限：整批 push 可能把池撑到 > POOL_SIZE（并发批无中间检查），
          // 超发会破坏"组内 15 首不重复"的语义，这里超过即丢弃多余
          if (pool.length >= this.POOL_SIZE) break;
          pool.push({ index: r.value.idx, song: r.value.song });
        } else {
          // [修复 2026-09-06] 只有明确版权/不存在才算永久失败；超时/网络抖动是
          // 瞬时错误（网易云限流高峰常见），静默跳过 → 下轮自愈续填时会再随机到它。
          // 原实现把所有失败 add failedIds → 限流几秒内失败的歌本会话永久消失 → 循环那几首。
          if (this.isPermanentFail(r.reason)) {
            const failed = this.queue[picks[i]];
            if (failed) {
              this.failedIds.add(failed);
              this.sessionBlockedCount++;
            }
          }
        }
      }
      this.fillPool(pool, done, depth + 1);
    });
  }

  private async loadAt(index: number, depth = 0): Promise<NeteaseSong | null> {
    const songmid = this.queue[index];
    if (!songmid) return null;
    // 限制递归深度（真实尝试失败 8 次就停）
    if (depth > 8) {
      if (this.sessionBlockedCount > 0) {
        console.warn(`[musicQueue] 网易云版权受限，本会话已跳过 ${this.sessionBlockedCount} 首`);
      }
      return null;
    }
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
      this.currentSong = await this.musicSource.getCompleteSong(songmid);
      return this.currentSong;
    } catch (err) {
      // 网易云版权限制是常态（未授权用户大量歌曲无版权）—— 聚合日志，移到末尾即可
      // 仅在 loadAt 深度耗尽时统一汇报一次总数，避免每首刷一条日志
      this.sessionBlockedCount++;
      // [修复 2026-09-06] 只有版权/不存在才算永久失败并 add failedIds（跳过不再尝试）；
      // 网络瞬时错误只移到队尾（转一圈会再遇到并重试），不永久标记。
      if (this.isPermanentFail(err)) {
        this.failedIds.add(songmid);
      }
      if (this.queue.length > 1) {
        // 移到队列末尾（版权歌本会话不再尝试 / 瞬时失败转一圈再试）
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
    const results = await this.musicSource.search(keyword, limit);
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
    this.consumed = 0;
  }

  /** 已消费（切出播放）的歌曲总数——server 判断"是否首播"用 */
  getConsumedCount(): number {
    return this.consumed;
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
      consumed: this.consumed,
    };
  }
}

// 单例
export const musicQueue = new MusicQueue();
