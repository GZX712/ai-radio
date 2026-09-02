import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  WALLPAPERS,
  CUSTOM_TOKEN_LIST,
  DEFAULT_CUSTOM,
  type CustomColors,
  type CustomTokenPatch,
  type WallpaperId,
} from "@/store/useRadioStore";
import { ColorWheel } from "./ColorWheel";

interface WallpaperPickerProps {
  current: WallpaperId;
  custom: CustomColors;
  onPick: (id: WallpaperId) => void;
  /** 旧式 onCustom(hsl 单点 patch) → 新式 onCustom(token => hsl patch)，传空对象表示全部 token */
  onCustom: (patch: CustomTokenPatch) => void;
  onClose: () => void;
}

/**
 * 6 套主题预设 palette（用于"一键套"按钮，给设计器一个快速起点）。
 * bg token 决定主基调；其他 6 个 token 在 preset 中按主色 + 补色 + 黑白色阶派生。
 */
const PRESET_PALETTES: { label: string; colors: CustomColors }[] = [
  {
    label: "紫青",
    colors: {
      bg:         { h: 265, s: 70,  l: 8  },
      surface:    { h: 265, s: 55,  l: 14 },
      surfaceAlt: { h: 265, s: 45,  l: 10 },
      text:       { h: 240, s: 20,  l: 92 },
      textSoft:   { h: 240, s: 15,  l: 78 },
      accent:     { h: 195, s: 100, l: 50 },
      border:     { h: 265, s: 50,  l: 22 },
    },
  },
  {
    label: "桃红",
    colors: {
      bg:         { h: 335, s: 70,  l: 10 },
      surface:    { h: 335, s: 55,  l: 16 },
      surfaceAlt: { h: 335, s: 45,  l: 12 },
      text:       { h: 340, s: 25,  l: 95 },
      textSoft:   { h: 340, s: 18,  l: 80 },
      accent:     { h: 25,  s: 95,  l: 58 },
      border:     { h: 335, s: 50,  l: 24 },
    },
  },
  {
    label: "海蓝",
    colors: {
      bg:         { h: 210, s: 65,  l: 8  },
      surface:    { h: 210, s: 50,  l: 14 },
      surfaceAlt: { h: 210, s: 40,  l: 10 },
      text:       { h: 200, s: 20,  l: 94 },
      textSoft:   { h: 200, s: 15,  l: 80 },
      accent:     { h: 175, s: 100, l: 55 },
      border:     { h: 210, s: 50,  l: 22 },
    },
  },
  {
    label: "翡翠",
    colors: {
      bg:         { h: 160, s: 60,  l: 9  },
      surface:    { h: 160, s: 50,  l: 14 },
      surfaceAlt: { h: 160, s: 40,  l: 10 },
      text:       { h: 80,  s: 25,  l: 95 },
      textSoft:   { h: 80,  s: 18,  l: 80 },
      accent:     { h: 50,  s: 100, l: 55 },
      border:     { h: 160, s: 50,  l: 22 },
    },
  },
  {
    label: "紫罗兰",
    colors: {
      bg:         { h: 285, s: 60,  l: 11 },
      surface:    { h: 285, s: 50,  l: 17 },
      surfaceAlt: { h: 285, s: 40,  l: 13 },
      text:       { h: 290, s: 25,  l: 95 },
      textSoft:   { h: 290, s: 18,  l: 80 },
      accent:     { h: 320, s: 90,  l: 60 },
      border:     { h: 285, s: 50,  l: 24 },
    },
  },
  {
    label: "暖橙",
    colors: {
      bg:         { h: 20,  s: 60,  l: 9  },
      surface:    { h: 20,  s: 50,  l: 14 },
      surfaceAlt: { h: 20,  s: 40,  l: 10 },
      text:       { h: 30,  s: 25,  l: 95 },
      textSoft:   { h: 30,  s: 18,  l: 80 },
      accent:     { h: 200, s: 90,  l: 55 },
      border:     { h: 20,  s: 50,  l: 22 },
    },
  },
];

/**
 * 壁纸选择面板：6 款预设配色 + 1 个 🎨 自定义设计器（7 token × 色轮）。
 * 通过 createPortal 渲染到 document.body 之下，脱离 .app 主题 CSS 变量污染。
 */
