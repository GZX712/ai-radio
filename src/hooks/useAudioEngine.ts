import { useRef, useCallback, useEffect } from "react";
import { useRadioStore } from "@/store/useRadioStore";
import { radioApi } from "@/lib/api";
import { playRandomSfx } from "@/lib/sfx";
import { playLaughTrack, stopLaughTrack } from "@/lib/laugh";
import { saveResume, loadResume } from "@/lib/resume";
import { getCachedAudioUrl, pinPlayingAudio } from "@/lib/audioCache";
import type { NowPlaying } from "@/types";

/**
 * [2026-09-21 手机端延迟修复] 以下四个常量全部来自真机实测（Slow 4G + CPU 4x）：
 *
 * 现场：点击「开始电台」后 **35 秒**才出声，下载量 30MB 只听到一首歌。三个成因：
 *   1) 同一首歌被两次赋 music.src → 浏览器中止在途下载、从 0 重来（13MB 下两遍）
 *   2) 看门狗把「慢网正常缓冲」误判成死播 → 自动切歌，把下到一半的整首丢掉
 *   3) loadAndPlay 的起播超时只有 6 秒，而 13MB @ 1.6Mbps 光缓冲就远超 6 秒
 * 修完 1+2 后，「点击 → 出声」从 34959ms 降到 ~1s 量级（预缓冲被复用）。
 */
/** 换源后的缓冲宽限：这段时间内绝不判定「死播」 */
const STALL_GRACE_MS = 30_000;
/** 仍在缓冲（readyState < 3）时的无推进容忍上限 */
const STALL_BUFFERING_MS = 75_000;
/** 缓冲已充足（readyState >= 3）却完全不动 → 才判定死播 */
const STALL_READY_MS = 20_000;
/** 起播超时（原 6 秒对慢网太激进） */
const PLAY_TIMEOUT_MS = 25_000;

interface AudioNodes {
  ctx: AudioContext;
  // 音乐通道
  music: HTMLAudioElement;
  musicGain: GainNode;
  analyser: AnalyserNode;
  // DJ 通道（独立 MediaElementSource，与音乐在 WebAudio 内混音，避免 iOS 音频抢占）
  dj: HTMLAudioElement;
  djGain: GainNode;
  /** 音乐元素是否已接入 WebAudio */
  wired: boolean;
  /** DJ 元素是否已接入 WebAudio（分开记：一个失败不该拖死另一个） */
  djWired: boolean;
}

/**
 * [2026-09-25 手机端「完全无声」根治] 把媒体元素接进 WebAudio —— 但**只在 ctx 真正
 * running 之后**才接，且永不撤销。
 *
 * 为什么必须延迟接线：
 *   `createMediaElementSource(el)` 一旦调用，该元素的音频就**只从 WebAudio graph 输出**，
 *   而且**不可回退**（再调一次会抛 InvalidStateError，元素也无法恢复默认输出）。
 *   手机（iOS Safari / 安卓 WebView / 微信 X5）在**没有用户手势**时 AudioContext 恒为
 *   `suspended`，此时若已接线，就会出现最坏的组合：
 *       媒体元素"在播"（`play()` resolve、进度条在走、UI 显示暂停键）
 *       但一点声音都没有，而且**音乐与 DJ 两个通道一起哑**。
 *   主人设备（已绑）直达播放器、页面上**没有任何手势入口**，正好踩中这个坑；
 *   PC 的 Chrome 因 Media Engagement Index 直接放行 autoplay，所以电脑侧正常。
 *
 * 延迟接线后的行为：
 *   - 拿到手势 → resume 成功 → 接线 → 正常混音 + analyser 波形（与之前完全一致）
 *   - 始终拿不到手势 / resume 失败 → **保持不接线** → 元素走默认输出，至少能出声
 *     （代价仅是 DJ 说话时音乐不再自动 duck，以及波形取不到数据）
 */
function ensureGraph(n: AudioNodes): void {
  if (n.ctx.state !== "running") return; // 未解锁不接线 —— 这是整个修复的关键前提
  if (!n.wired) {
    try {
      n.ctx
        .createMediaElementSource(n.music)
        .connect(n.musicGain)
        .connect(n.analyser)
        .connect(n.ctx.destination);
      n.wired = true;
    } catch {
      /* 该环境不支持 MediaElementSource：保持未接线，music 直出 */
    }
  }
  if (!n.djWired) {
    try {
      n.ctx.createMediaElementSource(n.dj).connect(n.djGain).connect(n.ctx.destination);
      n.djWired = true;
    } catch {
      /* 同上：dj 直出 */
    }
  }
}

