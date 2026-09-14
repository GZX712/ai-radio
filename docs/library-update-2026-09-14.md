# 曲库更新记录 · 2026-09-14

## 来源

`D:\CloudMusic`（含 `VipSongsDownload\` 与 `U盘\` 子目录）

## 为什么"150 首"只导入 10 首

| 项目 | 数量 |
|---|---|
| ncm 文件（含 `(1)` 重复副本） | 151 |
| ↳ 去重后唯一曲目 | 84 |
| mp3 文件 | 45 |
| lrc 歌词文件（不是歌） | 193 |
| **去重后唯一曲目合计** | **107** |
| 曲库原有 | 97 |
| **本次新增** | **10** |
| 曲库有、文件夹没有 | 0（来源全部对得上） |

> 关键：网易云重复下载同一首歌会产生 `xxx (1).ncm` 副本，151 个 ncm 里 67 个是副本。

## 本次新增 10 首

| 曲库 ID | 歌手 | 歌名 |
|---|---|---|
| L0098 | Gareth.T | 玻璃 |
| L0099 | Gareth.T | 颜色 |
| L0100 | 梁博 | 出现又离开 (Live) |
| L0101 | 梁博 | 曾经是情侣 (Live) |
| L0102 | 赵雷 | 小行迹 |
| L0103 | 赵雷 | 朵儿 (Live版) |
| L0104 | 赵雷 | 玛丽 |
| L0105 | 赵雷 | 程艾影 |
| L0106 | 赵雷 | 船长 |
| L0107 | 忧郁小冻梨 | 越来越不懂dj（0.8） |

> 第 10 首在 `D:\CloudMusic\U盘\`，文件名是 `xxx.wav.mp3`（扩展名多了 `.wav`），
> 实际是标准 MP3（ID3 头），导入时已规范为 `.mp3`。

## 本地状态（已完成）

- `library/songs/` — **107 首**，合计 1113.5 MB
- `library/covers/` — **107 张**（ID3 APIC 提取，全部成功）
- `library/manifest.json` — total 已更新为 107，含 L0098–L0107 条目与 picUrl

校验命令与结果：

```bash
python tools/_verify_library.py
# manifest: total=107 实际条目=107
# 音频文件缺失: 0 ／ 异常偏小: 0 ／ 缺 picUrl: 0 ／ 封面文件问题: 0
# ✅ 校验通过，可以上传
```

## 下一步：上传到 COS（需要腾讯云密钥）

项目里**没有保存** SecretId/SecretKey（安全），密钥只能由你提供。三种方式：

### 方式 A · 你自己跑（推荐）

**1. 拿密钥**

腾讯云控制台 → 访问管理 CAM → API 密钥管理 → 新建密钥

- SecretId 形如 `AKIDxxxxxxxxxxxxxxxx`
- SecretKey **只在创建时完整显示一次**，务必先存好

> 💡 更稳的做法：新建一个**子账号**（CAM 用户），只授权桶 `ai-radio-library-1463614289`
> 的读写权限，用这个子账号的密钥上传。这样即使密钥外流，损失也止于这一个桶。

**2. 把密钥写进一个文件**（放仓库外，例如 `D:\_cos_key.txt`），两行：

```
AKIDxxxxxxxxxxxxxxxx
SecretKeyxxxxxxxxxxxxxxxxxxxxxxxx
```

**3. 执行**

```bash
cd D:\Workspace\AI工作空间仓库\ai-radio
python tools\cos_upload_incremental.py --from-file D:\_cos_key.txt
```

> 桶名与地域已有默认值（`ai-radio-library-1463614289` / `ap-nanjing`），无需再传。
> 也支持老写法直接传参：`python tools/cos_upload_incremental.py <SecretId> <SecretKey>`

**4. 跑完删掉密钥文件**

### 方式 B · 我帮你跑（密钥不进对话）

你把密钥写进 `D:\_cos_key.txt`，跟我说一声即可。我会：

1. 执行 `cos_upload_incremental.py --from-file D:\_cos_key.txt`
2. **不读取、不打印文件内容**（脚本只做上传，不回显密钥）
3. 跑完帮你删除该文件

这样密钥既不进入对话记录，也不留在磁盘上。

### 方式 C · 密钥直接发我（最省事，但最不推荐）

⚠️ 密钥发在对话里会**留存在会话记录中**，等于多一份副本；事后建议去控制台轮换。

---

### 脚本行为

**增量**上传：先 `list_objects` 比对云端已有哪些文件，只传缺的
（本次约 10 首音频 + 10 张封面 + `manifest.json`，约 120MB，不会重传 1.1GB），
最后自动抽样验证新增文件的公开 URL 并打印结果。

> 若要用全量上传（脚本较老、会重传 1.1GB）：`python tools/cos_upload.py <id> <key> <bucket> ap-nanjing`

> ⚠️ 路径提示：`--from-file` 必须用 **Windows 风格路径**（`D:\_cos_key.txt`）。
> Python 是原生 Windows 程序，不认 Git Bash 的 `/tmp`、`/d/` 这类路径。
> 这是本项目踩过的老坑（`ncmdump.exe` 同样如此）。

## 上传后如何生效

后端 COS 模式每次启动/刷新会重新拉 `manifest.json`，上传完刷新页面即可看到新歌。
线上 `https://ai-radio-server.onrender.com/api/health` 的 `queue` 字段可直接看到曲库总数变化（97 → 107）。

## 附：本次用到的工具

| 脚本 | 用途 |
|---|---|
| `tools/_import_songs.py` | 解密产物导入曲库 + 更新 manifest（幂等） |
| `tools/_verify_library.py` | manifest ↔ songs ↔ covers 三方一致性校验 |
| `tools/cos_upload_incremental.py` | **增量**上传，只传云端缺的文件 |
| `tools/ncmdump/ncmdump.exe` | ncm 解密（注意：不认 Git Bash 的 `/d/` 路径，用 `D:/`） |
