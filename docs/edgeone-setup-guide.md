# AI 电台 EdgeOne 部署 — 操作指南（辛老师版）

> 本指南覆盖三件事：
> 1. 腾讯云账号实名 + 开通 EdgeOne Pages 免费版
> 2. 创建 Git 仓库（GitHub / Gitee）并推送本项目
> 3. 绑定自定义域名（免费子域名）

---

## 第一步：腾讯云账号实名 + 开通 EdgeOne

### 1.1 注册 / 登录腾讯云

- 打开腾讯云官网：**https://cloud.tencent.com**
- 右上角点「免费注册」→ 可用微信扫码注册
- 注册后完成**实名认证**（个人实名即可，微信扫码 / 身份证照片，几分钟内通过）

> 🔗 实名认证入口：https://console.cloud.tencent.com/developer/auth

### 1.2 开通 EdgeOne 免费版

- 打开 EdgeOne 产品页：**https://console.cloud.tencent.com/edgeone**
- 点「立即体验 / 开通服务」→ 选择**免费版（个人版）**→ 确认开通
- 免费版权益（长期有效）：
  - 不限量网站安全加速流量 + 请求额度
  - 平台级安全防护（DDoS + WAF）
  - 免费 SSL 证书（自动签发）

### 1.3 开通 EdgeOne Pages

- 打开 Pages 控制台：**https://console.cloud.tencent.com/edgeone/pages**
- 首次进入会引导创建项目（见第二步）

---

## 第二步：创建 Git 仓库并推送本项目

> 选择 GitHub 或 Gitee（国内访问 Gitee 更快，EdgeOne 都支持）。
> 项目代码已在本机 `C:\Users\hxaka\WorkBuddy\2026-08-02-14-09-34\ai-radio\`（已 git init + 2 次提交，分支 main）。

### 方案 A：用 Gitee（推荐，国内快）

1. 打开 **https://gitee.com** → 注册/登录（微信扫码即可）
2. 右上角「+」→「新建仓库」
   - 仓库名：`ai-radio`
   - **勾选「使用 Readme 文件初始化这个仓库」：不要勾**（本机已有代码）
   - 权限：私有或公开都行（建议先私有）
   - 创建
3. 创建后仓库页会显示远程地址，类似：
   ```
   https://gitee.com/您的用户名/ai-radio.git
   ```
4. 回到本机 PowerShell，执行（**把地址换成您自己的**）：
   ```powershell
   cd C:\Users\hxaka\WorkBuddy\2026-08-02-14-09-34\ai-radio
   git remote add origin https://gitee.com/您的用户名/ai-radio.git
   git push -u origin main
   ```
   - 首次推送会弹登录（Gitee 用户名 + 密码，或「私人令牌」）
   - 私人令牌获取：Gitee 设置 → 私人令牌 → 生成（勾选 projects 权限）→ 复制

### 方案 B：用 GitHub

1. 打开 **https://github.com** → 注册/登录
2. 右上角「+」→「New repository」
   - Repository name: `ai-radio`
   - **不要**勾选 "Add a README file"
   - 创建
3. 本机执行：
   ```powershell
   cd C:\Users\hxaka\WorkBuddy\2026-08-02-14-09-34\ai-radio
   git remote add origin https://github.com/您的用户名/ai-radio.git
   git push -u origin main
   ```
   - 首次推送弹 GitHub 登录（用 Personal Access Token：GitHub → Settings → Developer settings → Personal access tokens → 生成，勾选 `repo` 权限）

> ⚠️ 推送前确认 `git status` 干净；`.env`（含 API Key）已被 `.gitignore` 排除，不会上传。

---

## 第三步：在 EdgeOne Pages 创建项目并绑定仓库

1. 打开 Pages 控制台：**https://console.cloud.tencent.com/edgeone/pages**
2. 「创建项目」→ 选择「连接 Git 仓库」方式
   - 授权 GitHub / Gitee（跳转授权页面，确认）
   - 选择刚创建的 `ai-radio` 仓库 + `main` 分支
3. 构建配置（EdgeOne 会自动识别，如未识别手动填）：
   - 构建命令：`npm run build`
   - 输出目录：`dist`
   - 框架预设：Vite
4. 点「部署」→ 等待约 1-3 分钟 → 生成预览 URL
   - 预览 URL 形如：`https://xxx.pages.dev` 或 `https://xxx.edgeone.app`

