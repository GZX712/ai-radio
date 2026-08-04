import { useEffect } from "react";
import { useRadioStore } from "@/store/useRadioStore";

/**
 * 错误提示组件：从 store 读取 error，4 秒后自动清除。
 */
export function Toast() {
  const error = useRadioStore((s) => s.error);
  const clearError = useRadioStore((s) => s.clearError);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(clearError, 4000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  if (!error) return null;

  return (
    <div className="toast" role="alert" aria-live="assertive">
      <span className="toast-icon">⚠️</span>
      <span className="toast-text">{error}</span>
    </div>
  );
}
