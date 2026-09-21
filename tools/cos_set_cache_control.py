"""
cos_set_cache_control.py — 给 COS 曲库对象批量补上 Cache-Control

【为什么需要】
实测 songs/*.mp3 响应头 `cache-control = null` → 浏览器完全不缓存音频，
每次切歌都要把整首重新下载一遍（曲库平均 10.6MB/首，最大 16.6MB）。
这就是"切歌白屏 + 缓冲"的根因之一：资源没有任何本地复用。

对比：封面走 imageMogr2 处理后带 `max-age=2592000`（30 天），所以封面很快；音频没有。

【做法】
用 copy_object 把对象复制到自身（同桶同 key）并替换元数据 —— 腾讯云官方推荐的
"只改元数据"手法，纯服务端内部操作，不消耗上行带宽、不重传文件，秒级完成。

【用法】
  python tools/cos_set_cache_control.py --from-file D:\\_cos_key.txt
  python tools/cos_set_cache_control.py <SecretId> <SecretKey>

依赖: pip install cos-python-sdk-v5
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from qcloud_cos import CosConfig, CosS3Client

BASE = r"D:\Workspace\AI工作空间仓库\ai-radio"
DEFAULT_BUCKET = "ai-radio-library-1463614289"
DEFAULT_REGION = "ap-nanjing"

# 音频一年不变：让浏览器长期复用，切歌/重播零下载
AUDIO_CC = "public, max-age=31536000, immutable"
# 清单要短缓存：新歌热刷新靠它，别让中间层缓存太久
MANIFEST_CC = "public, max-age=60"


def _read_key_file(path):
    """读密钥文件，容错各种编码/格式（记事本存 UTF-16/带 BOM 是常见坑）"""
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = raw.decode("utf-16")
    elif raw.startswith(b"\xef\xbb\xbf"):
        text = raw.decode("utf-8-sig")
    else:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-16", errors="ignore")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip().strip('"').strip("'").strip() for ln in text.split("\n")]
    return [ln for ln in lines if ln]


def _set_one(c, bucket, key, cc):
    for attempt in range(3):
        try:
            c.copy_object(
                Bucket=bucket,
                Key=key,
                CopySource={"Bucket": bucket, "Key": key},
                MetadataDirective="REPLACE",
                CacheControl=cc,
            )
            return True, None
        except Exception as e:
            err = str(e)[:200]
            time.sleep(1.2 * (attempt + 1))
    return False, err


def _get_cc(c, bucket, key):
    try:
        r = c.head_object(Bucket=bucket, Key=key)
        return r.get("Cache-Control") or r.get("cache-control")
    except Exception as e:
        return f"ERR {str(e)[:80]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("secret_id", nargs="?", default="")
    ap.add_argument("secret_key", nargs="?", default="")
    ap.add_argument("bucket", nargs="?", default=DEFAULT_BUCKET)
    ap.add_argument("region", nargs="?", default=DEFAULT_REGION)
    ap.add_argument("--from-file", dest="from_file", default=None,
                    help="密钥文件：第 1 行 SecretId，第 2 行 SecretKey")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true", help="只打印将处理的 key")
    args = ap.parse_args()

    if args.from_file:
        if not os.path.isfile(args.from_file):
            print(f"[ERR] 密钥文件不存在：{args.from_file}")
            sys.exit(2)
        lines = _read_key_file(args.from_file)
        if len(lines) < 2:
            print(f"[ERR] 密钥文件需两行（读到 {len(lines)} 行）")
            sys.exit(2)
        secret_id, secret_key = lines[0], lines[1]
    else:
        secret_id, secret_key = args.secret_id.strip(), args.secret_key.strip()
    if not secret_id or not secret_key:
        print("[ERR] 缺少密钥：用 --from-file 或传两个位置参数")
        sys.exit(2)

    client = CosS3Client(CosConfig(Region=args.region, SecretId=secret_id, SecretKey=secret_key))

    with open(os.path.join(BASE, "library", "manifest.json"), encoding="utf-8") as fp:
        m = json.load(fp)

    jobs = [("songs/" + s["file"], AUDIO_CC) for s in m["songs"]]
    jobs.append(("manifest.json", MANIFEST_CC))

    print(f"桶 {args.bucket} @ {args.region} | 待处理 {len(jobs)} 个对象")
    if args.dry_run:
        for k, cc in jobs[:10]:
            print(f"  {k}  ->  {cc}")
        print(f"  …共 {len(jobs)} 个")
        return

    ok = fail = 0
    failed = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = {ex.submit(_set_one, client, args.bucket, k, cc): k for k, cc in jobs}
        done = 0
        for fut in as_completed(futs):
            k = futs[fut]
            done += 1
            try:
                success, err = fut.result()
            except Exception as e:
                success, err = False, str(e)[:160]
            if success:
                ok += 1
            else:
                fail += 1
                failed.append((k, err))
                print(f"  [FAIL] {k}: {err}")
            if done % 20 == 0 or done == len(jobs):
                print(f"  进度 {done}/{len(jobs)} | 成功 {ok} 失败 {fail} | {time.time()-t0:.0f}s")

    print(f"\n设置完成: {ok} 成功 / {fail} 失败，用时 {time.time()-t0:.0f}s")

    print("\n=== 抽样复核 Cache-Control ===")
    samples = [jobs[0][0], jobs[len(jobs) // 2][0], "manifest.json"]
    vok = 0
    for k in samples:
        cc = _get_cc(client, args.bucket, k)
        good = bool(cc) and "ERR" not in str(cc)
        vok += 1 if good else 0
        print(f"  [{'OK ' if good else 'FAIL'}] {k}  cache-control = {cc}")

    if fail or vok != len(samples):
        sys.exit(1)
    print(f"\n✅ 音频已可被浏览器长期缓存（{AUDIO_CC}）")


if __name__ == "__main__":
    main()