/**
 * [2026-09-25] 尝试解锁 AudioContext —— **fire-and-forget，任何地方都不要 await 它**。
 *
 * 为什么不能 await：iOS 在**没有用户手势**时，`ctx.resume()` 返回的 promise 不是 reject
 * 而是**一直 pending**（等手势来才兑现）。只要有一处 `await ctx.resume()`，整条播放流程
 * 就会卡在那里 —— `loadAndPlay` 的 25 秒超时兜底一到期就抛「播放超时」，
 * 结果**音乐根本没开始播、一点声音都没有**。这正是手机端"完全无声"的第二个成因。
 *
 * resume 只负责解锁 WebAudio 混音，元素本身能否出声不受它影响，
 * 所以完全可以丢在后台跑；成功了就把两个元素接进 WebAudio（ensureGraph）。
 */
function tryResume(n: AudioNodes): void {
  if (n.ctx.state !== "suspended") {
    ensureGraph(n);
    return;
  }
  void n.ctx
    .resume()
    .then(() => ensureGraph(n))
    .catch(() => {
      /* 无手势/被策略拒绝：保持未接线，元素走默认输出（至少有声音） */
    });
}

/**
 * Premium 音频引擎 v4：双通道 WebAudio 混音 + DJ 播放控制
 * - 音乐通道：music → musicGain(duck) → analyser → destination
 * - DJ 通道：dj → djGain(1.0) → destination
 * - 暂停时 DJ 同步暂停；恢复播放时丢弃未说完的话术（清空队列）
 */
