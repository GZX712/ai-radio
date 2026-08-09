import { useEffect, useRef } from "react";

/**
 * 桌面端装饰：右下角极简数字雨（3-5 列）
 * 移动端 CSS @media 自动隐藏
 */
export function DigitRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // 尊重 prefers-reduced-motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      canvas.style.display = "none";
      return;
    }
    if (window.innerWidth < 768) {
      canvas.style.display = "none";
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 180;
    const H = 280;
    canvas.width = W;
    canvas.height = H;

    const fontSize = 12;
    const columns = 5;
    const drops: number[] = Array.from({ length: columns }, () => Math.random() * H);
    const chars = "0123456789ABCDEF#@%&";

    let raf = 0;
    let last = 0;
    const interval = 1000 / 15; // 15fps 节流

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (now - last < interval) return;
      last = now;

      // 浅灰半透不涂背景（避免右上/右下出现实心色块）
      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "rgba(222, 222, 222, 0.85)"; // 柔灰银主调（取代青色）
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
      ctx.shadowColor = "rgba(222, 222, 222, 0.6)";
      ctx.shadowBlur = 4;

      for (let i = 0; i < columns; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const x = i * (W / columns) + 4;
        const y = drops[i];
        ctx.fillText(ch, x, y);

        if (y > H && Math.random() > 0.975) drops[i] = 0;
        drops[i] += fontSize;
      }
    };
    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="digit-rain" aria-hidden="true" />;
}