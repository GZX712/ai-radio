# iOS 调试与打包指南

## 开发期热重载（日常调试）

WiFi 环境下，iPhone Safari 直接访问开发机局域网 IP：
1. 确认 iPhone 和 Windows 在同一个 WiFi
2. iPhone Safari 打开 `http://192.168.1.4:5173/`
3. 代码改动 → Vite HMR 自动刷新

## Capacitor 原生 App

### 前提（硬约束）
- **出 ipa 必须 Mac + Xcode**（Windows 无法本地打包）
- 本项目已配置 **EAS Build 云打包**（无需 Mac）：
  - `app.json` — Expo 配置（bundleIdentifier: `com.workbuddy.airadio`）
  - `eas.json` — 构建配置（production / preview 两个 profile）
  - `eas-cli` — 已装为 devDependency

### 云端打包流程（Windows 即可，无需 Mac）

```bash
# 1. 登录 Expo（只需一次，用浏览器验证）
npx eas login

# 2. 项目关联（只需一次，生成 projectId）
npx eas build:configure

# 3. 构建 iOS 包（约 ¥3.5/次 或免费额度）
npx eas build --platform ios --profile preview

# 4. 完成后终端会给二维码/链接，iPhone 扫码安装
```

> 免费 Apple ID 构建的 App 7 天过期；99$/年 开发者账号可装一年。
> 云端构建已配置 `prebuildCommand`（自动 build + cap add + cap sync），
> 本地改完代码**只需要 git push**，EAS 云端会自己构建最新 dist。

### 每次改代码后的发布链路

```bash
git add -A && git commit -m "..." && git push   # 代码推到 GitHub
npx eas build --platform ios --profile preview  # 云打包（自动 build + sync）
```

> 本地 `npm run build && npx cap sync` 可选（用于本地验证 ios/App/App/public），
> 云端 EAS 构建不依赖本地 sync 结果，会从源码重新构建。

### 配置文件
- `capacitor.config.ts` — appId / webDir / 开发期 URL
- `app.json` — EAS 需要（Expo 配置 + bundleIdentifier）
- `eas.json` — EAS 构建 profile
- `ios/App/` — Capacitor 生成的 Xcode 工程（已 sync）

### 常用备注
- App 图标：`ios/App/App/Assets.xcassets/AppIcon.appiconset/`（当前是 Capacitor 默认图标，可替换 1024px PNG）
- 生产模式：App 加载 `dist/` 内置包，通过 WebSocket 连后端，无需配置服务器地址
- 开发模式：`NODE_ENV=development npx cap sync` + `capacitor.config.ts` 的 `server.url` 指向局域网 Vite
