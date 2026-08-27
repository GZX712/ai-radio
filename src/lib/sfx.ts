/**
 * 搞笑音效库 — 纯 Web Audio API 合成，零素材、零带宽
 * ------------------------------------------------------------------
 * 8 种经典喜剧音效，全部用 OscillatorNode + GainNode 包络实时合成：
 *   wah    —— "哎呀失败了" 滑音（悲伤小号）
 *   boing  —— 卡通弹簧弹跳
 *   drum   —— ba-dum-tss 鼓点（冷笑话专用）
 *   slide  —— 长号滑稽下滑音
 *   buzz   —— 电击嗡嗡（被雷劈）
 *   pop    —— 泡泡破裂
 *   giggle —— 咯咯笑（合成高频笑）
 *   siren  —— 喜剧迷你警笛
 *
 * 音量控制在 0.18 左右，不盖过音乐；共享单例 AudioContext。
 */

type SfxName = "wah" | "boing" | "drum" | "slide" | "buzz" | "pop" | "giggle" | "siren";

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    sharedCtx = new AC();
  }
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/** 基础音头：一个振荡器 + 音量包络 */
function tone(
  ctx: AudioContext,
  opts: {
    freq: number;
    endFreq?: number;
    dur: number;
    type?: OscillatorType;
    vol?: number;
    delay?: number;
    vibrato?: number; // Hz 颤音速率（0 = 无）
    vibratoDepth?: number; // 颤音深度（Hz）
  }
): void {
  const {
    freq,
    endFreq,
    dur,
    type = "sine",
    vol = 0.18,
    delay = 0,
    vibrato = 0,
    vibratoDepth = 0,
  } = opts;
  const t0 = ctx.currentTime + delay;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain).connect(ctx.destination);

  if (vibrato > 0) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vibrato;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = vibratoDepth;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
  }

  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 噪声爆破（鼓点镲片 / 泡泡用） */
function noiseBurst(ctx: AudioContext, opts: { dur: number; vol?: number; delay?: number; lowpass?: number }): void {
  const { dur, vol = 0.12, delay = 0, lowpass = 6000 } = opts;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

const FNS: Record<SfxName, (ctx: AudioContext) => void> = {
  // "哎呀" 滑音：两个下坠正弦，第二个音高更低，戏剧性失败感
  wah(ctx) {
    tone(ctx, { freq: 420, endFreq: 210, dur: 0.22, type: "sawtooth", vol: 0.14 });
    tone(ctx, { freq: 380, endFreq: 150, dur: 0.3, type: "sawtooth", vol: 0.14, delay: 0.16 });
  },
  // 卡通弹簧：正弦快速上下弹跳 + 指数衰减
  boing(ctx) {
    tone(ctx, { freq: 160, dur: 0.55, type: "sine", vol: 0.2, vibrato: 22, vibratoDepth: 120 });
  },
  // ba-dum-tss：两声低鼓 + 镲片噪声
  drum(ctx) {
    tone(ctx, { freq: 160, endFreq: 55, dur: 0.12, type: "sine", vol: 0.26 });
    tone(ctx, { freq: 150, endFreq: 50, dur: 0.12, type: "sine", vol: 0.26, delay: 0.16 });
    noiseBurst(ctx, { dur: 0.3, vol: 0.1, delay: 0.32, lowpass: 7000 });
  },
  // 长号下滑：锯齿波 280→90，带轻微颤音，喜感十足
  slide(ctx) {
    tone(ctx, { freq: 300, endFreq: 85, dur: 0.5, type: "sawtooth", vol: 0.16, vibrato: 6, vibratoDepth: 8 });
  },
  // 电击嗡嗡：高频方波快速颤音 + 短促
  buzz(ctx) {
    tone(ctx, { freq: 900, endFreq: 120, dur: 0.18, type: "square", vol: 0.12, vibrato: 40, vibratoDepth: 300 });
    tone(ctx, { freq: 700, endFreq: 100, dur: 0.14, type: "square", vol: 0.1, delay: 0.02 });
  },
  // 泡泡破裂：短正弦 + 高频噪声爆点
  pop(ctx) {
    tone(ctx, { freq: 700, endFreq: 60, dur: 0.09, type: "sine", vol: 0.2 });
    noiseBurst(ctx, { dur: 0.05, vol: 0.08, delay: 0.05, lowpass: 9000 });
  },
  // 咯咯笑：6 个短促 "ha" 脉冲，音高轻微起伏，一听就在笑
  giggle(ctx) {
    for (let i = 0; i < 6; i++) {
      const rising = i % 2 === 0;
      const base = 480 + i * 25;
      tone(ctx, {
        freq: rising ? base : base - 40,
        endFreq: rising ? base + 60 : base + 20,
        dur: 0.07,
        type: "square",
        vol: 0.1,
        delay: i * 0.085,
      });
    }
  },
  // 喜剧警笛：两个正弦交替升降（wee-oo-wee-oo）
  siren(ctx) {
    tone(ctx, { freq: 520, endFreq: 620, dur: 0.22, type: "sine", vol: 0.14 });
    tone(ctx, { freq: 620, endFreq: 520, dur: 0.22, type: "sine", vol: 0.14, delay: 0.22 });
    tone(ctx, { freq: 520, endFreq: 620, dur: 0.2, type: "sine", vol: 0.12, delay: 0.44 });
  },
};

const ALL: SfxName[] = ["wah", "boing", "drum", "slide", "buzz", "pop", "giggle", "siren"];

/** 播放指定音效（开关关闭或音频不可用时静默跳过） */
export function playSfx(name: SfxName): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    FNS[name]?.(ctx);
  } catch {
    /* 合成失败静默忽略，不影响主流程 */
  }
}

/** 随机播放一个搞笑音效 */
export function playRandomSfx(): void {
  playSfx(ALL[Math.floor(Math.random() * ALL.length)]);
}

/** 登场专用：挑一个"亮相"感强的音效 */
export function playEntranceSfx(): void {
  const picks: SfxName[] = ["boing", "siren", "drum"];
  playSfx(picks[Math.floor(Math.random() * picks.length)]);
}

export type { SfxName };
