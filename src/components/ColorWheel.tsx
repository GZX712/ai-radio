import { useCallback, useMemo } from "react";
import type { HSL } from "@/store/useRadioStore";

/**
 * 紧凑型色轮组件：
 *   左 = 圆环（conic-gradient 7 段色相），鼠标拖拽选 H（角度）
 *   右 = SL 矩形（基于当前 H 的 S 横轴 + L 纵轴渐变），鼠标拖拽选 S/L
 *
 * Props:
 *   value:   当前 HSL
 *   onChange(patch): 任意字段变化，统一向上抛 { h?, s?, l? }
 *   size:    圆环外径（默认 56px，矩形跟它联动）
 */
export interface ColorWheelProps {
  value: HSL;
  onChange: (patch: Partial<HSL>) => void;
  size?: number;
}

export function ColorWheel({ value, onChange, size = 56 }: ColorWheelProps) {
  const ringThickness = Math.max(8, Math.round(size * 0.18));
  const radius = size / 2;
  const innerRadius = radius - ringThickness - 2;
  const slSize = Math.round(size * 0.6);

  // —— 计算指示点 ——
  const hueAngle = (value.h * Math.PI) / 180;
  const hueIndX = radius + innerRadius * Math.cos(hueAngle);
  const hueIndY = radius + innerRadius * Math.sin(hueAngle);
  const slIndX = (value.s / 100) * slSize;
  const slIndY = (1 - value.l / 100) * slSize;

  // SL 矩形：在当前 H 上"白 → 纯色 → 黑"的渐变
  const slBgImage = useMemo(
    () =>
      `linear-gradient(to right, hsl(${value.h}, 0%, 50%), hsl(${value.h}, 100%, 50%)),
       linear-gradient(to top, #000, rgba(0,0,0,0))`,
    [value.h]
  );

  // —— 交互：以相对 ref 计算 ——
  const handlePointer = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      kind: "hue" | "sl"
    ) => {
      const el = e.currentTarget;
      // 用同一个 ref 的 getBoundingClientRect（更稳）
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      const apply = (cx: number, cy: number) => {
        if (kind === "hue") {
          const dx = cx - rect.left - rect.width / 2;
          const dy = cy - rect.top - rect.height / 2;
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (angle < 0) angle += 360;
          onChange({ h: Math.round(angle) });
        } else {
          const x = Math.max(0, Math.min(rect.width, cx - rect.left));
          const y = Math.max(0, Math.min(rect.height, cy - rect.top));
          const s = Math.round((x / rect.width) * 100);
          const l = Math.round((1 - y / rect.height) * 100);
          onChange({ s, l });
        }
      };
      apply(e.clientX, e.clientY);
      const onMove = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [onChange]
  );

  return (
    <div className="cw-pair" role="group" aria-label="颜色选择器">
      {/* 色相环 */}
      <div
        className="cw-hue"
        style={{ width: size, height: size }}
        onPointerDown={(e) => handlePointer(e, "hue")}
        role="slider"
        aria-label="色相"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={value.h}
        tabIndex={0}
      >
        <div
          className="cw-hue-indicator"
          style={{
            left: hueIndX,
            top: hueIndY,
            background: `hsl(${value.h} 100% 50%)`,
            borderColor: "rgba(255,255,255,0.9)",
          }}
        />
      </div>

      {/* SL 矩形 */}
      <div
        className="cw-sl"
        style={{
          width: slSize,
          height: slSize,
          backgroundImage: slBgImage,
        }}
        onPointerDown={(e) => handlePointer(e, "sl")}
        role="slider"
        aria-label="饱和度 / 亮度"
        tabIndex={0}
      >
        <div
          className="cw-sl-indicator"
          style={{
            left: slIndX,
            top: slIndY,
            background: `hsl(${value.h}, ${value.s}%, ${value.l}%)`,
          }}
        />
      </div>
    </div>
  );
}
