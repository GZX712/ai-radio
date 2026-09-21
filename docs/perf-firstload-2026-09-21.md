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

## 4. 待办

- [ ] **部署**：`7539b97` 尚未上线。Render `render.yaml` 里 `autoDeploy: true`，但实测连续 14 次探测 uptime 只增不减（25s→376s），**说明实际未自动部署，需 Dashboard 手动 Manual Deploy**
- [ ] **音频 Cache-Control**（需腾讯云密钥）：跑 `tools/cos_set_cache_control.py`，用 `copy_object` 自身复制改元数据给 `songs/` 设一年缓存 —— 这是「切歌要重下 10 MB」的根因
- [ ] **音频瘦身**（可选，需定夺）：10.6 MB/首 → 128 kbps 约 4 MB，需 ffmpeg + 重传约 800 MB；有音质折损
- [ ] 腾讯云密钥轮换（承接上一轮建议）
