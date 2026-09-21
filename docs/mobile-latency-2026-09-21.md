# 手机端延迟治理报告（2026-09-21）

> 起因：辛老师反馈「手机端延迟太久」。
> 结论：**不是服务端慢，也不是 UI 重 —— 是前端自己在反复掐断音频下载、并且把慢网正常缓冲误判成死播。**
> 真机实测（Slow 4G + CPU 4×）：点击「开始电台」到出声 **34959ms → 13446ms**；8Mbps 4G 下 **3707ms**。

---

## 一、测量方法

用 Playwright-core（Chrome 152）+ CDP 做真机仿真：

| 维度 | 设置 |
|---|---|
| 设备 | iPhone UA / 390×844 / DPR 2 / `hasTouch` |
| 网络 | `Network.emulateNetworkConditions`：Slow 4G 1.6Mbps·150ms RTT / 4G 8Mbps·60ms / wifi 不限速 |
| CPU | `Emulation.setCPUThrottlingRate` 4× |
| 埋点 | 页面脚本执行前 `addInitScript` 劫持 `HTMLMediaElement.prototype.play` 与 `.src` setter，登记**所有**媒体元素 |

> ⚠️ **踩过的坑**：`new Audio()` 是游离 DOM 元素，`document.querySelector('audio')` **看不见它**。
> 第一版探针因此得出「未出声」的**误报**。必须从原型层劫持才能正确观测。
> 另一个坑：限速表里漏了 `fourg` 档 → `NET=fourg` 静默回落 Slow 4G，得出「8Mbps 也要 13 秒」的假结论。

---

## 二、修复前的现场（线上实测）

```
  引导层画出              9459 ms      ← 首帧 1752ms，但引导层要 9.5 秒
  9747ms   srcSet 「十面埋伏」          ← 用户还没点，13MB 已开始下载
 12444ms   srcSet 「十面埋伏」又一次    ← 点击时重设 src → AbortError，前面下的全废
 27229ms   （看门狗误判死播）→ 自动切歌
 27633ms   srcSet 「山下達郎 - Jody」   ← 再废一次，重新下 10.3MB
 46504ms   playOK
────────────────────────────────────
 点击 → 出声 = 34959ms
 媒体下载量：十面埋伏 2 次共 20.4MB（全扔）+ Jody 10.3MB = 30.7MB 只为听一首歌
```

---

## 三、三个根因与修法

### 根因 1：同一首歌被重复设 `music.src` → 在途下载被 abort、从 0 重来

重复给 `music.src` 赋值会触发浏览器的**媒体加载算法**，中止正在进行的下载。

修复（`src/hooks/useAudioEngine.ts`）：`loadAndPlay` 幂等化 —— 只有「换歌 / 换了源形态（blob ↔ 直链）/ 上次加载出错」才写 `src`。

### 根因 2：看门狗把「慢网正常缓冲」误判成「死播」→ 自动切歌

原逻辑：播放中且 `currentTime` 连续 10 秒不推进 → 判定死播 → `autoSkip` 切歌。
但 13MB 的歌在慢网下缓冲 30 秒都不稀奇，结果把下到一半的整首丢掉重来，新歌再来一遍。

修复：三级判定
- 换源后 **30 秒宽限**（`STALL_GRACE_MS`）内一律不判定
- `readyState < 3`（仍在缓冲）→ 容忍上限放宽到 **75 秒**
- 缓冲已充足却完全不动 → **20 秒**才判死播（真·URL 失效/被掐流）

顺带把 `loadAndPlay` 的起播超时 6 秒 → 25 秒（13MB 慢网光缓冲就远超 6 秒）。

### 根因 3：启动竞态 —— `getNow()` 与自动开播并行

`/api/now` 还没回来时 `handlePlay()` 就走了 `/api/next`（白白推进一次队列），
慢网下两条异步还会互相打架（同一首被两次设源）。

修复（`src/App.tsx`）：改为**串行** —— `getNow() → setNow → （仅主人设备）handlePlay()`；
客人/未绑定设备不自动播，统一由「开始电台」按钮在手势内触发。

---

## 四、顺带修掉的三个体验问题

