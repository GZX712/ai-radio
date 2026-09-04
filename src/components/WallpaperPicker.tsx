import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  WALLPAPERS,
  type WallpaperId,
} from "@/store/useRadioStore";

interface WallpaperPickerProps {
  current: WallpaperId;
  customImage: string | null;
  onPick: (id: WallpaperId) => void;
  /** 传 null 表示清除；返回 false 表示 quota 失败 */
  onImage: (dataUrl: string | null) => boolean;
  onClose: () => void;
}

/**
 * 壁纸选择面板：6 款预设配色 + 1 个 🖼 自定义图片（用户上传 → 整页背景）。
 * 极简黑白设计：黑底白字 + 细线边框，无渐变无装饰。
 */
export function WallpaperPicker({ current, customImage, onPick, onImage, onClose }: WallpaperPickerProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  const isImage = current === "image";

  // 把 File → DataURL（base64）
  const readAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("文件读取失败"));
      fr.readAsDataURL(file);
    });

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrMsg("仅支持图片文件（jpg/png/webp/gif）");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrMsg("图片过大（建议 ≤2MB），浏览器已拒绝");
      return;
    }
    try {
      const url = await readAsDataURL(file);
      const ok = onImage(url);
      if (!ok) {
        setErrMsg("本地存储空间已满，请换一张更小的图");
      } else {
        setErrMsg(null);
      }
    } catch (e) {
      setErrMsg((e as Error).message || "上传失败");
    }
  };

  const handleClear = () => {
    onImage(null);
    setErrMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const tree = (
    <div
      className="modal-overlay wallpaper-portal-isolated"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="选择壁纸"
    >
      <div
        className={`modal-card wallpaper-picker ${isImage ? "is-image-open" : ""}`}
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

        {/* 滚动主体：grid 卡片 + 图片上传设计器 */}
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

          {/* 🖼 自定义图片卡片（极简黑白，永远在末尾） */}
          <button
            type="button"
            className={`wallpaper-card wallpaper-card-image ${isImage ? "active" : ""}`}
            onClick={() => onPick("image")}
            data-wallpaper="image"
            aria-pressed={isImage}
          >
            <div
              className="wallpaper-preview wallpaper-preview-image"
              style={customImage ? { backgroundImage: `url(${customImage})` } : undefined}
            >
              {!customImage && (
                <div className="wp-image-empty">
                  <span className="wp-image-plus">＋</span>
                  <span className="wp-image-label">点击上传图片</span>
                </div>
              )}
              <div className="wp-led">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span key={i} className="wp-led-cell" style={{ height: `${30 + Math.abs(Math.sin(i * 0.9)) * 70}%` }} />
                ))}
              </div>
            </div>
            <div className="wallpaper-meta">
              <div className="wallpaper-name">🖼 自定义壁纸</div>
              <div className="wallpaper-desc">上传图片 · 整页背景</div>
            </div>
          </button>
        </div>

        {/* 图片上传设计器（仅当 current === "image" 时显示，极简黑白） */}
        {isImage && (
          <div className="image-uploader">
            <div className="uploader-header">
              <div className="uploader-title">
                <span className="uploader-title-icon">⬆</span>
                上传自定义壁纸
              </div>
              {customImage && (
                <button
                  type="button"
                  className="uploader-clear"
                  onClick={handleClear}
                  aria-label="清除图片"
                >
                  ✕ 清除
                </button>
              )}
            </div>

            {/* 隐藏 input + label 触发器 */}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="uploader-input"
              onChange={(e) => handleFile(e.target.files?.[0])}
              aria-hidden="true"
              tabIndex={-1}
            />

            {customImage ? (
              <button
                type="button"
                className="uploader-preview"
                style={{ backgroundImage: `url(${customImage})` }}
                onClick={() => fileRef.current?.click()}
                aria-label="点击替换图片"
              >
                <span className="uploader-preview-overlay">点击替换</span>
              </button>
            ) : (
              <button
                type="button"
                className="uploader-dropzone"
                onClick={() => fileRef.current?.click()}
              >
                <span className="uploader-dropzone-icon">＋</span>
                <span className="uploader-dropzone-text">点击选择图片</span>
                <span className="uploader-dropzone-hint">jpg · png · webp · ≤2MB</span>
              </button>
            )}

            {errMsg && <div className="uploader-err">⚠ {errMsg}</div>}

            <div className="uploader-footer">
              <span>💡 图片会作为 .app 整页背景，叠加暗色蒙版保证文字可读</span>
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