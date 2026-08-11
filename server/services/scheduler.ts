import cron from "node-cron";
import { musicQueue } from "./musicQueue";
import { generateDJLine, warmImprovCache } from "./dj";
import { weatherService } from "./weather";
import { triviaService, type TriviaCategory } from "./trivia";
import { withDjLock } from "./djBusy";
import { regeneratePhraseBank } from "./phraseBank";

let broadcastFn: ((msg: unknown) => void) | null = null;

export function setBroadcast(fn: (msg: unknown) => void) {
  broadcastFn = fn;
}

function broadcast(msg: unknown) {
  broadcastFn?.(msg);
}

export class RadioScheduler {
  private trackCount = 0;
  private readonly DJ_INTERVAL = 6; // 每 6 首歌自动天气/趣闻串场（避免太频繁）
  private triviaCategories: TriviaCategory[] = ["history", "weird", "tech", "finance"];
  private triviaIndex = 0;
  private cronJob: cron.ScheduledTask | null = null;
  private hourlyJob: cron.ScheduledTask | null = null;
  private phraseJob: cron.ScheduledTask | null = null;
  private lastWeather: Awaited<ReturnType<typeof weatherService.getCurrent>> = null;

  start() {
    this.cronJob = cron.schedule("30 17 * * *", () => {
      this.handleStartBroadcast();
    }, { timezone: "Asia/Shanghai" });

    // 每小时整点报时（DJ 即兴发挥，含时间）
    this.hourlyJob = cron.schedule("0 * * * *", () => {
      this.handleHourlyChime();
    }, { timezone: "Asia/Shanghai" });

    // 每日 04:00 更新 100 条话术库（避开晚高峰，生成量大会耗时 5-10 分钟）
    this.phraseJob = cron.schedule("0 4 * * *", () => {
      console.log("[Scheduler] 每日话术库更新开始（04:00）");
      regeneratePhraseBank("british")
        .then((n) => console.log(`[Scheduler] 话术库更新完成：${n} 条`))
        .catch((err) => console.warn("[Scheduler] 话术库更新失败:", err instanceof Error ? err.message : err));
    }, { timezone: "Asia/Shanghai" });

    console.log("[Scheduler] 定时开播已注册：每日 17:30 Asia/Shanghai");
    console.log("[Scheduler] 整点报时已注册：每小时 0 分");
    console.log("[Scheduler] 话术库更新已注册：每日 04:00（100 条）");
    console.log("[Scheduler] DJ 串场间隔：每", this.DJ_INTERVAL, "首歌");

    // 启动时异步拉一次天气 + 预热切歌话术缓存（0.3s 秒回）
    weatherService.getCurrent().then((w) => {
      this.lastWeather = w;
      if (w) console.log("[Scheduler] 初始天气:", w.city, w.description);
    });
    warmImprovCache().catch(() => {});
  }

  /** 每小时整点报时：DJ 即兴一句带时间的话术 */
  private async handleHourlyChime(): Promise<void> {
    console.log("[Scheduler] 整点报时...");
    const ok = await withDjLock(async () => {
      try {
        const dj = await generateDJLine({ scene: "hourly" });
        broadcast({ type: "dj", ...dj, timestamp: Date.now() });
        console.log("[Scheduler] 报时完成:", dj.en.slice(0, 50));
      } catch (err) {
        console.error("[Scheduler] 报时失败:", err);
      }
    });
    if (!ok) console.log("[Scheduler] DJ 忙，整点报时跳过");
  }

  async onTrackChange(): Promise<void> {
    this.trackCount++;
    if (this.trackCount >= this.DJ_INTERVAL) {
      this.trackCount = 0;
      await this.handleExtraDJLine();
    }
  }

  async triggerStartBroadcast(): Promise<void> {
    await this.handleStartBroadcast();
  }

  private async handleStartBroadcast(): Promise<void> {
    console.log("[Scheduler] 电台开播...");
    this.trackCount = 0;
    try {
      const song = await musicQueue.current();
      const dj = await generateDJLine({ scene: "open", song: song ?? undefined });
      broadcast({ type: "dj", ...dj, timestamp: Date.now() });
      console.log("[Scheduler] 开播完成:", dj.en.slice(0, 40));
    } catch (err) {
      console.error("[Scheduler] 开播失败:", err);
    }
  }

  private async handleExtraDJLine(): Promise<void> {
    console.log("[Scheduler] 触发额外 DJ 串场...");
    // 与切歌 transition 互斥：DJ 忙时跳过，避免两条 DJ 抢播导致"跳说"
    const ok = await withDjLock(async () => {
      try {
        const song = await musicQueue.current();

        // 第 3 / 6 / 9... 首轮换 weather 和 trivia
        const isWeatherTurn = this.triviaIndex % 2 === 0;
        this.triviaIndex++;

        if (isWeatherTurn) {
          // 天气
          const weather = await weatherService.getCurrent().catch(() => null);
          if (weather) {
            this.lastWeather = weather;
            const dj = await generateDJLine({ scene: "weather", song: song ?? undefined, weather });
            broadcast({ type: "dj", ...dj });
            console.log("[Scheduler] 天气串场完成");
            return;
          }
        }

        // 趣闻
        const category = this.triviaCategories[(this.triviaIndex) % this.triviaCategories.length];
        const trivia = await triviaService.generate(category);
        const dj = await generateDJLine({ scene: "trivia", song: song ?? undefined, trivia });
        broadcast({ type: "dj", ...dj });
        console.log("[Scheduler] 趣闻串场完成:", category);
      } catch (err) {
        console.error("[Scheduler] 串场失败:", err);
      }
    });
    if (!ok) console.log("[Scheduler] DJ 忙，天气/趣闻串场跳过");
  }

  getTrackCount(): number {
    return this.trackCount;
  }

  getLastWeather() {
    return this.lastWeather;
  }

  stop(): void {
    this.cronJob?.stop();
    this.cronJob = null;
    this.hourlyJob?.stop();
    this.hourlyJob = null;
  }
}

export const scheduler = new RadioScheduler();