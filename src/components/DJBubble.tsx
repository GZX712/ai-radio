import { useState } from "react";
import { useRadioStore } from "@/store/useRadioStore";

/**
 * DJ 双语字幕（常驻显示）
 * - 双行字幕：英文原文 + 中文翻译
 * - 顶部切换按钮：隐藏中文 / 显示中文
 * - 字幕常驻不消失，直到新 DJ 消息替换
 * - DJ 正在生成回复时显示"正在酝酿"占位（感知提速）
 */
export function DJBubble() {
  const djEn = useRadioStore((s) => s.djEn);
  const djZh = useRadioStore((s) => s.djZh);
  const djThinking = useRadioStore((s) => s.djThinking);
  const [hideZh, setHideZh] = useState(false);

  // DJ 正在生成回复（尚无内容）→ 思考占位
  if (djThinking && !djEn) {
    return (
      <section className="caption-panel caption-thinking">
        <header className="caption-header">
          <span className="caption-role">DJ</span>
        </header>
        <p className="caption-en">
          <span className="thinking-dots">
            <span>🎙</span> 正在酝酿回复
            <span className="dots"><i>.</i><i>.</i><i>.</i></span>
          </span>
        </p>
      </section>
    );
  }

  if (!djEn) return null;

  return (
    <section className="caption-panel">
      <header className="caption-header">
        <span className="caption-role">DJ</span>
        <button
          type="button"
          className="caption-toggle"
          onClick={() => setHideZh((v) => !v)}
          aria-label={hideZh ? "显示中文" : "隐藏中文"}
        >
          {hideZh ? "显示中文" : "隐藏中文"}
        </button>
      </header>
      <p className="caption-en">{djEn}</p>
      {!hideZh && <p className="caption-zh">{djZh}</p>}
    </section>
  );
}
