# 手机端「完全无声」诊断与根治

日期：2026-09-25
现象：手机端音乐与 DJ 语音**一起没有声音**；PC 端正常。
线上版本：`9c6a684`（最新），非旧版。

---

## 一、先排除的项（都实测过，不是猜测）

| 检查项 | 结果 |
|---|---|
| 线上版本 | ✅ `/api/peek` 200、封面带 `imageMogr2`、`llm.active=deepseek` → **已是最新版本** |
| 服务端 DJ 音频 | ✅ `/api/dj/open` 200 / 7.4s，`audioUrl` 可达（206、90 KB、`audio/mpeg`）→ **服务端完全正常** |
| 代码近期变动 | ✅ 9/21 之后无提交，不是新代码引入的回归 |
| 封面 `<img>` 遮挡控件 | ❌ 排除：`.full-cover` 是 `.pixel-grid > .full-cover`，`z-index:1` 但限定在封面容器内 |
| 首屏 splash 吞点击 | ❌ 排除：`.is-gone` 已带 `pointer-events: none`，且 320 ms 后 `remove()` |
| Blob 缓存 revoke 误伤 | ❌ 排除：`pinPlayingAudio` 保护到位，本地复现走的是 COS 直链 |

---

## 二、根因（两条叠加，都只发生在「主人设备 + 手机」这条路径）

### 根因 1：`createMediaElementSource` 让两个通道一起哑

`createMediaElementSource(el)` **一旦调用就把该元素的音频重定向到 WebAudio graph，且不可回退**（再调会抛 `InvalidStateError`，元素也无法恢复默认输出）。

手机（iOS Safari / 安卓 WebView / 微信）在**没有用户手势**时 `AudioContext` 恒为 `suspended`，此时若已接线：

- 媒体层一切"正常"：`play()` resolve、`currentTime` 推进、UI 显示暂停键
- 但 WebAudio 一帧都输出不了 → **音乐与 DJ 两个通道一起静音**

**为什么会踩中**：主人设备（已绑）`started` 初值为 `true`，**直达播放器、页面上没有任何手势入口**，那唯一的解锁机会就不存在了。
**为什么 PC 正常**：Chrome 桌面版有 Media Engagement Index，常访问的站点会被直接放行 autoplay；手机没有这套机制。

### 根因 2：`await ctx.resume()` 把整条链路卡死

`loadAndPlay` / `handlePlay` / `playDj` / `playNextDj` 里共 **4 处** `await ctx.resume()`。

iOS 无手势时 `resume()` 返回的 promise **不是 reject，而是一直 pending**（等手势来才兑现）→ 播放流程卡在 `await` 上 → 25 秒超时兜底抛「播放超时」→ **音乐压根没开始播**。

---

## 三、修复

| 改动 | 说明 |
|---|---|
| 新增 `ensureGraph()` | 只在 `ctx.state === 'running'` 时才 `createMediaElementSource` 并接线；`wired` / `djWired` 分开记，一个失败不拖死另一个。`getNodes()` 不再无条件接线，改为调用它 |
| 新增 `tryResume()` | fire-and-forget，**任何地方都不 await**；4 处 `await ctx.resume()` 全部替换 |
| 导出 `isUnlocked()` | `ctx.state === 'running'`，供 App 判断 |
| App 轮询 + 手势兜底 | AudioContext 不会把 `statechange` 推给 React，故 700 ms 轮询；未解锁时挂**捕获式**手势监听，用户触碰页面任意位置即解锁并续播，解锁成功立即自摘（回避历史坑：全局 click 与暂停键竞态） |
| 可见提示条 | `.audio-lock-hint` 顶部居中（底部是播放控件区，放那边反而遮挡）。`开始 && 未解锁` 时显示，解锁后自动消失 |

**行为对照**

| 环境 | ctx 状态 | 接线 | 结果 |
|---|---|---|---|
| 电脑（ctx 创建即 running） | running | 立即接 | 与旧版**逐字一致**（duck、analyser 波形不变） |
| 手机（拿到手势） | resume 成功 | 解锁后接 | 完整效果 |
| 手机（始终无手势 / 被策略拒绝） | suspended | **不接** | 元素走默认输出，**至少有声音**（代价仅：DJ 说话时音乐不自动 duck、波形无数据） |

---

## 四、验证（`scripts/_verify_audio_unlock.cjs`，本地 COS 模式 107 首）

| 指标 | MODE=normal | MODE=locked（精确模拟 iOS 无手势） |
|---|---|---|
| 接入 WebAudio 的元素数 | **2** ✅ | **0** ✅（正确地不接线 → 元素默认输出） |
| 音频进度 | 3.68 → 15.76 s ✅ | 3.58 → 15.64 s ✅ **不再卡死** |
| 解锁提示条 | 不显示 ✅ | **显示** ✅ |
| 「超时/失败」提示 | 无 ✅ | 无 ✅ |
| 页面报错 | 无 ✅ | 无 ✅ |

`locked` 模式的构造：`Object.defineProperty` 把 `AudioContext.prototype.state` 钉死返回 `'suspended'`，并让 `resume()` 返回一个**永不兑现**的 promise。
**对照组**：修复前在此模式下，流程会停在 `await ctx.resume()` 直到 25 秒超时。

---

## 五、探针踩坑（已写进脚本注释，下次别再踩）

1. **Playwright 默认注入 `--autoplay-policy=no-user-gesture-required`**，会覆盖自己的严格策略，必须用 `ignoreDefaultArgs` 摘掉；否则会误判成"手机也没问题"
2. **headless Chromium 的 AudioContext 恒为 `running`**，无法复现 iOS 的 autoplay 限制 —— 手机专属问题别指望在 Chromium 里复现，要做"定向 patch 注入缺陷"来验证
3. **`createMediaElementSource` 定义在 `AudioContext.prototype`**（不是 `BaseAudioContext.prototype`，实测后者无该自有属性）→ patch 错原型会导致计数恒为 0，误判"从未接线"
4. `new Audio()` 是**游离元素**，`document.querySelector('audio')` 看不见 → 必须劫持 `HTMLMediaElement.prototype`
5. 采样要排除 `data:` 开头的**静音 wav**（解锁用），否则会把它当音乐，误判进度恒为 0

---

## 六、遗留（非本次问题、不影响修复）

- `src/lib/sfx.ts` 自建了**第二个 AudioContext**（音效用），iOS 上多个 AudioContext 需各自解锁，后续可考虑并入主 ctx
- 本次修复需**部署后生效**：Render `autoDeploy` 实测无效，需 Dashboard → Manual Deploy
- 部署前的临时办法：用**无痕窗口**打开（无 bond → 客人模式 → 有「开始电台」按钮 → 那道同步手势能让 `unlock()` 生效）

---

## 七、涉及文件

```
src/hooks/useAudioEngine.ts    ensureGraph / tryResume / isUnlocked，4 处 await 移除
src/App.tsx                    解锁轮询 + 捕获式手势兜底 + 提示条
src/index.css                  .audio-lock-hint
scripts/_diag_mobile_sound.cjs  无声问题诊断探针（MODE × ROLE 四象限）
scripts/_verify_audio_unlock.cjs 修复验证（normal / locked）
```
