/**
 * 轻量 .env 加载器（零依赖，不引入 dotenv 包）
 * 在 server 入口显式调用，确保所有 service 读取 process.env 前 .env 已加载。
 * Render 部署环境不需要 .env（环境变量由平台注入），此函数自动跳过。
 */
import fs from "node:fs";
import path from "node:path";

export function loadEnv() {
  try {
    const root = path.resolve(".");
    const content = fs.readFileSync(path.join(root, ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
    console.log("[env] .env loaded");
  } catch {
    // .env 不存在或不可读（Render 部署场景），继续
  }
}
