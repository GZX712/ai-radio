# AI 电台 · 首屏/切歌「卡顿观感」优化报告

日期：2026-09-21
提交：`7539b97`（Gitee `origin/main` + GitHub `github/main` 双推）
触发：辛老师反馈「卡顿了」「能不能优化，太影响观感了」

---

## 1. 定位过程

先用探针把线上真实数据抓出来，避免凭感觉猜。

| 探针脚本 | 作用 |
|---|---|
| `scripts/_probe_live.cjs` | console 报错 / 网络失败 / 长任务 / FPS |
| `scripts/_probe_play.cjs` | patch `window.Audio` + `WebSocket`，采样播放态（`--mobile` 支持手机） |
| `scripts/_probe_perf.cjs` | commit → domInteractive → load → 首屏元素可见 的导航时序 + 资源体积 |
| `scripts/_stat_library.cjs` | 曲库体积分布 TOP20 |
| `scripts/_probe_cos.cjs` | 探测 COS 图片处理可用性与收益 |
| `scripts/_stat_covers_optimized.cjs` | 实测 107 张封面处理后的真实总体积 |

### 首屏时序（服务端热态）

| 指标 | 实测 |
|---|---|
| TTFB | 785 ms |
| FCP | 1516 ms |
| load | 2155 ms |
| 「开始电台」可见 | 2766 ms |
| FPS / JS 报错 | 61 / 无 |

→ 服务端与播放链路本身**没问题**：音乐 `currentTime` 每 4 秒稳定推进，`readyState=4`，无 stall。

### 真正的瓶颈：文件太大 + 无缓存

| 项目 | 现状 |
|---|---|
| 封面 107 张 | 共 **50.3 MB**，均 481 KB，最大 `L0097.png` **1541 KB**；76 张 >200 KB |
| 音频 191 首 | 共 **1983 MB**，均 **10.6 MB/首**，最大 16.6 MB；154 首 >8 MB |
| COS `songs/*.mp3` | **`cache-control` 为 null** → 浏览器完全不缓存音频 |
| `/api/dj/open` | 5.1–6 s（TTS 合成；前端 fire-and-forget，不阻塞渲染） |

---

## 2. 已完成的改动

### 2.1 封面实时瘦身（收益最大）

后端拼封面 URL 时挂 COS 图片处理参数，**零文件改动、零重传**：

```
?imageMogr2/thumbnail/640x/format/webp/quality=78
```

实测（107/107 全部真实测量）：

| | 原始 | 优化后 |
|---|---|---|
| 总体积 | 50.3 MB | **4.1 MB** |
| 单张均值 | 481 KB | **40 KB** |
| 降幅 | — | **91.8%** |
| 最大单张 | 1541 KB | 76 KB |

关键验证：处理后的响应**保留 `access-control-allow-origin: *`**（PC 端 canvas 取色不受影响），且带 `max-age=2592000`（30 天浏览器缓存）。

### 2.2 下一首预取

- 新增只读 `GET /api/peek` + `musicQueue.peekNext()`：预览下一首但**不推进 cursor、不消费预取池**
- 新增 `src/hooks/useNextPrefetch.ts`：播到 85% 时预取下一首封面与音频

> 实现坑：该 effect **不能注册 cleanup** —— `progress` 每 250 ms 变化会触发 cleanup，把刚启动的预取自己取消掉。改用 `doneRef` 按 `songmid` 去重，`<link>` 由定时器自回收。

### 2.3 封面渲染细节

`PixelCover.tsx`：
- 触摸端：`decoding="async"` + `fetchPriority="high"`
- 桌面端：onload 后 `img.decode()` 背景预热（**不 await**，避免挂起导致封面不显示）

---

## 3. 验证结果

| 验证项 | 结果 |
|---|---|
| `tsc -b` 类型检查 | EXIT=0 |
| zod schema 解析带 query 的 picUrl | 3/3 PASS（本地/带 query/中文名+query） |
| COS 处理后响应头 | `image/webp` + CORS `*` + `max-age=2592000` |
| 生产构建 | 通过（JS 269 KB / gzip 85 KB） |

> 本地构建坑：`vite build` 带 `sourcemap: true` 会卡死在 sourcemap 生成阶段（两次 3–4 分钟零输出）；`vite build --sourcemap false` 1 分 18 秒正常。

---

## 4. 第二轮：切歌「零下载」（提交 `7990844`）

### 问题

COS 上 `songs/*.mp3` 响应头 `cache-control: null`（实测），浏览器**完全不缓存**；单首均值 10.6 MB → 每次切歌重下整首。
原计划改 COS 元数据，但需要密钥（会阻塞），所以改为**前端自持缓存**，零凭证。

### 方案

预取时把下一首**整首 `fetch` → Blob → `createObjectURL`** 存住；真正切歌命中就用 `blob:` 地址播放（零网络、零 Range 请求、seek 瞬时）。

