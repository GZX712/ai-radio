/**
 * 服务入口（确保 .env 在加载任何业务模块之前生效）
 *
 * 背景：ESM 静态 import 会被提升（hoist），index.ts 中即使把 loadEnv() 写在
 * import 之后也会在 music.ts 等模块求值之后才执行 —— 导致 NETEASE_COOKIE
 * 等环境变量读不到。这里用动态 import：先同步加载 .env，再加载 index.ts。
 */
import { loadEnv } from "./services/env";

loadEnv();

// 动态 import：此时 .env 已加载，index.ts 及其依赖树（music.ts 等）能读到完整 process.env
await import("./index.ts");
