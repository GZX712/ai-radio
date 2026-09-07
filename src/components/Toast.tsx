import { useEffect } from "react";
import { useRadioStore } from "@/store/useRadioStore";

/**
 * 轻提示组件：从 store 读取 error，4 秒后自动清除。
 * ✅ / ❌ 前缀 → 成功/失败图标与配色；其余视为 ⚠️ 警告。
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

  const ok = error.startsWith("✅") || error.startsWith("✓");
  const bad = error.startsWith("❌") || error.startsWith("✗");
  const icon = ok ? "✅" : bad ? "❌" : "⚠️";

  return (
    <div className={`toast ${ok ? "toast-ok" : bad ? "toast-bad" : ""}`} role="alert" aria-live="assertive">
      <span className="toast-icon">{icon}</span>
      <span className="toast-text">{error}</span>
    </div>
  );
}
