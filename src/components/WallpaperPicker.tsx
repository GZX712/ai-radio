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
 *
 * 🖼 自定义壁纸卡片本身就可点：点击直接触发文件选择（不再需要下方独立设计器）。
 * 已上传时：卡片底图 = 缩略图，右上角 ✕ 清除小按钮（点 stopPropagation 不触发选图）。
 * 未上传时：卡片显示 + 占位 + "点击上传图片"。
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

  /** 用户在"自定义壁纸"卡片上点了一下 → 弹出文件选择 */
  const handlePickClick = () => {
    fileRef.current?.click();
  };

  /** 用户在 ✕ 上点了一下 → 清除图片（保持当前 wallpaperId = image 不变，可继续上传） */
  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onImage(null);
    setErrMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  };

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
        // 自动切到 image 模式（让新图立刻生效为整页背景）
        if (current !== "image") onPick("image");
      }
    } catch (e) {
      setErrMsg((e as Error).message || "上传失败");
    }
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
        className="modal-card wallpaper-picker"
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

        {/* 滚动主体：grid 卡片 */}
        <div className="wallpaper-picker-body">

        {/* 隐藏 file input（在 body 任意位置都能点自定义卡片触发） */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="uploader-input"
          onChange={(e) => handleFile(e.target.files?.[0])}
          aria-hidden="true"
          tabIndex={-1}
        />

        {errMsg && <div className="uploader-err uploader-err-floating">⚠ {errMsg}</div>}

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

          {/* 🖼 自定义图片卡片（极简黑白，永远在末尾）
              点击整张卡片 = 选图；已上传时右上角 ✕ 单独清除 */}
          <button
            type="button"
            className={`wallpaper-card wallpaper-card-image ${isImage ? "active" : ""}`}
            onClick={handlePickClick}
            data-wallpaper="image"
            aria-pressed={isImage}
            aria-label={customImage ? "点击更换自定义壁纸图片" : "点击上传自定义壁纸图片"}
            title={customImage ? "点击更换图片" : "点击上传图片"}
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
              {customImage && (
                <button
                  type="button"
                  className="wp-image-clear"
                  onClick={handleClearClick}
                  aria-label="清除自定义壁纸"
                  title="清除图片"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="wallpaper-meta">
              <div className="wallpaper-name">🖼 自定义壁纸</div>
              <div className="wallpaper-desc">
                {customImage ? "点击更换 · 整页背景" : "上传图片 · 整页背景"}
              </div>
            </div>
          </button>
        </div>

        </div>{/* /wallpaper-picker-body */}

      </div>
    </div>
  );

  if (!portalTarget) return tree;
  return createPortal(tree, portalTarget);
}