# AI 电台 Render 部署指南

## 🎯 目标

让 AI 电台**后端**（Node + WebSocket）跑在 Render 免费版，前端继续在 EdgeOne。
- **PC 关机也能用** ✓
- **手机/微信/朋友都能听** ✓
- **全球 CDN 加速** ✓

## 🏗️ 架构

```
[前端 EdgeOne 静态] ──→ [后端 Render Node 8787] ──→ [网易云 API Render 3000]
  gzx-af-dp7ixeohkqzq       ai-radio-server              ai-radio-netease
  .edgeone.cool             .onrender.com                .onrender.com
```

3 个服务，2 个 Web Service 部署在 Render。

---

## 📋 部署步骤（辛老师您来做）

### 第 1 步：注册 Render 账号

1. 浏览器打开 **https://render.com**
2. 点「**Get Started for Free**」
3. 选 **「GitHub」** 注册（**辛老师如果没 GitHub 账号，先注册一个**——5 分钟）
4. 授权 Render 访问您的 GitHub

### 第 2 步：同步代码到 GitHub

Render 部署从 GitHub 拉代码。我们已经 push 到 Gitee，**辛老师把代码再 push 到 GitHub**：

1. 浏览器打开 **https://github.com/new**
2. 仓库名：`ai-radio`、**私有**、3 个 checkbox 都不勾 → 创建
3. GitHub 提示"推送已有仓库"，复制命令：

```bash
cd /c/Users/hxaka/WorkBuddy/2026-08-02-14-09-34/ai-radio
git remote add github https://github.com/您的用户名/ai-radio.git
git push github main
```

### 第 3 步：在 Render 创建**网易云 API**服务

1. Render 控制台 → **「New +」** → **「Web Service」**
2. 选仓库：**`您的用户名/ai-radio`**
3. 配置：
   | 字段 | 填 |
   |---|---|
   | Name | `ai-radio-netease` |
   | Region | Oregon (US West) |
   | Branch | `main` |
   | Root Directory | `vendor/NeteaseCloudMusicApi` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `node app.js` |
   | Plan | **Free** |
4. Environment Variables：
   - `PORT` = `3000`
   - `NODE_ENV` = `production`
5. 点「**Create Web Service**」→ 等 3-5 分钟
6. **复制 URL**（形如 `https://ai-radio-netease.onrender.com`）← **存下来等下要用**

### 第 4 步：在 Render 创建**主后端**服务

1. **「New +」** → **「Web Service」**
2. 同一个仓库 `您的用户名/ai-radio`
3. 配置：
   | 字段 | 填 |
   |---|---|
   | Name | `ai-radio-server` |
   | Region | Oregon (US West) |
   | Branch | `main` |
   | Root Directory | *（留空，根目录）* |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Plan | **Free** |
4. Environment Variables（**最关键**）：
   - `PORT` = `8787`
   - `NODE_ENV` = `production`
   - `NETEASE_BASE` = `https://ai-radio-netease.onrender.com` ← **第 3 步复制的 URL**
   - `DEEPSEEK_API_KEY` = 您的 DeepSeek Key
   - `TTS_VOICE` = `en-US-GuyNeural`
   - `PLAYLIST_ID` = `18342860645`（辛老师新默认歌单，网易云链接 `https://music.163.com/playlist?id=18342860645`）
5. 点「**Create Web Service**」→ 等 3-5 分钟
6. **复制 URL**（形如 `https://ai-radio-server.onrender.com`）

### 第 5 步：修改前端，指向新后端

`ai-radio/src/store/radioStore.ts` 或类似文件，把 `localhost:8787` 改成新后端 URL。

### 第 6 步：测试

浏览器打开 EdgeOne 前端 URL → **应该能播放音乐了**！

---

## 💡 注意事项

- **冷启动慢**：免费版 15 分钟无访问会休眠，下次访问需 30-60 秒启动
- **每月 750 小时免费额度**：2 个服务都够用
- **CORS**：后端已开 cors，EdgeOne 域名可直接访问

## 🔐 DeepSeek Key 怎么填

如果您没 DeepSeek Key，**点** https://platform.deepseek.com → 注册 → API Keys → 创建 → 复制
- 免费额度：500 万 tokens（约 1-2 个月用量）

---

## ❓ 遇到问题

把**错误信息截图**发我，我帮您看 ✋