| 问题 | 现象 | 修复 |
|---|---|---|
| 引导层 4~9 秒才出现 | 用户面对纯黑屏，主观就是"打不开" | `index.html` 内联静态首屏 splash（同色系、不动任何 JS 资源），首帧 1.4 秒就有反馈；React 挂载后淡出移除 |
| Render 冷启动 | 15 分钟无**入站**请求即休眠，下次访问等 30~50 秒 | 新增 `startSelfKeepalive()`：定时 ping 自己的公网地址（`RENDER_EXTERNAL_URL`）。原 keepalive 只 ping 了网易云 API（出站），对休眠计时器毫无作用 |
| 静态资源不缓存 | `dist` 全量 `no-store` → 每次打开重下 85KB JS + 14KB CSS | 按文件分流：`dist/assets/*`（名字带内容哈希）→ `max-age=31536000, immutable`；入口文件仍 `no-store` |

---

## 五、修复后实测

| 指标 | 修复前 | 修复后（Slow 4G） | 修复后（4G 8Mbps） |
|---|---|---|---|
| 引导层画出 | 9459 ms | **3408 ms** | **1966 ms** |
| 首帧 FCP | 1752 ms | 1392 ms | 680 ms |
| 点击前是否偷跑下载 | 是（13MB） | **否** | **否** |
| `src` 重设次数 | 3 次（2 次白下） | **1 次** | **1 次** |
| 自动切歌误判 | 有 | **无** | **无** |
| 点击 → 出声 | **34959 ms** | **13446 ms** | **3707 ms** |
| 音频下载量 | 30.7 MB | **3.77 MB** | **3.77 MB** |
| JS 报错 | 0 | 0 | 0 |

UI 回归验证：引导层、播放器、640px COS 压缩封面（`imageMogr2` 生效）、双语 DJ 字幕、访客徽标均正常。

---

## 六、剩下的唯一瓶颈：**音频码率**

隔离实验（空白页，零 App 代码）证明了一件事：

```
同一首歌 3.77MB / 95 秒（≈318 kbps），Slow 4G：
  preload=auto       出声 13300 ms
  preload=metadata   出声 12876 ms
  preload=none       出声 13058 ms
  fetch→Blob→播放     出声 19598 ms   ← 要整首下完，最慢
不限速（wifi）：
  preload=metadata   出声 1420 ms
```

**三种 `preload` 策略完全一样** → 起播瓶颈与策略无关。
事件流显示 Chrome 在 `loadedmetadata` 前已缓冲 **60.8 秒音频**（≈2.4MB，占文件 62%）：

> **首次可播时间 ≈ min(60 秒音频的体积, 整个文件) ÷ 带宽**

我们曲库平均 **318 kbps** 偏高（3.77MB 只要 95 秒）。所以：

- 重编码到 **128 kbps** → 起播预读从 2.4MB 降到 ~0.96MB → Slow 4G 起播约 **4.8 秒**（现在 13.4 秒），总体积降约 60%
- 这件事**需要腾讯云密钥 + ffmpeg + 重传**，是目前唯一还没做的杠杆

> 也正因如此，`preload` 从 `auto` 改成 `metadata`：实测起播速度完全一样，
> 但 `auto` 会在用户还没点播放时就把整首十几 MB 拉下来（白耗流量和 Render 带宽）。

---

## 七、改动清单

| 文件 | 改动 |
|---|---|
| `src/hooks/useAudioEngine.ts` | 幂等设源；看门狗三级宽限；起播超时 6s→25s；`preload=metadata`；`dj.preload=none` |
| `src/App.tsx` | `getNow() → handlePlay()` 串行；撤掉静态首屏 splash |
| `src/hooks/useNextPrefetch.ts` | 预取阈值 0.85 → 0.5（慢网 10MB 需要更多余量）；弱网/省流模式不预取 |
| `index.html` | 内联静态首屏 splash（同色系占位，不放假按钮） |
| `server/index.ts` | 新增 Render 自身保活；静态资源按哈希分流缓存 |
| `scripts/_probe_mobile_latency.cjs` | 手机端延迟体检（原型层劫持媒体元素） |
| `scripts/_probe_tap_sound.cjs` | 点击→出声逐事件时间线 |
| `scripts/_test_media_concurrency.cjs` | 隔离实验：媒体并发是否互相饿死 |
| `scripts/_test_preload_strategy.cjs` | 四种起播策略对照 |

---

## 八、待办

- [ ] **部署**：本次全部改动尚未上线（Render `autoDeploy` 实测不生效，需 Dashboard → Manual Deploy）
- [ ] **音频重编码**：318kbps → 128kbps（需腾讯云密钥 + ffmpeg + 重传约 700MB）—— 唯一剩下的延迟杠杆
- [ ] 上一轮的封面瘦身 / blob 预取 / LLM 故障切换同样在等这次部署一并生效
- [ ] 轮换腾讯云密钥（承接上轮建议）