export function WallpaperPicker({ current, custom, onPick, onCustom, onClose }: WallpaperPickerProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalTarget(document.body); }, []);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 锁滚动条
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const isCustom = current === "custom";

  // 自定义预览卡片的渐变（用 bg token 表现主基调）
  const customPreview = `linear-gradient(135deg,
    hsl(${custom.bg.h} ${custom.bg.s}% ${Math.max(6, custom.bg.l - 4)}%),
    hsl(${custom.accent.h} ${custom.accent.s}% ${custom.accent.l}%),
    hsl(${(custom.bg.h + 60) % 360} ${custom.bg.s}% ${Math.min(92, custom.bg.l + 30)}%))`;

  const tree = (
    <div
      className="modal-overlay wallpaper-portal-isolated"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="选择壁纸"
    >
      <div
        className={`modal-card wallpaper-picker ${isCustom ? "is-designer-open" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">🎨 选择壁纸</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <p className="modal-hint" style={{ marginTop: 0 }}>
          切换配色方案，频谱紫色 LED 设计保留不变。<br />
          选择会保存到本地，下次打开自动应用。
        </p>

        {/* 滚动主体：grid 卡片 + 设计器，开启自定义时可纵向滚动 */}
        <div className="wallpaper-picker-body">

        <div className="wallpaper-grid">
          {WALLPAPERS.map((wp) => (
            <button
              key={wp.id}
              type="button"
              className={`wallpaper-card ${current === wp.id ? "active" : ""}`}
              onClick={() => onPick(wp.id)}
              data-wallpaper={wp.id}
              aria-pressed={current === wp.id}
            >
              <div className="wallpaper-preview">
                <div className="wp-bar" style={{ background: wp.palette[0] }} />
                <div className="wp-bar" style={{ background: wp.palette[1] }} />
                <div className="wp-bar" style={{ background: wp.palette[2] }} />
                <div className="wp-led">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={i}
                      className="wp-led-cell"
                      style={{ height: `${30 + Math.abs(Math.sin(i * 0.9)) * 70}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="wallpaper-meta">
                <div className="wallpaper-name">{wp.name}</div>
                <div className="wallpaper-desc">{wp.desc}</div>
              </div>
            </button>
          ))}

          {/* 🎨 自定义卡片（永远在末尾） */}
          <button
            type="button"
            className={`wallpaper-card wallpaper-card-custom ${isCustom ? "active" : ""}`}
            onClick={() => onPick("custom")}
            data-wallpaper="custom"
            aria-pressed={isCustom}
          >
            <div
              className="wallpaper-preview wallpaper-preview-live"
              style={{ background: customPreview }}
            >
              <div className="wp-led">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span key={i} className="wp-led-cell" style={{ height: `${30 + Math.abs(Math.sin(i * 0.9)) * 70}%` }} />
                ))}
              </div>
              {!isCustom && <div className="wp-live-hint">点击自由调色</div>}
            </div>
            <div className="wallpaper-meta">
              <div className="wallpaper-name">🎨 自定义</div>
              <div className="wallpaper-desc">7 token · 色轮设计器</div>
            </div>
          </button>
        </div>

        {/* 7 token 色轮设计器（只有当前选 custom 才显示） */}
        {isCustom && (
          <div className="designer">
            <div className="designer-header">
              <div className="designer-title">
                <span className="designer-title-icon">✨</span>
                设计器 · 每个 UI 部分独立色轮
              </div>
              <button
                type="button"
                className="designer-reset"
                onClick={() => {
                  // 一次性塞 7 个 token 的默认值
                  const patch: CustomTokenPatch = {};
                  for (const k of CUSTOM_TOKEN_LIST) {
                    patch[k.key] = { ...DEFAULT_CUSTOM[k.key] };
                  }
                  onCustom(patch);
                }}
                aria-label="恢复默认"
              >
                ↺ 恢复默认
              </button>
            </div>

            <div className="designer-list">
              {CUSTOM_TOKEN_LIST.map(({ key, label, hint }) => {
                const hsl = custom[key];
                return (
                  <div className="token-row" key={key}>
                    <div className="token-meta">
                      <div className="token-label">{label}</div>
                      <div className="token-hint">{hint}</div>
                      <div
                        className="token-swatch-inline"
                        style={{ background: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` }}
                        aria-hidden="true"
                      />
                    </div>
                    <ColorWheel
                      value={hsl}
                      size={56}
                      onChange={(patch) => onCustom({ [key]: patch } as CustomTokenPatch)}
                    />
                    <div className="token-values" aria-label={`${label} 当前值`}>
                      <span style={{ background: `hsl(${hsl.h}, 100%, 50%)`, color: "#fff" }}>
                        {hsl.h}°
                      </span>
                      <span style={{ color: `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(20, hsl.l - 30)}%)` }}>
                        S {hsl.s}
                      </span>
                      <span style={{ color: `hsl(${hsl.h}, ${Math.max(15, hsl.s - 30)}%, 88%)` }}>
                        L {hsl.l}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="designer-footer">
              <span>💡 拖动圆环选色相 / 拖动方块选 S&amp;L</span>
              <div className="designer-presets">
                <span className="designer-presets-label">一键套：</span>
                {PRESET_PALETTES.map((sw) => (
                  <button
                    key={sw.label}
                    type="button"
                    className="designer-swatch"
                    onClick={() => {
                      const patch: CustomTokenPatch = {};
                      for (const k of CUSTOM_TOKEN_LIST) patch[k.key] = { ...sw.colors[k.key] };
                      onCustom(patch);
                    }}
                    style={{
                      background: `linear-gradient(135deg,
                        hsl(${sw.colors.bg.h} ${sw.colors.bg.s}% ${Math.max(6, sw.colors.bg.l - 6)}%),
                        hsl(${sw.colors.accent.h} ${sw.colors.accent.s}% ${sw.colors.accent.l}%))`,
                    }}
                    title={sw.label}
                    aria-label={`应用${sw.label}预设`}
                  >
                    {sw.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>{/* /wallpaper-picker-body */}

      </div>
    </div>
  );

  if (!portalTarget) return tree;
  return createPortal(tree, portalTarget);
}
