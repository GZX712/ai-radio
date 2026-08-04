import { useEffect, useRef } from "react";

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

const BAR_COUNT_DESKTOP = 40;
const BAR_COUNT_MOBILE = 24;
const CANVAS_W = 320;
const CANVAS_H = 96;
const CELL = 5;
const GAP = 2;

/**
 * 频谱可视化：LED 像素点阵（参考图配色：冷紫白 + 紫色峰值，发光感）
 * 每个像素点是独立的小方块（点间 2px 间隙），跳动时一格一格亮灭
 * 桌面 60fps，移动端 30fps 节流
 */
export function Visualizer({ analyser, isPlaying }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!analyser) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const barCount = isMobile ? BAR_COUNT_MOBILE : BAR_COUNT_DESKTOP;
    const colWidth = CELL + GAP;
    const targetFps = isMobile ? 30 : 60;
    const frameInterval = 1000 / targetFps;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    ctx.scale(dpr, dpr);

    const dataArr = new Uint8Array(analyser.frequencyBinCount);
    let lastFrameTime = 0;

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);

      if (now - lastFrameTime < frameInterval) return;
      lastFrameTime = now;

      if (document.hidden) return;

      analyser.getByteFrequencyData(dataArr);

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      const step = Math.floor(dataArr.length / barCount);
      const xOffset = Math.floor((CANVAS_W - barCount * colWidth) / 2);
      const maxPoints = Math.floor((CANVAS_H - GAP) / (CELL + GAP));

      // 缓存列内当前振幅（上帧），用于颜色过渡
      const ampArr = new Array(barCount).fill(0);

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArr[i * step + j];
        const amp = sum / (step * 255);
        const targetPoints = Math.round(amp * maxPoints * (isPlaying ? 1 : 0.25));
        const points = Math.max(1, targetPoints);
        ampArr[i] = amp;
        const x = xOffset + i * colWidth;

        for (let p = 0; p < points; p++) {
          const by = CANVAS_H - (p + 1) * CELL - p * GAP - GAP;
          const ratio = p / Math.max(1, maxPoints);

          // 参考图配色：底部冷紫白 → 中段纯白 → 顶部紫色峰值
          let color: string;
          let blur: number;
          if (ratio > 0.78) {
            // 峰值：紫色发光
            color = "#9d00ff";
            blur = 6;
          } else if (ratio > 0.55) {
            // 中段：纯白发光
            color = "#ffffff";
            blur = 4;
          } else if (ratio > 0.3) {
            // 中下：浅紫白（带 alpha）
            color = "rgba(196, 181, 253, 0.85)";
            blur = 2;
          } else {
            // 底部：淡蓝紫（最冷，最透）
            color = "rgba(168, 154, 220, 0.6)";
            blur = 0;
          }

          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = blur;
          ctx.fillStyle = color;
          ctx.fillRect(x, by, CELL, CELL);
          ctx.restore();
        }
      }

      // 顶部随机散点（紫色发光）—— 增强律动感（参考图左右两端有孤立紫色点）
      for (let i = 0; i < barCount; i++) {
        const amp = ampArr[i];
        if (amp < 0.3 || amp > 0.9) continue; // 中段才会散点
        // 20% 概率画一个紫色独立点
        if (Math.random() > 0.2) continue;
        const x = xOffset + i * colWidth;
        // 在列顶部 1/3 区域随机位置
        const pFloat = Math.random() * maxPoints * 0.4 + maxPoints * 0.2;
        const by = CANVAS_H - Math.round(pFloat) * CELL - Math.floor(pFloat) * GAP - GAP;
        ctx.save();
        ctx.shadowColor = "#c4b5fd";
        ctx.shadowBlur = 8;
        ctx.fillStyle = "rgba(196, 181, 253, 0.7)";
        ctx.fillRect(x, by, CELL, CELL);
        ctx.restore();
      }
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      className="visualizer"
      style={{ width: CANVAS_W, height: CANVAS_H }}
      aria-hidden="true"
    />
  );
}