// 云端模式工具：检测 / 推送配置
// EdgeOne Pages 部署域名特征：.edgeone.app / .edgeone.cool
const CLOUD_DOMAINS = ["edgeone.app", "edgeone.cool", "edgeone.app"];

export function isCloudDemo(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return CLOUD_DOMAINS.some((d) => h.endsWith("." + d) || h === d);
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