> ⚠️ **预览 URL 有效期只有 3 小时**，必须尽快完成第四步绑定域名。

---

## 第四步：开通 KV 存储 + 绑定命名空间

1. 打开 KV 控制台：**https://console.cloud.tencent.com/edgeone/pages/kv**
2. 「创建命名空间」→ 名称填：`ai-radio`（或任意）
3. 回到项目 →「设置 / 变量与绑定」→「添加绑定」：
   - 绑定类型：KV 存储
   - 变量名：`RADIO_KV`（**必须与代码一致**）
   - 命名空间：选择刚创建的 `ai-radio`
4. 保存 → 重新部署（控制台会提示）

---

## 第五步：绑定自定义域名（免费子域名或自购域名）

### 方式 1：EdgeOne 免费子域名（最简单，推荐先上）
- EdgeOne Pages 提供免费子域名（形如 `ai-radio.pages.dev` 或 `xxx.edgeone.app`）
- 创建项目时选「自动分配域名」或项目设置里「绑定域名」→ 选 EdgeOne 提供的免费子域名
- 免费 SSL 自动签发，**无需备案**（.edgeone.app / .pages.dev 是平台自带）

### 方式 2：自购域名（正式使用推荐）
1. 购买域名（腾讯云域名注册：https://dnspod.cloud.tencent.com 或阿里云）
2. EdgeOne 控制台 →「站点」→ 添加站点 → 填您的域名 → 按提示做 **DNS 解析**（CNAME 指向 EdgeOne 分配的地址）
3. 项目设置 →「绑定域名」→ 填您的域名
4. 等待 DNS 生效（几分钟 ~ 几小时）→ 自动签发免费 SSL

> 💡 免费子域名 `.edgeone.app` 国内访问速度快、免备案，个人使用完全够；
> 微信分享卡片也支持（og:image 用绝对 https 链接即可）。

---

## 第六步：配置环境变量（部署后必须）

1. 项目 →「设置」→「环境变量」→ 新增两个：
   - `DJ_TOKEN`：填我生成的随机 Token（见下）
   - （可选）`DEEPSEEK_API_KEY`：如果想把 DJ 解说也搬上云端（当前阶段不需要，解说在电脑端生成）
2. 保存 → 重新部署

**DJ_TOKEN（我来生成，您粘贴）**：稍后我生成 32 位随机 hex 发给您。

---

## 第七步：验证

| 检查项 | 方法 |
|--------|------|
| 静态页面 | 浏览器打开 `https://您的域名/live` 应显示直播页（未开播占位） |
| 推送接口 | `curl -X POST https://您的域名/api/push -H "X-DJ-Token: xxx" -d '{"type":"heartbeat"}'` → `{"code":0}` |
| 轮询接口 | `curl https://您的域名/api/poll` → `{"code":0,"data":{...}}` |
| 分享页 | 浏览器打开 `https://您的域名/share/live` → 跳转直播页 |
| 微信分享 | 微信内发 `https://您的域名/share/live` → 显示卡片（标题/描述） |

---

## 遇到问题对照表

| 现象 | 原因 | 解决 |
|------|------|------|
| 预览 URL 打不开 | 3 小时过期 | 绑定自定义域名（第五步） |
| 构建失败 | 仓库缺文件 / 构建命令不对 | 确认构建命令 `npm run build`、输出 `dist` |
| /api/push 返回 401 | DJ_TOKEN 没配 / 不一致 | 检查环境变量（第六步） |
| /api/poll 返回空 | 电脑端还没推送 | 等电脑端 ai-radio 运行并推送（下一步我做） |
| 微信打开没卡片 | 需要 og:image 可访问 | 确认 /share 页能访问 + og 标签正确 |

---

*完成 1-6 步后告诉我，我继续做「电脑端推送模块」接入，让电台内容真正流向云端。*
