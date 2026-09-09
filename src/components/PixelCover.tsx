import { useEffect, useRef, useState } from "react";

interface PixelCoverProps {
  src: string;
  alt: string;
  isPlaying?: boolean;
}

const GRID = 12;          // 12×12 = 144 像素块
const REVEAL_RADIUS = 3;  // 鼠标周围扩散半径
const REVEAL_MS = 150;    // 每格"显影"展开动画时长

/**
 * 封面组件 v3（2026-09-09）—— 桌面 / 触摸双实现，彻底分离、互不牵连。
 *
 * 【为什么重构】此前 PC 与手机共用同一套 12×12 双面 3D DOM 网格
 * （.pixel-grid 144 × .pixel-flipper + preserve-3d + 每格一份 backgroundImage 大图）：
 *   - 移动 GPU：合成层/纹理内存直接爆 → 整页崩溃（60146f1 已把手机降级为整图）
 *   - 桌面 GPU：144 个 3D 合成层 + 大图重复引用，在核显 / 高 DPI / 特定驱动下
 *     同样 GPU 进程 OOM → PC 端崩溃（辛老师本轮复测复现）
 *
 * 【v3 架构】
 *   - 触摸设备（pointer: coarse，手机/平板）：直接渲染单张完整封面 <img>，
 *     零合成层、零解码成本 —— 已是最稳形态，永不回归 3D 网格。
 *   - 桌面（精细指针）：改用【single-canvas 像素显影】—— 整块封面只用
 *     一个 <canvas> 自绘：
 *        初始态 = 12×12 纯色格 + LED 圆点（马赛克）
 *        鼠标扫过 → 该格圆心展开"显影"出原图清晰切片（rAF 驱动，150ms）
 *        点击   → 全格显影 = 完整封面
 *     单 canvas 只有一个合成层 + 一次原图解码，没有 144 层 3D 压力，
 *     无论怎么扫 / 什么显卡都不会再打爆 GPU。视觉语义与原翻正一致
 *     （扫哪儿哪儿清晰、点一下全清晰、切歌回到马赛克）。
 */
export function PixelCover({ src, alt }: PixelCoverProps) {
  const [isCoarse] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false,
  );

  // ============ 触摸端：单张整图（最稳，永不重建 3D 网格） ============
  if (isCoarse) {
    return <img key={src} className="full-cover" src={src} alt={alt} />;
  }

  // ============ 桌面端：single-canvas 像素显影 ============
  // key={src} → 切歌整组件重挂（清显影态 + 触发淡入动画）
  return <PixelRevealCanvas key={src} src={src} alt={alt} />;
}

