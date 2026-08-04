import { useEffect, useRef } from "react";

interface ParticleFieldProps {
  count?: number;
}

/**
 * 桌面端装饰：漂浮的 2px 像素粒子
 * 移动端 CSS @media 自动隐藏
 */
export function ParticleField({ count = 12 }: ParticleFieldProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 尊重 prefers-reduced-motion
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      el.style.display = "none";
      return;
    }

    // 仅桌面端渲染
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      el.style.display = "none";
      return;
    }

    el.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "particle";
      p.style.left = `${Math.random() * 100}%`;
      p.style.top = `${100 + Math.random() * 20}%`;
      const duration = 15 + Math.random() * 25;
      const delay = -Math.random() * duration;
      p.style.animationDuration = `${duration}s`;
      p.style.animationDelay = `${delay}s`;
      el.appendChild(p);
    }
  }, [count]);

  return <div ref={ref} className="particle-field" aria-hidden="true" />;
}