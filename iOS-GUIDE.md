# iOS 调试与打包指南

## 开发期热重载（日常调试）

WiFi 环境下，iPhone Safari 直接访问开发机局域网 IP：
1. 确认 iPhone 和 Windows 在同一个 WiFi
2. iPhone Safari 打开 `http://192.168.1.4:5173/`
3. 代码改动 → Vite HMR 自动刷新

## Capacitor 原生 App

### 前提（硬约束）
- **出 ipa 必须 Mac + Xcode**（Windows 无法本地打包）
- 两个方案：
  1. **EAS Build 云打包**（推荐）：`npx eas build --platform ios`（需 Expo 账号，约 ¥3.5/次）
  2. **借/租 Mac**：装 Xcode 后 `npx cap open ios` → Archive → 导出 ipa

### 生产构建命令
```bash
npm run build              # Vite build → dist/
npx cap sync               # 同步到 ios/
npx cap open ios           # Xcode 打开（需 Mac）
```

### 配置文件
- `capacitor.config.ts` — appId / webDir / 开发期 URL
- `ios/App/` — Capacitor 生成的 Xcode 工程