/** 桌面端单 canvas「像素显影」实现（无任何 DOM 3D 合成层） */
function PixelRevealCanvas({ src, alt }: { src: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOkRef = useRef(false);
  const colorsRef = useRef<string[]>([]); // 144 格平均色（RGB 串）
  const coverRef = useRef<{ sx: number; sy: number; s: number } | null>(null); // 源图居中裁方
  const revealStartRef = useRef<number[]>([]); // 每格显影开始时间戳（undefined = 未显影）
  const pendingRef = useRef<Set<number>>(new Set());
  const lastCellRef = useRef(-1);
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // 加载原图 + 降采样 12×12 平均色（只读像素画底，不依赖 CSS background）
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous"; // COS 允许 CORS → 可取色
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      imgOkRef.current = true;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const s = Math.max(nw, nh);
      coverRef.current = { sx: (nw - s) / 2, sy: (nh - s) / 2, s };
      try {
        const off = document.createElement("canvas");
        off.width = GRID;
        off.height = GRID;
        const octx = off.getContext("2d", { willReadFrequently: true });
        if (octx) {
          octx.imageSmoothingEnabled = false;
          octx.drawImage(img, 0, 0, GRID, GRID);
          const data = octx.getImageData(0, 0, GRID, GRID).data;
          const colors: string[] = [];
          for (let i = 0; i < GRID * GRID; i++) {
            colors.push(`rgb(${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]})`);
          }
          colorsRef.current = colors;
        }
      } catch {
        /* CORS 禁读时退化为深色格，显影仍可工作 */
      }
      ensureLoop();
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  /** 是否有事要画（有未处理悬停 / 有显影动画进行中 / 图还没就绪） */
  const needsMore = (): boolean => {
    if (pendingRef.current.size > 0 || !imgOkRef.current) return true;
    const now = performance.now();
    for (const st of revealStartRef.current) {
      if (st >= 0 && now - st < REVEAL_MS) return true;
    }
    return false;
  };

  const ensureLoop = () => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(loop);
    }
  };

  const draw = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cvs.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const sz = sizeRef.current;
    if (sz.w !== w || sz.h !== h || sz.dpr !== dpr) {
      sizeRef.current = { w, h, dpr };
      cvs.width = Math.round(w * dpr);
      cvs.height = Math.round(h * dpr);
    }
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true; // 显影区放大保持平滑清晰
    ctx.clearRect(0, 0, w, h);

    const img = imgRef.current;
    const cover = coverRef.current;
    const colors = colorsRef.current;
    const now = performance.now();
    const cellW = w / GRID;
    const cellH = h / GRID;
    const reveal = revealStartRef.current;

    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const i = r * GRID + c;
        const x = c * cellW;
        const y = r * cellH;
        const st = reveal[i] ?? -1;
        // 底色格（始终先铺满，防 sub-pixel 缝隙透背景）
        ctx.fillStyle = colors[i] ?? "#0a0a0f";
        ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);
        if (st < 0) {
          // 未显影：中心 LED 圆点
          ctx.fillStyle = "rgba(0,0,0,0.38)";
          ctx.beginPath();
          ctx.arc(x + cellW / 2, y + cellH / 2, Math.min(cellW, cellH) * 0.22, 0, Math.PI * 2);
          ctx.fill();
        } else if (img && cover) {
          // 显影：画源图该格切片；150ms 内以圆心扩散动画淡入
          const t = Math.min(1, (now - st) / REVEAL_MS);
          const tileS = cover.s / GRID;
          const sx = cover.sx + c * tileS;
          const sy = cover.sy + r * tileS;
          if (t >= 1) {
            ctx.drawImage(img, sx, sy, tileS, tileS, x, y, cellW + 0.5, cellH + 0.5);
          } else {
            ctx.save();
            ctx.beginPath();
            const rad = Math.max(cellW, cellH) * 0.8 * (1 - Math.pow(1 - t, 3));
            ctx.arc(x + cellW / 2, y + cellH / 2, rad, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, sx, sy, tileS, tileS, x, y, cellW + 0.5, cellH + 0.5);
            ctx.restore();
          }
        }
      }
    }
  };

  const loop = () => {
    rafRef.current = 0;
    // flush 悬停待显影格
    if (pendingRef.current.size > 0) {
      const now = performance.now();
      pendingRef.current.forEach((i) => {
        if ((revealStartRef.current[i] ?? -1) < 0) revealStartRef.current[i] = now;
      });
      pendingRef.current.clear();
    }
    draw();
    if (needsMore()) ensureLoop();
  };

  useEffect(() => {
    ensureLoop();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): { r: number; c: number; i: number } | null => {
    const cvs = canvasRef.current;
    if (!cvs) return null;
    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.max(0, Math.min(GRID - 1, Math.floor((x / rect.width) * GRID)));
    const r = Math.max(0, Math.min(GRID - 1, Math.floor((y / rect.height) * GRID)));
    return { r, c, i: r * GRID + c };
  };

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = cellFromEvent(e);
    if (!hit) return;
    if (hit.i === lastCellRef.current) return;
    lastCellRef.current = hit.i;
    // 曼哈顿半径扩散
    for (let dr = -REVEAL_RADIUS; dr <= REVEAL_RADIUS; dr++) {
      for (let dc = -REVEAL_RADIUS; dc <= REVEAL_RADIUS; dc++) {
        const r = hit.r + dr;
        const c = hit.c + dc;
        if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue;
        if (Math.abs(dr) + Math.abs(dc) > REVEAL_RADIUS) continue;
        pendingRef.current.add(r * GRID + c);
      }
    }
    ensureLoop();
  };

  const handleClick = () => {
    // 点击：全格显影 = 完整封面
    const now = performance.now();
    for (let i = 0; i < GRID * GRID; i++) {
      if ((revealStartRef.current[i] ?? -1) < 0) revealStartRef.current[i] = now;
    }
    lastCellRef.current = -1;
    ensureLoop();
  };

  const handleLeave = () => {
    lastCellRef.current = -1;
  };

  return (
    <canvas
      ref={canvasRef}
      className="pixel-canvas"
      role="img"
      aria-label={alt}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    />
  );
}
