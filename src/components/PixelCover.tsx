import { useEffect, useRef, useState } from "react";

interface PixelCoverProps {
  src: string;
  alt: string;
  isPlaying?: boolean;
}

const GRID = 12;          // 12×12 = 144 像素块
const REVEAL_RADIUS = 3;  // 鼠标周围扩散半径

/**
 * 像素翻转变形封面（双面 3D）：
 * - 背面（初始朝上）：该区域主色的像素色块 → 显示为 12×12 马赛克像素点
 * - 正面（翻正后朝上）：原图清晰切片 → 拼合成完整封面
 * - mousemove：从鼠标位置向半径 3 扩散翻转（方块一个个翻正，图像逐渐清晰）
 * - click：全部方块一次翻正
 * - 切歌：重置回像素点状态
 *
 * 实现：加载原图 → Canvas 降采样到 12×12 → getImageData 取每格平均色作为背面色；
 * 每块 div 含双面（face-front 原图切片 / face-back 纯色），rotateY 3D 翻转切换。
 */
export function PixelCover({ src, alt }: PixelCoverProps) {
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [pixelColors, setPixelColors] = useState<string[]>([]);
  const lastCellRef = useRef<number>(-1);
  const rafRef = useRef<number>(0);
  const pendingRevealRef = useRef<Set<number>>(new Set());

  // 切歌：清空已翻转 + 像素色，重新加载
  useEffect(() => {
    setRevealed(new Set());
    setPixelColors([]);
    lastCellRef.current = -1;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      // 降采样到 GRID×GRID，取每格平均色（关闭平滑 → 硬像素）
      const off = document.createElement("canvas");
      off.width = GRID;
      off.height = GRID;
      const ctx = off.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, GRID, GRID);
      const data = ctx.getImageData(0, 0, GRID, GRID).data;
      const colors: string[] = [];
      for (let i = 0; i < GRID * GRID; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        colors.push(`rgb(${r},${g},${b})`);
      }
      if (!cancelled) setPixelColors(colors);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  // rAF 批量提交 mousemove 待翻集合
  // [防频闪] prev 已是 super set 时直接 return prev → React 跳过组件更新
  // 不加这个：鼠标 hover cover 时每 16ms setRevealed 都返回新 Set 实例，
  // React 判为变化 → 每帧 re-render 144 个 cell → paint thrashing 频闪
  useEffect(() => {
    const flush = () => {
      if (pendingRevealRef.current.size === 0) return;
      const toAdd: number[] = [];
      pendingRevealRef.current.forEach((i) => toAdd.push(i));
      pendingRevealRef.current.clear();
      setRevealed((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const i of toAdd) {
          if (!next.has(i)) {
            next.add(i);
            changed = true;
          }
        }
        return changed ? next : prev; // prev 直接回归，React 跳过整个子树 reconcile
      });
    };
    const loop = () => {
      flush();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleClick = () => {
    // 点击：全部翻正（一次拼合完整封面）
    const all = new Set<number>();
    for (let i = 0; i < GRID * GRID; i++) all.add(i);
    setRevealed(all);
    lastCellRef.current = -1;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.max(0, Math.min(GRID - 1, Math.floor((x / rect.width) * GRID)));
    const row = Math.max(0, Math.min(GRID - 1, Math.floor((y / rect.height) * GRID)));
    const centerIdx = row * GRID + col;
    if (centerIdx === lastCellRef.current) return;
    lastCellRef.current = centerIdx;

    // 圆形扩散：半径 REVEAL_RADIUS（曼哈顿距离）
    for (let dr = -REVEAL_RADIUS; dr <= REVEAL_RADIUS; dr++) {
      for (let dc = -REVEAL_RADIUS; dc <= REVEAL_RADIUS; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue;
        if (Math.abs(dr) + Math.abs(dc) > REVEAL_RADIUS) continue;
        pendingRevealRef.current.add(r * GRID + c);
      }
    }
  };

  const handleMouseLeave = () => {
    lastCellRef.current = -1;
  };

  // 渲染双面方块
  const cells = [];
  const loading = pixelColors.length === 0;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const i = row * GRID + col;
      const posX = (col / (GRID - 1)) * 100;
      const posY = (row / (GRID - 1)) * 100;
      cells.push(
        <div key={i} className="pixel-cell">
          {/* 关键：3D 旋转放在 .pixel-flipper 子层，.pixel-cell 自己做 2D layout，
              .pixel-flipper 用 inset: -2px 覆盖相邻 cell 间隙（GPU compositing
              在 Retina 上会产生 1px gap，这里靠 -2px 让相邻 flipper overlap 4px
              彻底盖住）。flipper 内部 preserve-3d 保留 3D 翻转动效。 */}
          <div className={`pixel-flipper ${revealed.has(i) ? "revealed" : ""}`}>
            {/* 背面：圆形 LED 像素点（初始朝上 = 马赛克圆点阵） */}
            <div
              className="face face-back"
              style={{ background: loading ? "#0a0a0f" : pixelColors[i] }}
            >
              <span className="dot" />
            </div>
            {/* 正面：原图清晰切片（翻正后朝上 = 完整无缝封面） */}
            <div
              className="face face-front"
              style={{
                backgroundImage: `url(${src})`,
                backgroundSize: `${GRID * 100}% ${GRID * 100}%`,
                backgroundPosition: `${posX}% ${posY}%`,
                backgroundRepeat: "no-repeat",
              }}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <div
      key={src}
      className="pixel-grid"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="img"
      aria-label={alt}
    >
      {cells}
    </div>
  );
}