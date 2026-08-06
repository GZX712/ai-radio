// 云端模式工具：检测 / 推送配置
// EdgeOne Pages 部署域名特征：.edgeone.app / .edgeone.cool
const CLOUD_HOSTS = new Set([
  "edgeone.app",
  "edgeone.cool",
  "edgeone.com",
  "edgeone.ai",
]);

export function isCloudDemo(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  // 完全等于（防止误判 xxx.edgeone.appx.com）
  if (CLOUD_HOSTS.has(h)) return true;
  // 或以 .edgeone.app / .edgeone.cool 结尾
  return ["edgeone.app", "edgeone.cool", "edgeone.com", "edgeone.ai"].some(
    (d) => h.endsWith("." + d)
  );
}

// 推送：辛老师本机电脑（播歌端）→ EdgeOne KV
// 用户需要把 DJ_TOKEN 配置到后端 .env + EdgeOne Functions 环境变量
export const PUSH_URL = "/api/push";

export function buildPushHeaders(token?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { "X-DJ-Token": token } : {}),
  };
}
