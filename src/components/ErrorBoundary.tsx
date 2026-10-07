import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  crashed: boolean;
  message: string;
}

/**
 * [2026-10-07] 全局崩溃兜底：任何组件抛错不再整树卸载黑屏（辛老师手机
 * 「拖进度黑屏」的直接观感就是 React 崩溃后页面空白）。崩溃时显示
 * 错误信息 + 一键刷新，音乐元素挂在 window 级（useAudioEngine 的 nodes
 * 在模块 ref 里），刷新前不打断播放。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, message: "" };

  static getDerivedStateFromError(err: unknown): State {
    return {
      crashed: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown): void {
    console.error("[ErrorBoundary] 页面崩溃已拦截:", err);
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#0a0a0f",
          color: "#f5f5f5",
          fontFamily: "monospace",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>📻</div>
        <div style={{ fontSize: 16 }}>电台页面开小差了</div>
        <div style={{ fontSize: 12, opacity: 0.6, maxWidth: 320, wordBreak: "break-all" }}>
          {this.state.message.slice(0, 200)}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            padding: "10px 28px",
            fontSize: 14,
            fontFamily: "monospace",
            background: "#7953b1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          点我重新接入
        </button>
      </div>
    );
  }
}
