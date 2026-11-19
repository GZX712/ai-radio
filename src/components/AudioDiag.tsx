import { useEffect, useState } from "react";

/**
 * 手机端音频诊断浮层 —— 仅在 URL 带 `?diag=1` 时挂载。
 *
 * [2026-11-19] 背景：辛老师反馈「手机上 DJ 语音点了播放也没声音」，
 * 而桌面 Chrome 实测完全正常 → iOS/微信 WebView 的媒体策略问题在电脑上无法复现。
 * 与其反复猜，不如让真机自报状态：打开 ?diag=1 截图，一眼看到
 * ctx 状态、dj 元素的 paused/进度/readyState/error、音量、UA 环境。
 */

interface AudioNodesLike {
  ctx?: { state?: string };
  dj?: HTMLAudioElement;
  music?: HTMLAudioElement;
}

function envName(ua: string): string {
  if (/MicroMessenger/i.test(ua)) return "微信内置浏览器";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS Safari";
  if (/Android/i.test(ua)) return "Android";
  return "桌面浏览器";
}

function audioLine(el?: HTMLAudioElement, withProgress = true): string {
  if (!el) return "无元素";
  const dur = Number.isFinite(el.duration) ? el.duration.toFixed(1) : "?";
  const t = el.currentTime.toFixed(1);
  const err = el.error ? ` err${el.error.code}` : "";
  const state = el.paused ? "暂停" : "播放中";
  return withProgress ? `${state} ${t}/${dur}s rs${el.readyState}${err}` : `${state}${err}`;
}

export function AudioDiag() {
  const [rows, setRows] = useState<[string, string][]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const tick = () => {
      const n = (window as unknown as { __radioNodes?: AudioNodesLike }).__radioNodes;
      const ua = navigator.userAgent;
      const djSrc = (n?.dj?.currentSrc || n?.dj?.src || "").split("/").pop() || "空";
      const lastErr = (window as unknown as { __djLastError?: string }).__djLastError || "无";
      setRows([
        ["环境", envName(ua)],
        ["ctx", n?.ctx?.state ?? "无"],
        ["dj", audioLine(n?.dj)],
        ["dj源", djSrc],
        ["dj音量", String(n?.dj?.volume ?? "?")],
        ["dj错误", lastErr],
        ["music", audioLine(n?.music, false)],
        ["music音量", String(n?.music?.volume ?? "?")],
      ]);
    };
    tick();
    const timer = window.setInterval(tick, 600);
    return () => window.clearInterval(timer);
  }, []);

  if (!open) {
    return (
      <button type="button" className="audio-diag-toggle" onClick={() => setOpen(true)}>
        诊断
      </button>
    );
  }

  return (
    <div className="audio-diag" onClick={() => setOpen(false)}>
      <div className="audio-diag-head">音频诊断 · 点此收起</div>
      {rows.map(([k, v]) => (
        <div className="audio-diag-row" key={k}>
          <span className="audio-diag-k">{k}</span>
          <span className="audio-diag-v">{v}</span>
        </div>
      ))}
    </div>
  );
}
