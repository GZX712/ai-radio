import { useRef, useCallback, useEffect } from "react";
import { useRadioStore } from "@/store/useRadioStore";
import { radioApi } from "@/lib/api";
import { playRandomSfx } from "@/lib/sfx";
import type { NowPlaying } from "@/types";

interface AudioNodes {
  ctx: AudioContext;
  // 音乐通道
  music: HTMLAudioElement;
  musicGain: GainNode;
  analyser: AnalyserNode;
  // DJ 通道（独立 MediaElementSource，与音乐在 WebAudio 内混音，避免 iOS 音频抢占）
  dj: HTMLAudioElement;
  djGain: GainNode;
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
  type DjItem = { url: string; en: string; zh: string };
  const djQueueRef = useRef<DjItem[]>([]);
  const djPlayingRef = useRef(false);
  // 音乐暂停时 DJ 同步暂停；恢复播放时丢弃未说完的（用户明确要求）
  const djPausedRef = useRef(false);
  // 最近播放的 DJ 语音（去重：防双广播/双 skip 导致"同一句说两遍"）
  const lastDjRef = useRef<{ url: string; at: number }>({ url: "", at: 0 });

  const getNodes = useCallback((): AudioNodes => {
    if (nodesRef.current) return nodesRef.current;

    const ctx = new AudioContext();

    // ---- 音乐通道 ----
    const music = new Audio();
    music.crossOrigin = "anonymous";
    const musicSrc = ctx.createMediaElementSource(music);
    const musicGain = ctx.createGain();
    musicGain.gain.value = 1.0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;
    musicSrc.connect(musicGain).connect(analyser).connect(ctx.destination);

    // ---- DJ 通道 ----
    const dj = new Audio();
    dj.crossOrigin = "anonymous";
    const djSrc = ctx.createMediaElementSource(dj);
    const djGain = ctx.createGain();
    djGain.gain.value = 1.6; // DJ 人声增强，盖过音乐
    djSrc.connect(djGain).connect(ctx.destination);

    // 音乐进度事件
    music.addEventListener("timeupdate", () => {
      useRadioStore.getState().setProgress(music.currentTime);
    });
    music.addEventListener("loadedmetadata", () => {
      useRadioStore.getState().setDuration(music.duration);
    });
    music.addEventListener("ended", () => {
      useRadioStore.getState().setIsPlaying(false);
      useRadioStore.getState().setProgress(0);
      // 播完自动切下一首（随机歌单）：过渡语先开口（DJ 不缺席），音乐随后无缝起
      radioApi.skip().then((res) => {
        if (res.transition) {
          playDj(res.transition.url, res.transition.en, res.transition.zh, true);
        }
        if (res.song) {
          music.src = res.song.url;
          music.play().catch(() => {});
          useRadioStore.getState().setNow(res.song);
        }
      }).catch(() => {});
    });
    music.addEventListener("pause", () => {
      useRadioStore.getState().setIsPlaying(false);
    });
    music.addEventListener("play", () => {
      useRadioStore.getState().setIsPlaying(true);
    });

    const nodes: AudioNodes = { ctx, music, musicGain, analyser, dj, djGain };
    nodesRef.current = nodes;

    // 注册音频压制回调（DJ 说话时音乐变小，说完恢复）
    useRadioStore.getState().setDuckCallbacks(
      () => {
        // 音乐音量压到 45%，0.3 秒淡入（保留垫底，避免"音乐停了"的错觉）
        musicGain.gain.setTargetAtTime(0.45, ctx.currentTime, 0.3);
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
    djQueueRef.current = [];
    djPlayingRef.current = false;
  };

  /**
   * iOS 音频解锁（必须在用户手势的同步代码里调用，不能等 await）：
   * 1. resume AudioContext（iOS 初始 suspended，若等异步后再 resume 手势栈已断
   *    → 音乐元素"播放中"但 WebAudio 无声——手机端没声音的头号原因）
   * 2. 播一个静音 wav 解锁 media 元素 autoplay（iOS 要求元素曾被手势触发过 play）
   */
  const unlock = (): void => {
    const { ctx } = getNodes();
    if (ctx.state === "suspended") void ctx.resume();
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

  const loadAndPlay = async (song: NowPlaying): Promise<void> => {
    const { music, ctx } = getNodes();
    useRadioStore.getState().setIsLoading(true);
    try {
      if (ctx.state === "suspended") await ctx.resume();
      music.src = song.url;
      // 播放超时保护：resume()/play() 任一环节卡住（无手势/源站慢/缓冲挂起）
      // 6 秒内必须完成，否则报错退出（避免 isLoading 卡死、按钮一直 "..." 毫无反馈）
      await Promise.race([
        (async () => {
          if (ctx.state === "suspended") await ctx.resume();
          await music.play();
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("播放超时，请重试")), 6000)
        ),
      ]);
      useRadioStore.getState().setNow(song);
      useRadioStore.getState().setIsPlaying(true);
      useRadioStore.getState().setProgress(0);
    } catch (err) {
      useRadioStore.getState().setError(err instanceof Error ? err.message : "播放失败");
    } finally {
      useRadioStore.getState().setIsLoading(false);
    }
  };

  const handlePlay = async (): Promise<void> => {
    // 恢复播放：丢弃暂停期间没说完的 DJ 话术（不再继续说）
    if (djPausedRef.current) {
      djPausedRef.current = false;
      stopDj();
    }

    const { now } = useRadioStore.getState();
    if (!now?.url) {
      try {
        const res = await radioApi.next();
        if (res.transition) playDj(res.transition.url, res.transition.en, res.transition.zh, true);
        if (res.song) await loadAndPlay(res.song);
      } catch (err) {
        useRadioStore.getState().setError(err instanceof Error ? err.message : "拉取失败");
      }
    } else {
      // 🔧 关键修复：now.url 存在也走 loadAndPlay（先 setSrc 再 play）
      // 否则 music.src 为空时 play() 静默失败 → "音乐不能播放"
      await loadAndPlay(now);
    }
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
      // 过渡语先开口（预生成音频秒播，DJ 不缺席），音乐随后无缝起；
      // 详细介绍（LLM+TTS）到了自动排队接上
      const res = await radioApi.skip();
      if (res.transition) playDj(res.transition.url, res.transition.en, res.transition.zh, true);
      if (res.song) await loadAndPlay(res.song);
    } catch (err) {
      useRadioStore.getState().setError(err instanceof Error ? err.message : "切歌失败");
    }
  };

  const handlePrev = async (): Promise<void> => {
    try {
      stopDj();
      const res = await radioApi.prev();
      if (res.transition) playDj(res.transition.url, res.transition.en, res.transition.zh, true);
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
    dj.src = item.url;
    dj.onended = () => playNextDj();

    const tryPlay = async (attempt: number): Promise<void> => {
      try {
        if (ctx.state === "suspended") await ctx.resume();
        await dj.play();
      } catch {
        // 播放失败：重试一次（iOS 常见），仍失败才跳下一条
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 300));
          await tryPlay(attempt + 1);
        } else {
          playNextDj();
        }
      }
    };
    void tryPlay(0);
  };