export function useAudioEngine() {
  const nodesRef = useRef<AudioNodes | null>(null);

  // DJ 语音队列：入队 + 当前正在播的字幕同步
  // laugh=true 表示该条是笑话/怼人台词 → 播完后接 sitcom 罐头笑声
  // onEnded 是该条播完后回调（用于按钮状态回弹："播完"清空 playingReplyId）
  type DjItem = { url: string; en: string; zh: string; laugh?: boolean; onEnded?: () => void };
  const djQueueRef = useRef<DjItem[]>([]);
  const djPlayingRef = useRef(false);
  // 音乐暂停时 DJ 同步暂停；恢复播放时丢弃未说完的（用户明确要求）
  const djPausedRef = useRef(false);
  // 最近播放的 DJ 语音（去重：防双广播/双 skip 导致"同一句说两遍"）
  const lastDjRef = useRef<{ url: string; at: number }>({ url: "", at: 0 });
  // 是否已成功开播过一首（!booted = 电台启动阶段）：启动阶段不播切歌 jingle，
  // 让 /api/dj/open 的开场白当唯一第一句（辛老师反馈"打开时语音太密集"）
  const bootedRef = useRef(false);
  // 自动跳歌滑动窗口限流：60 秒内最多自动跳 5 次；超限 = 疑似断网 → 暂停自动跳并提示，
  // 窗口滑动后自然恢复。※ 旧版"8 秒内第二次 error 永久放弃"会在连续两首坏歌后
  // 锁死无声且永不恢复 —— 这是"播放静止"的一个直接 bug，已废弃。
  const autoSkipTimesRef = useRef<number[]>([]);
  // 跳歌请求挂起中（防 error/stall/ended 多重触发导致并发重叠 skip）
  const autoSkipPendingRef = useRef(false);
  // 心跳看门狗 stall 状态：记录 currentTime 最后推进时刻
  const stallRef = useRef({ lastTime: -1, lastMoveAt: 0, pending: false });
  // 始终指向最新 autoSkip 闭包（setInterval / 事件监听器通过它调用，避免闭包过期）
  const autoSkipRef = useRef<(reason: "error" | "stall") => void>(() => {});
  // 续播记忆写入节流：timeupdate 高频触发（~4次/秒），最多每 5 秒写一次 localStorage
  const lastResumeSaveRef = useRef(0);
  // DJ 字幕 5 秒自动消失定时器（每次 DJ 念完一句才起 5s 计时；新 DJ 字幕会覆盖并清掉旧 timer）
  const hideDjTimerRef = useRef<number | null>(null);
  // [2026-09-21] 当前绑定在 music 上的源地址 + 绑定时刻
  //   用途一（幂等设源）：重复给 music.src 赋同一个值会触发媒体加载算法 →
  //     中止在途下载并从 0 重来。实测同一首 13MB 被完整下载两遍（20.4MB），
  //     且点击时恰好重设一次，把点击前预缓冲的字节全扔了 → 35 秒才出声。
  //   用途二（看门狗宽限）：刚换源后的缓冲期 currentTime 天然为 0，不该判死播。
  const loadedSrcRef = useRef<string | null>(null);
  const loadedAtRef = useRef(0);

  const getNodes = useCallback((): AudioNodes => {
    if (nodesRef.current) return nodesRef.current;

    const ctx = new AudioContext();

    // ---- 音乐通道 ----
    const music = new Audio();
    music.crossOrigin = "anonymous";
    // preload=metadata（不用 auto）：实测 auto/metadata/none 三种策略的**起播耗时完全一致**
    // （Slow4G 13.3s / 12.9s / 13.1s；不限速 1.9s / 1.4s / 1.4s），因为起播瓶颈是
    // "Chrome 要预读约 60 秒音频"，跟策略无关；但 auto 会在用户还没点播放时就把整首
    // 十几 MB 拉下来（纯浪费用户的流量 + Render 带宽）。改用 metadata 只取标签（几 KB）。
    music.preload = "metadata";
    const musicGain = ctx.createGain();
    musicGain.gain.value = 1.0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;

    // ---- DJ 通道 ----
    const dj = new Audio();
    dj.crossOrigin = "anonymous";
    // DJ 语音是几十 KB 的 TTS 小文件，随用随取即可 —— 不预加载，把带宽全留给音乐
    dj.preload = "none";
    const djGain = ctx.createGain();
    djGain.gain.value = 2.0; // DJ 人声：比 duck 后的音乐(0.18)高出 ~21dB，清晰压过背景

    // ★ 这里**刻意不调** createMediaElementSource / connect —— 全部交给 ensureGraph()。
    //   它只在 ctx 真正 running 时才接线，避免手机无手势时"两个通道一起哑"（详见其注释）。
    //   电脑端 ctx 创建即 running，ensureGraph 会立即接线，行为与旧版逐字一致。

    // 音乐进度事件
    music.addEventListener("timeupdate", () => {
      const st = useRadioStore.getState();
      st.setProgress(music.currentTime);
      // 续播记忆：节流每 5 秒落盘（正在播放的进度），刷新/关闭后重开可续播
      const nowTs = Date.now();
      if (nowTs - lastResumeSaveRef.current > 5000) {
        lastResumeSaveRef.current = nowTs;
        const cur = st.now;
        if (cur?.url) {
          saveResume({
            songmid: String(cur.songmid ?? ""),
            name: cur.name,
            artist: cur.artist,
            url: cur.url,
            progress: music.currentTime,
            duration: Number.isFinite(music.duration) ? music.duration : 0,
            playing: true,
          });
        }
      }
    });
    music.addEventListener("loadedmetadata", () => {
      useRadioStore.getState().setDuration(music.duration);
    });
    music.addEventListener("ended", () => {
      useRadioStore.getState().setIsPlaying(false);
      useRadioStore.getState().setProgress(0);
      // 播完自动切下一首（随机歌单）：过渡语先开口（DJ 不缺席），音乐随后无缝起。
      // [2026-09-07 韧性] skip 偶发失败（网络/后端 5xx）不再静默卡死——2s 后重试一次，
      // 仍失败才提示手动切歌（旧版 catch(() => {}) 会让音乐停在 ended 无声，表现"播完不自动切"）。
      const tryAutoNext = (attempt: number): void => {
        radioApi.skip().then((res) => {
          if (res.song) {
            void loadAndPlay(res.song); // 统一入口：内部 setNow + 写续播记忆
          } else if (attempt < 1) {
            setTimeout(() => tryAutoNext(attempt + 1), 2000);
          }
        }).catch(() => {
          if (attempt < 1) {
            setTimeout(() => tryAutoNext(attempt + 1), 2000);
          } else {
            useRadioStore.getState().setError("自动切歌失败，请手动点下一首");
          }
        });
      };
      tryAutoNext(0);
    });
    // 断流/URL 失效/试听被掐：一律交给 autoSkip 统一处理（滑动窗口限流 + 挂起保护，
    // 不再"8 秒内二次 error 永久放弃"——那会在连续两首坏歌后锁死无声永不恢复）
    music.addEventListener("error", () => {
      autoSkipRef.current("error");
    });
    music.addEventListener("pause", () => {
      useRadioStore.getState().setIsPlaying(false);
      // 用户暂停/切歌：立刻把当前进度落盘（playing:false → 重开恢复位置但不自动响）
      const cur = useRadioStore.getState().now;
      if (cur?.url) {
        saveResume({
          songmid: String(cur.songmid ?? ""),
          name: cur.name,
          artist: cur.artist,
          url: cur.url,
          progress: music.currentTime,
          duration: Number.isFinite(music.duration) ? music.duration : 0,
          playing: false,
        });
      }
    });
    music.addEventListener("play", () => {
      useRadioStore.getState().setIsPlaying(true);
    });

    const nodes: AudioNodes = { ctx, music, musicGain, analyser, dj, djGain, wired: false, djWired: false };
    nodesRef.current = nodes;
    // 电脑端 ctx 创建即 running → 这里立刻接线（duck 与 analyser 波形与旧版无差别）；
    // 手机端此刻还是 suspended → 不接线，等解锁手势后由 unlock()/loadAndPlay() 再调。
    ensureGraph(nodes);

    // 注册音频压制回调（DJ 说话时音乐变小，说完恢复）
    useRadioStore.getState().setDuckCallbacks(
      () => {
        // 音乐音量压到 0.18（≈ -15 dB），0.2 秒淡入。
        // 之前 0.45（-7dB）音乐仍响 → DJ 被盖。
        // 0.18 让 DJ 2.0 gain 干净压过音乐；保留极低背景"音乐未停"的衔接感
        musicGain.gain.setTargetAtTime(0.18, ctx.currentTime, 0.2);
      },
      () => {
        // 恢复用户设定的音量，0.3 秒淡出
        const target = useRadioStore.getState().volume;
        musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.3);
      }
    );

    return nodes;
  }, []);

  // mount 时立即创建 AudioContext 并注册 duck 回调
  useEffect(() => {
    getNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 停止 DJ：暂停 + 清空排队 + 恢复音乐音量
   * （恢复播放/切歌/上一首时丢弃未说完的话术）
   */
  const stopDj = (): void => {
    const nodes = nodesRef.current;
    if (nodes) {
      nodes.dj.pause();
      nodes.dj.src = "";
      useRadioStore.getState().unDuck();
    }
    stopLaughTrack(); // 停止 DJ 的同时掐断罐头笑声（避免切歌后笑声还在响）
    djQueueRef.current = [];
    djPlayingRef.current = false;
    // 用户主动暂停/切歌/换台 → 字幕立即消失（不留 5 秒）
    if (hideDjTimerRef.current !== null) {
      window.clearTimeout(hideDjTimerRef.current);
      hideDjTimerRef.current = null;
    }
    useRadioStore.getState().clearDj();
  };

  /**
   * iOS 音频解锁（必须在用户手势的同步代码里调用，不能等 await）：
   * 1. resume AudioContext（iOS 初始 suspended，若等异步后再 resume 手势栈已断
   *    → 音乐元素"播放中"但 WebAudio 无声——手机端没声音的头号原因）
   * 2. 播一个静音 wav 解锁 media 元素 autoplay（iOS 要求元素曾被手势触发过 play）
   * 3. [2026-09-25] resume 成功后调 ensureGraph() 把两个元素接进 WebAudio
   *    （resume 是异步的，接线放在 .then 里 —— createMediaElementSource 本身不要求手势）
   */
  const unlock = (): void => {
    // fire-and-forget：resume 必须在手势的同步栈里**发起**，但绝不等它兑现（见 tryResume 注释）
    tryResume(getNodes());
    try {
      const silent = new Audio();
      silent.volume = 0;
      silent.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQBAACAgICA";
      silent.play().catch(() => {});
    } catch {
      /* 解锁失败静默，不影响后续 */
    }
  };

  /**
   * 加载并播放一首歌。
   * @param song 歌曲（含可播 URL）
   * @param opts.seekTo 可选：从第几秒开始播（续播记忆恢复用；默认从头 0 秒）
   */
  const loadAndPlay = async (song: NowPlaying, opts?: { seekTo?: number }): Promise<void> => {
    const nodes = getNodes();
    const { music } = nodes;
    const seekTo = opts?.seekTo && Number.isFinite(opts.seekTo) ? Math.max(0, opts.seekTo) : 0;
    useRadioStore.getState().setIsLoading(true);
    try {
      // ★ 不 await：无手势时 iOS 的 resume() 会一直 pending，await 会把整条播放流程
      //   卡到 25 秒超时（表现就是"完全没声音"）。解锁交由 tryResume 后台完成。
      tryResume(nodes);
      // [2026-09-21] 优先用预取好的本地 Blob（COS mp3 无 Cache-Control，HTTP 缓存兜不住）：
      // 命中 → blob: 地址，切歌零网络、零 Range 请求、seek 瞬时；未命中 → 原 COS 直链，行为不变。
      const cachedSrc = getCachedAudioUrl(song.url);
      const targetSrc = cachedSrc ?? song.url;
      // ★ 幂等设源（手机端延迟的头号修复）：
      //   给 music.src 重复赋同一个值 = 重新跑一次媒体加载算法 → **中止在途下载、从 0 重来**。
      //   实测时序：9747ms 已开始下载「十面埋伏」→ 12444ms 点击时又设一次同一个 src
      //   → AbortError → 已缓冲的字节全废 → 27s 时被看门狗误判切歌 → 再废一次
      //   → 34959ms 才出声，30MB 流量只听到一首歌。
      //   只有「真的换歌」「换了源形态（blob ↔ 直链）」「上一次加载出错」才写 src。
      const needNewSrc = !music.src || loadedSrcRef.current !== targetSrc || music.error !== null;
      if (needNewSrc) {
        loadedSrcRef.current = targetSrc;
        loadedAtRef.current = Date.now();
        music.src = targetSrc;
      }
      pinPlayingAudio(cachedSrc ? song.url : undefined); // 正在播的 Blob 不许被淘汰 revoke
      // 播放超时保护：resume()/play() 任一环节卡住（无手势/源站慢/缓冲挂起）
      // [2026-09-21] 6 秒 → 25 秒：13MB 单曲在慢网（实测 Slow 4G）光缓冲就远超 6 秒，
      // 旧值会在歌其实还能播的情况下先报错退出（表现：提示"播放超时"但随后又响了）。
      await Promise.race([
        (async () => {
          tryResume(nodes); // 同上：绝不 await（无手势时 iOS 的 resume 会永久 pending）
          await music.play();
          // play() 成功 = 数据已就绪，此时 seek 到续播点（若接近结尾，会自然触发 ended 切歌）
          if (seekTo > 2) {
            const limit = Number.isFinite(music.duration) && music.duration > seekTo + 3
              ? seekTo
              : Math.max(0, (Number.isFinite(music.duration) ? music.duration : seekTo) - 3);
            music.currentTime = limit;
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("播放超时，请重试")), PLAY_TIMEOUT_MS)
        ),
      ]);
      useRadioStore.getState().setNow(song);
      useRadioStore.getState().setIsPlaying(true);
      useRadioStore.getState().setProgress(seekTo);
      // 续播记忆：切到新歌立即落盘（progress 起点），此后由 timeupdate 节流持续更新
      saveResume({
        songmid: String(song.songmid ?? ""),
        name: song.name,
        artist: song.artist,
        url: song.url,
        progress: seekTo,
        duration: Number.isFinite(music.duration) ? music.duration : 0,
        playing: true,
      });
      bootedRef.current = true; // 成功开播 → 进入"正常播放"阶段（启动阶段不再播 jingle）
    } catch (err) {
      useRadioStore.getState().setError(err instanceof Error ? err.message : "播放失败");
    } finally {
      useRadioStore.getState().setIsLoading(false);
    }
  };

  /**
   * 自动跳歌（error 事件 / 心跳看门狗共用通道）：
   * - 挂起保护：上一次自动跳请求还没返回时不再发起（防并发重叠 skip）
   * - 滑动窗口限流：60 秒内最多自动跳 5 次；超限 = 疑似断网/服务故障 →
   *   暂停自动跳并提示，窗口滑出后自然恢复（不再永久锁死）
   */
  const autoSkip = (reason: "error" | "stall"): void => {
    if (autoSkipPendingRef.current) return; // 上次请求还在路上
    const nowTs = Date.now();
    const recent = autoSkipTimesRef.current.filter((t) => nowTs - t < 60000);
    autoSkipTimesRef.current = recent;
    if (recent.length >= 5) {
      console.warn(`[audio] 60s 内自动跳歌已 ${recent.length} 次仍失败，暂停自动跳（${reason}），30s 后自动恢复`);
      useRadioStore.getState().setError("信号不稳，播放暂时中断——约 30 秒后自动恢复");
      return;
    }
    autoSkipTimesRef.current.push(nowTs);
    autoSkipPendingRef.current = true;
    console.warn(`[audio] 自动跳歌（${reason}）`);
    stopDj();
    useRadioStore.getState().setIsPlaying(false);
    radioApi
      .skip()
      .then((res) => {
        if (res.song) return loadAndPlay(res.song);
        throw new Error("没有可播歌曲");
      })
      .catch(() => {
        useRadioStore.getState().setError("切歌失败，请检查网络后手动切歌");
      })
      .finally(() => {
        autoSkipPendingRef.current = false;
      });
  };
  // 每次渲染更新 ref，确保 interval/事件监听器拿到最新闭包
  autoSkipRef.current = autoSkip;

  // 心跳看门狗：每 3 秒核对播放进度。
  // 背景：VIP 试听流被 CDN 掐断 / URL 失效时，audio 元素往往既不触发 ended
  // 也不触发 error —— 只有 currentTime 悄悄停住（"无声静止"）。事件监听兜不住，
  // 必须主动心跳：播放中但 currentTime 连续 10 秒无推进 → 判定死播 → 自动跳歌。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const nodes = nodesRef.current;
      if (!nodes) return;
      const { music } = nodes;
      const st = useRadioStore.getState();
      // 非播放态 / 正在加载 / 无源 → 重置观测，不判定（避免误伤切歌间隙、缓冲、暂停）
      if (music.paused || music.ended || !music.src || st.isLoading || !st.now?.url) {
        stallRef.current = { lastTime: -1, lastMoveAt: 0, pending: false };
        return;
      }
      const nowTs = Date.now();
      // [2026-09-21] 换源后的缓冲宽限：13MB 的歌在慢网（实测 Slow 4G 约 200KB/s）
      // 完全可能 30 秒还停在 currentTime=0。旧逻辑 10 秒就判"死播"→ autoSkip 切歌，
      // 把已经下到一半的整首丢掉重来，然后新歌再来一遍 —— 手机端"点了半天不出声、
      // 还一直跳歌"的直接成因。宽限期内一律不判定。
      if (nowTs - loadedAtRef.current < STALL_GRACE_MS) {
        stallRef.current = { lastTime: -1, lastMoveAt: 0, pending: false };
        return;
      }
      // readyState < 3 = HAVE_FUTURE_DATA 都没到，说明仍在正常缓冲，不是死播
      const buffering = music.readyState < 3;
      const t = music.currentTime;
      const wd = stallRef.current;
      if (t !== wd.lastTime) {
        // 进度在推进 → 健康
        stallRef.current = { lastTime: t, lastMoveAt: nowTs, pending: false };
        return;
      }
      if (wd.lastMoveAt === 0) {
        stallRef.current = { lastTime: t, lastMoveAt: nowTs, pending: false };
        return;
      }
      // 缓冲中给足 75 秒；缓冲已充足却完全不动，20 秒就判死播（真·URL 失效/被掐流）
      const limit = buffering ? STALL_BUFFERING_MS : STALL_READY_MS;
      if (nowTs - wd.lastMoveAt > limit && !wd.pending) {
        stallRef.current = { ...wd, pending: true };
        autoSkipRef.current("stall");
      }
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlay = async (): Promise<void> => {
    // 恢复播放：丢弃暂停期间没说完的 DJ 话术（不再继续说）
    if (djPausedRef.current) {
      djPausedRef.current = false;
      stopDj();
    }

    const { music, ctx } = getNodes();
    const st = useRadioStore.getState();
    const { now } = st;

    // —— 续播记忆恢复（全新会话：audio 还没设过源，页面刚开/刚刷新）——
    // 用户"暂停/关闭/刷新后重开"时，优先接着上次没放完的那首从原进度继续，
    // 而不是被 getNow 塞进 store 的后端 current 歌顶掉。
    if (!music.src) {
      const resume = loadResume();
      if (resume?.url) {
        console.warn(`[audio] 恢复续播: ${resume.name} @${Math.round(resume.progress)}s`);
        await loadAndPlay(
          { songmid: resume.songmid, name: resume.name, artist: resume.artist, url: resume.url },
          { seekTo: resume.progress }
        );
        return;
      }
    }

    if (!now?.url) {
      try {
        const res = await radioApi.next();
        // [2026-09-07] 过渡音已移除：第一句交给 /api/dj/open 开场白，避免叠加
        if (res.song) await loadAndPlay(res.song);
      } catch (err) {
        useRadioStore.getState().setError(err instanceof Error ? err.message : "拉取失败");
      }
      return;
    }

    // —— 同会话"暂停→再播放"：audio 还停在这首歌 → 直接从暂停位置继续，不重载——
    if (music.paused && !music.ended && music.currentTime > 1) {
      try {
        tryResume(getNodes()); // 不 await：见 tryResume 注释（无手势时 resume 会永久 pending）
        await music.play();
        useRadioStore.getState().setIsPlaying(true);
      } catch {
        await loadAndPlay(now);
      }
      return;
    }
    // 🔧 关键修复：now.url 存在也走 loadAndPlay（先 setSrc 再 play）
    // 否则 music.src 为空时 play() 静默失败 → "音乐不能播放"
    await loadAndPlay(now);
  };

  const handlePause = (): void => {
    const { music, dj } = getNodes();
    music.pause();
    // DJ 语音同步暂停（保留当前进度；恢复播放时丢弃）
    dj.pause();
    djPausedRef.current = true;
  };

  const handleToggle = async (): Promise<void> => {
    const { isPlaying } = useRadioStore.getState();
    if (isPlaying) handlePause();
    else {
      unlock(); // iOS：点播放按钮的手势内同步解锁（暂停久了 AudioContext 会再挂起）
      await handlePlay();
    }
  };

  const handleSkip = async (): Promise<void> => {
    try {
      // 切歌：丢弃所有未说完的 DJ 话术 + 恢复音量
      stopDj();
      // 搞笑音效：30% 概率随机一个（用户手动切歌时）
      if (useRadioStore.getState().sfxEnabled && Math.random() < 0.3) {
        playRandomSfx();
      }
      // [2026-09-07] 固定过渡音已移除；DJ 话术由后端 WS 广播（冷却+模板池）异步下发
      const res = await radioApi.skip();
      if (res.song) await loadAndPlay(res.song);
    } catch (err) {
      useRadioStore.getState().setError(err instanceof Error ? err.message : "切歌失败");
    }
  };

  const handlePrev = async (): Promise<void> => {
    try {
      stopDj();
      const res = await radioApi.prev();
      if (res.song) await loadAndPlay(res.song);
    } catch (err) {
      useRadioStore.getState().setError(err instanceof Error ? err.message : "上一首失败");
    }
  };

  const handleSeek = (delta: number): void => {
    const { music } = getNodes();
    music.currentTime = Math.max(0, Math.min(music.duration || 0, music.currentTime + delta));
  };

  const handleSeekTo = (pct: number): void => {
    const { music } = getNodes();
    music.currentTime = (music.duration || 0) * pct;
  };

  const setPlaybackRate = (rate: number): void => {
    const { music } = getNodes();
    music.playbackRate = rate;
    useRadioStore.getState().setPlaybackRate(rate);
  };

  const setVolume = (v: number): void => {
    const { musicGain } = getNodes();
    musicGain.gain.value = Math.max(0, Math.min(1, v));
    useRadioStore.getState().setVolume(v);
  };

  const getAnalyser = (): AnalyserNode | null => {
    return nodesRef.current?.analyser ?? null;
  };

  /**
   * DJ 语音队列：入队 + 当前正在播的字幕同步
   * 每播完一条才播下一条，字幕永远等于"当前正在播"那条
   * 播完一条 laugh=true 的话术 → 立刻接 sitcom 罐头笑声（笑点后观众笑）
   */
  const playNextDj = async () => {
    const item = djQueueRef.current.shift();
    if (!item) {
      djPlayingRef.current = false;
      const nodes = nodesRef.current;
      if (nodes) {
        nodes.dj.src = "";
        useRadioStore.getState().unDuck();
      }
      return;
    }
    // 字幕同步成"当前正在播"这条
    useRadioStore.getState().setDjBilingual(item.en, item.zh);
    const { dj, ctx } = getNodes();
    // [修复 DJ 重播] HTMLAudioElement 同 URL 重设 src 不会重新 load，
    // 先清空 src + load() 强制重新加载（用户在 onended 后点 ▶ 重放同一段）
    if (dj.src && dj.src !== "" && dj.src.endsWith(item.url.split("/").pop() || "")) {
      try { dj.pause(); } catch { /* noop */ }
      dj.src = "";
      dj.load();
    }
    dj.src = item.url;
    dj.onended = () => {
      // 这条是笑话/怼人 → 观众罐头笑（punchline 后立刻响）
      if (item.laugh) playLaughTrack();
      // DJ 气泡 ▶/⏸ 按钮：播完通知调用方清状态（按钮自动 ⏸ → ▶ 回弹）
      try { item.onEnded?.(); } catch { /* 不让单条回调错毁掉整个播放链 */ }
      // 这条念完 → 起 5s 计时清空字幕；若 5s 内有下一条 DJ 字幕，
      // 下一条的 setDjBilingual 会清掉旧 timer 重建，这里比对 en/zh 避免误清
      if (hideDjTimerRef.current !== null) window.clearTimeout(hideDjTimerRef.current);
      const finishedEn = item.en;
      const finishedZh = item.zh;
      hideDjTimerRef.current = window.setTimeout(() => {
        hideDjTimerRef.current = null;
        const cur = useRadioStore.getState();
        // 仍显示的是同一句 → 才清（防止新 DJ 字幕被本条 timer 误清）
        if (cur.djEn === finishedEn && cur.djZh === finishedZh) {
          cur.clearDj();
        }
      }, 5000);
      playNextDj();
    };

    const tryPlay = async (attempt: number): Promise<void> => {
      try {
        tryResume(getNodes()); // 不 await（同上）：DJ 链路也不能被 resume 卡死
        await dj.play();
      } catch {
        // 播放失败：重试一次（iOS 常见），仍失败才跳下一条
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 300));
          await tryPlay(attempt + 1);
        } else {
          // 播放失败兜底：onended 不会触发，靠这里起 5s 清字幕定时器
          if (hideDjTimerRef.current !== null) window.clearTimeout(hideDjTimerRef.current);
          const finishedEn = item.en;
          const finishedZh = item.zh;
          hideDjTimerRef.current = window.setTimeout(() => {
            hideDjTimerRef.current = null;
            const cur = useRadioStore.getState();
            if (cur.djEn === finishedEn && cur.djZh === finishedZh) cur.clearDj();
          }, 5000);
          playNextDj();
        }
      }
    };
    void tryPlay(0);
  };

  const playDj = async (
    url: string,
    en = "",
    zh = "",
    force = false,
    laugh = false,
    onEnded?: () => void,
  ): Promise<void> => {
    // 去重：同一段语音 5 秒内不重复播放（防双广播/双 skip 导致"同一句说两遍"）
    // force=true 用于手动 ▶ 播放（播放→暂停→再播不该被去重拦截）
    if (!force) {
      const nowTs = Date.now();
      if (lastDjRef.current.url === url && nowTs - lastDjRef.current.at < 5000) {
        return;
      }
      lastDjRef.current = { url, at: nowTs };
    }

    // DJ 走同一套解锁：不 await（无手势时 resume 会永久 pending）；接不上 WebAudio 时
    // dj 元素走默认输出，至少能出声。
    tryResume(getNodes());
    // 音乐暂停期间收到新 DJ 语音（用户切歌/回复触发）：丢弃旧的未说完，直接播新的
    if (djPausedRef.current) {
      djPausedRef.current = false;
      stopDj();
    }
    djQueueRef.current.push({ url, en, zh, laugh, onEnded });
    if (!djPlayingRef.current) {
      djPlayingRef.current = true;
      useRadioStore.getState().duck();
      playNextDj();
    }
  };

  /**
   * [2026-09-25] AudioContext 是否已解锁（running）。
   * 未解锁时 WebAudio 一帧都输出不了 → 手机端表现为「进度条在走但完全无声」。
   * App 用它决定是否显示「轻触开启声音」提示、以及是否挂一次性手势兜底。
   */
  const isUnlocked = (): boolean => {
    const n = nodesRef.current;
    return !!n && n.ctx.state === "running";
  };

  return {
    handlePlay, handlePause, handleToggle, handleSkip, handlePrev,
    handleSeek, handleSeekTo, setPlaybackRate, setVolume,
    getAnalyser, playDj, stopDj, loadAndPlay, unlock, isUnlocked,
  };
}
