"""
COS 音乐库批量上传脚本 v3（用腾讯云官方 SDK 实现）

用法：
  python tools/cos_upload.py <SecretId> <SecretKey> <bucket-appid> <region> [--concurrency 8]

示例：
  python tools/cos_upload.py AKIDxxxx SECRETKEYxxx ai-radio-library-1463614289 ap-nanjing

依赖：
  pip install cos-python-sdk-v5
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from qcloud_cos import CosConfig, CosS3Client


def _upload_one(c: CosS3Client, bucket: str, cos_key: str, local_path: str, content_type: str):
    """单文件上传，封装 put_object，自动 retry"""
    retries = 3
    last = None
    for attempt in range(retries):
        try:
            with open(local_path, "rb") as f:
                r = c.put_object(Bucket=bucket, Key=cos_key, Body=f, ContentType=content_type)
            return True, None, r["ETag"]
        except Exception as e:
            last = str(e)[:200]
            time.sleep(1.5 * (attempt + 1))
    return False, last, None


def _verify_public(url: str, timeout=30):
    """公开 HEAD 验证（公有读桶）"""
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, int(r.headers.get("Content-Length", 0))
    except Exception as e:
        return None, str(e)[:120]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("secret_id")
    ap.add_argument("secret_key")
    ap.add_argument("bucket")
    ap.add_argument("region")
    ap.add_argument("--concurrency", type=int, default=8)
    args = ap.parse_args()

    cfg = CosConfig(Region=args.region, SecretId=args.secret_id, SecretKey=args.secret_key)
    client = CosS3Client(cfg)

    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    manifest_path = os.path.join(base, "library", "manifest.json")
    songs_dir = os.path.join(base, "library", "songs")
    m = json.load(open(manifest_path, encoding="utf-8"))
    total = len(m["songs"])

    print(f"目标桶: {args.bucket} | 地域: {args.region}")
    print(f"歌曲总数: {total} | 并发: {args.concurrency} | SDK 已连接\n")

    # 1) 并发上传歌曲
    ok = fail = 0
    failed_files = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = {}
        for s in m["songs"]:
            local = os.path.join(songs_dir, s["file"])
            # 单层编码：cos-python-sdk-v5 内部会再做一次 URL 编码，
            # 若我们预编码 → 桶里 Key 是双层编码，与后端 encodeURIComponent(file) 对不上
            cos_key = "songs/" + s["file"]
            futs[ex.submit(_upload_one, client, args.bucket, cos_key, local, "audio/mpeg")] = s["file"]
        done = 0
        for fut in as_completed(futs):
            fn = futs[fut]
            done += 1
            try:
                success, err, etag = fut.result()
            except Exception as e:
                success, err = False, str(e)[:160]
            if success:
                ok += 1
            else:
                fail += 1
                failed_files.append((fn, err))
                print(f"  [FAIL] {fn}: {err}")
            if done % 10 == 0 or done == total:
                el = time.time() - t0
                print(f"  进度 {done}/{total} | 成功 {ok} 失败 {fail} | 用时 {el:.0f}s")
    el = time.time() - t0
    print(f"\n歌曲上传完成: {ok} 成功 / {fail} 失败 | 用时 {el:.0f}s")

    # 2) manifest.json
    ms_ok, ms_err, _ = _upload_one(client, args.bucket, "manifest.json", manifest_path, "application/json")
    print(f"manifest.json: {'OK' if ms_ok else 'FAIL ' + str(ms_err)}")

    # 3) 验证（抽样 8 首 + manifest）
    print("\n=== 公开 URL 验证 ===")
    prefix = f"https://{args.bucket}.cos.{args.region}.myqcloud.com/"
    checks = [("manifest.json", prefix + "manifest.json")]
    samples = [s["file"] for s in m["songs"][:5]] + [s["file"] for s in m["songs"][-3:]]
    for f in samples:
        checks.append((f, prefix + "songs/" + urllib.parse.quote(f, safe="")))
    vok = 0
    for name, url in checks:
        st, info = _verify_public(url)
        if st == 200:
            vok += 1
            print(f"  [200 OK] {name} ({info} bytes)")
        else:
            print(f"  [FAIL] {name}: {st} {info}")

    # 总结
    print(f"\n=== 验证: {vok}/{len(checks)} 通过 ===")
    if failed_files:
        print(f"\n失败列表 ({len(failed_files)}):")
        for fn, err in failed_files[:10]:
            print(f"  - {fn}: {err}")
    if ok == total and ms_ok:
        print(f"\n✅ 全部就绪！COS_BASE_URL = {prefix[:-1]}")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