  const playDj = async (url: string, en = "", zh = "", force = false): Promise<void> => {
    // 去重：同一段语音 5 秒内不重复播放（防双广播/双 skip 导致"同一句说两遍"）
    // force=true 用于手动 ▶ 播放（播放→暂停→再播不该被去重拦截）
    if (!force) {
      const nowTs = Date.now();
      if (lastDjRef.current.url === url && nowTs - lastDjRef.current.at < 5000) {
        return;
      }
      lastDjRef.current = { url, at: nowTs };
    }

    const { ctx } = getNodes();
    if (ctx.state === "suspended") await ctx.resume();
    // 音乐暂停期间收到新 DJ 语音（用户切歌/回复触发）：丢弃旧的未说完，直接播新的
    if (djPausedRef.current) {
      djPausedRef.current = false;
      stopDj();
    }
    djQueueRef.current.push({ url, en, zh });
    if (!djPlayingRef.current) {
      djPlayingRef.current = true;
      useRadioStore.getState().duck();
      playNextDj();
    }
  };

  return {
    handlePlay, handlePause, handleToggle, handleSkip, handlePrev,
    handleSeek, handleSeekTo, setPlaybackRate, setVolume,
    getAnalyser, playDj, stopDj, loadAndPlay, unlock,
  };
}