| 文件 | 改动 |
|---|---|
| `src/lib/audioCache.ts`（新） | 上限 2 首；淘汰时 `revokeObjectURL` 旧地址；`pinPlayingAudio()` 保护正在播的（revoke 正在播的会立刻静音）；`inflight` 并发去重；只吃 `http(s)`；全部 best-effort |
| `src/hooks/useNextPrefetch.ts` | 音频预取由 `<link rel=prefetch>` 改为 `prefetchAudio()`（无 Cache-Control 时 `<link>` 铁定进不了 HTTP 缓存） |
| `src/hooks/useAudioEngine.ts` | `music.src = getCachedAudioUrl(url) ?? url` + `pinPlayingAudio` |

### 风险预检（这一步最关键）

唯一风险：blob 源 + `crossOrigin="anonymous"` + `createMediaElementSource` 会不会被判异源污染 → 静音、analyser 全 0。
`scripts/_test_blob_audio.cjs`（本地 127.0.0.1 安全上下文内真播）实测：

| 指标 | blob 源 | COS 直链 |
|---|---|---|
| analyser 波形峰值 | 47 | 47 |
| 播放 1.8 s 后 `currentTime` | 1.81 s | 1.88 s |
| `readyState` | 4 | 4 |

→ **无污染、不静音、analyser 正常取波**，方案可行。

### 端到端验证（本地 COS 模式后端 + 全新无痕浏览器）

| 时刻 | music 源 | 状态 |
|---|---|---|
| 10–80 s | `cos` 直链 | 正常播放，进度 10% → 83% |
| 90 s | `cos` 直链 | **`blobCount = 1`** ← 85% 阈值触发 `/api/peek` + 整首下载完成 |
| 100 s | **`blob:http://127.0.0.1:8787/5652af8…`** | 切歌后从本地 Blob 播放（`currentTime=4s`、`readyState=4`、未暂停） |

mp3 网络请求统计：`fetch 杏里 - Last Summer Whisper` **1 次**（预取下载），
**没有任何对应的 `media` 请求** → 切歌确实没有二次下载。零 pageerror、零 console error。

单测 `scripts/_test_audio_cache.ts`：**13/13 PASS**（命中 / 并发去重 / 淘汰 / pin 保护 / 非法输入）。

---

## 5. 顺带发现并修复：LLM 通道没有故障切换（提交 `6a2d41d`）

线上 `POST /api/dj/open` 返回 `provider: "fallback"` 引起注意，查后端日志拿到实锤：

```
[songKnowledge] 触不可及 档案生成失败: MiMo API 402: {"message": "Insufficient account balance"}
[DJ-chat] LLM mimo chat 失败 → fallback: MiMo API 402 ...
```

**根因**：`server/services/llm/doubao.ts` 里 provider 是**导入时静态选一次**——

```ts
export const llm = mimo.isConfigured() ? mimo : deepseek.isConfigured() ? deepseek : doubao;
```

「配了 key」不等于「key 可用」。MiMo 账号余额为 0 → 每次调用 402 失败，
而实测**完全可用的 DeepSeek（200 OK）从头到尾没被尝试过一次**。
后果不只是串场词变素：曲目档案生成失败、DJ 对话与即兴串场整条链路降级成模板池
—— 也就是辛老师要求的「天气/金融/科技/历史趣闻个性化解说」实际处于失效状态。

**修复**：新增 `FailoverProvider`，按序尝试；谁成功就锁定谁（5 分钟冷却），期间直接走可用通道，
冷却到期后重试首选 → MiMo 充值恢复后**自动切回，无需重启服务**。`/api/health` 暴露 `llm.{chain,active}` 便于线上观察。

**验证**（本地 COS 模式）：

| 检查项 | 结果 |
|---|---|
| `/api/health.llm` | `{"chain":["deepseek","mimo"],"active":"deepseek"}` |
| `POST /api/dj/open` | `provider: "deepseek"`，3.9 s |
| 文案质量 | 「晚上好啊——六点十九，打工人刚下班，咱这档「听歌续命」节目正式开门营业。」（LLM 生成，非模板池） |
| 日志 | `[llm] mimo 失败，试下一个：MiMo API 402` → `[llm] 切换到 deepseek` |

> ⚠️ 需要辛老师确认：**MiMo（小米）账号余额已耗尽**（402 Insufficient account balance）。TTS 侧目前仍能出声，但建议一并核对是否同一账户扣费。

---

## 6. 待办（更新）

- [ ] **部署**：`7539b97`（封面瘦身 + 预取）、`7990844`（blob 音频缓存）、`6a2d41d`（LLM 故障切换）**三笔都还没上线**。
      Render `render.yaml` 里 `autoDeploy: true` 实测不生效（后台盯 12 分钟、27 次探测，实例 uptime 25 s → 723 s 单调递增从未重启）
      → **必须去 Dashboard 点 Manual Deploy → Deploy latest commit**
- [ ] 部署后验证三件事：`GET /api/peek` 返回 200、`/api/now` 的 `picUrl` 带 `imageMogr2`、`/api/health.llm.active` 为 `deepseek`
- [ ] MiMo 账户充值（或确认弃用该通道，链路会自动走 DeepSeek）
- [ ] 音频 `Cache-Control`（可选，已有前端 blob 缓存替代，收益仅剩「二次访问免下载」）
- [ ] 音频瘦身（可选）：10.6 MB/首 → 128 kbps 约 4 MB，需 ffmpeg + 重传约 800 MB，有音质折损
- [ ] 腾讯云密钥轮换（承接上一轮建议）
