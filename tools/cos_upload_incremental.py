"""
cos_upload_incremental.py — 增量上传曲库到 COS（只传云端没有的文件）

用法:
  python tools/cos_upload_incremental.py <SecretId> <SecretKey> <bucket-appid> <region>

行为:
  1. list_objects 拉取云端 songs/ 与 covers/ 的 key 集合
  2. 只上传本地有、云端没有的音频与封面（新增歌 → 秒级完成，不必重传 1.1GB）
  3. 最后总是重传 manifest.json（曲库清单变了）
  4. 抽样公开 URL 验证

依赖: pip install cos-python-sdk-v5
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

BASE = r"D:\Workspace\AI工作空间仓库\ai-radio"
DEFAULT_BUCKET = "ai-radio-library-1463614289"
DEFAULT_REGION = "ap-nanjing"


def _upload_one(c, bucket, key, local_path, content_type):
    for attempt in range(3):
        try:
            with open(local_path, "rb") as f:
                r = c.put_object(Bucket=bucket, Key=key, Body=f, ContentType=content_type)
            return True, None, r.get("ETag")
        except Exception as e:
            err = str(e)[:200]
            time.sleep(1.5 * (attempt + 1))
    return False, err, None


def _list_keys(c, bucket, prefix):
    """列出某前缀下所有 key（分页）"""
    keys = set()
    marker = ""
    while True:
        r = c.list_objects(Bucket=bucket, Prefix=prefix, Marker=marker, MaxKeys=1000)
        for o in r.get("Contents", []) or []:
            keys.add(o["Key"])
        if r.get("IsTruncated") == "true":
            marker = r.get("NextMarker", "")
        else:
            break
    return keys


def _verify(url, timeout=30):
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, int(r.headers.get("Content-Length", 0))
    except Exception as e:
        return None, str(e)[:120]


def _read_key_file(path):
    """读密钥文件，容错各种编码/格式（记事本存 UTF-16/带 BOM 是常见坑）"""
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = raw.decode("utf-16")            # 记事本「Unicode」/ 默认 UTF-16 LE
    elif raw.startswith(b"\xef\xbb\xbf"):
        text = raw.decode("utf-8-sig")         # UTF-8 with BOM
    else:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-16", errors="ignore")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip().strip('"').strip("'").strip() for ln in text.split("\n")]
    return [ln for ln in lines if ln]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("secret_id", nargs="?", default="", help="SecretId（或用 --from-file）")
    ap.add_argument("secret_key", nargs="?", default="", help="SecretKey（或用 --from-file）")
    ap.add_argument("bucket", nargs="?", default=DEFAULT_BUCKET, help=f"桶名（默认 {DEFAULT_BUCKET}）")
    ap.add_argument("region", nargs="?", default=DEFAULT_REGION, help=f"地域（默认 {DEFAULT_REGION}）")
    ap.add_argument("--from-file", dest="from_file", default=None,
                    help="密钥文件路径：第 1 行 SecretId，第 2 行 SecretKey（密钥不进命令行/历史）")
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()

    if args.from_file:
        if not os.path.isfile(args.from_file):
            print(f"[ERR] 密钥文件不存在：{args.from_file}")
            print("      （注意用 Windows 路径，例如 D:\\_cos_key.txt）")
            sys.exit(2)
        lines = _read_key_file(args.from_file)
        if len(lines) < 2:
            print(f"[ERR] 密钥文件需两行：第1行 SecretId，第2行 SecretKey（当前读到 {len(lines)} 行）")
            sys.exit(2)
        secret_id, secret_key = lines[0], lines[1]
    else:
        secret_id, secret_key = args.secret_id.strip(), args.secret_key.strip()
    if not secret_id or not secret_key:
        print("[ERR] 缺少密钥：传两个位置参数，或使用 --from-file <密钥文件>")
        sys.exit(2)

    cfg = CosConfig(Region=args.region, SecretId=secret_id, SecretKey=secret_key)
    client = CosS3Client(cfg)

    manifest_path = os.path.join(BASE, "library", "manifest.json")
    songs_dir = os.path.join(BASE, "library", "songs")
    covers_dir = os.path.join(BASE, "library", "covers")

    with open(manifest_path, encoding="utf-8") as fp:
        m = json.load(fp)

    print(f"目标桶 {args.bucket} @ {args.region} | 清单 {len(m['songs'])} 首")
    print("拉取云端已有 key…")
    try:
        remote_songs = _list_keys(client, args.bucket, "songs/")
        remote_covers = _list_keys(client, args.bucket, "covers/")
    except Exception as e:
        msg = str(e)
        print(f"[ERR] 无法访问 COS：{msg[:300]}")
        if any(k in msg for k in ("AccessDenied", "SignatureDoesNotMatch", "403", "InvalidAccessKeyId")):
            print("      → 密钥或权限问题：确认 SecretId/SecretKey 正确，且该子账号已授权桶 "
                  f"'{args.bucket}' 的读写权限")
        elif any(k in msg for k in ("NoSuchBucket", "404")):
            print(f"      → 桶名或地域不匹配：确认桶 '{args.bucket}' 与地域 '{args.region}'")
        else:
            print("      → 请检查网络、密钥与桶名/地域")
        sys.exit(1)
    print(f"  云端已有: songs/ {len(remote_songs)} 个, covers/ {len(remote_covers)} 个")

    # 1) 音频（单层编码，与后端 encodeURIComponent(file) 对应）
    todo_songs = []
    for s in m["songs"]:
        key = "songs/" + s["file"]
        if key not in remote_songs:
            todo_songs.append((key, os.path.join(songs_dir, s["file"])))

    # 2) 封面
    todo_covers = []
    for s in m["songs"]:
        pic = s.get("picUrl")
        if not pic:
            continue
        if pic not in remote_covers:
            todo_covers.append((pic, os.path.join(BASE, "library", pic.replace("/", os.sep))))

    print(f"\n待上传: 音频 {len(todo_songs)} 个, 封面 {len(todo_covers)} 个")
    if not todo_songs and not todo_covers:
        print("云端已是最新，只需重传 manifest.json")

    ok = fail = 0
    failed = []
    t0 = time.time()
    jobs = [(k, p, "audio/mpeg") for k, p in todo_songs] + [
        (k, p, "image/jpeg" if p.lower().endswith((".jpg", ".jpeg")) else "image/png")
        for k, p in todo_covers
    ]
    if jobs:
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            futs = {ex.submit(_upload_one, client, args.bucket, k, p, ct): (k, p) for k, p, ct in jobs}
            done = 0
            for fut in as_completed(futs):
                k, p = futs[fut]
                done += 1
                try:
                    success, err, _ = fut.result()
                except Exception as e:
                    success, err = False, str(e)[:160]
                if success:
                    ok += 1
                else:
                    fail += 1
                    failed.append((k, err))
                    print(f"  [FAIL] {k}: {err}")
                if done % 5 == 0 or done == len(jobs):
                    print(f"  进度 {done}/{len(jobs)} | 成功 {ok} 失败 {fail} | {time.time()-t0:.0f}s")
        print(f"\n上传完成: {ok} 成功 / {fail} 失败，用时 {time.time()-t0:.0f}s")

    # 3) manifest.json 总是重传
    ms_ok, ms_err, _ = _upload_one(client, args.bucket, "manifest.json", manifest_path, "application/json")
    print(f"manifest.json: {'OK' if ms_ok else 'FAIL ' + str(ms_err)}")

    # 4) 抽样验证（新增的歌 + 对应封面）
    prefix = f"https://{args.bucket}.cos.{args.region}.myqcloud.com/"
    samples = [s for s in m["songs"] if s["id"] in {x[0] for x in [(f"L{n:04d}", 0) for n in range(98, 108)]}]
    if not samples:
        samples = m["songs"][-10:]
    checks = [("manifest.json", prefix + "manifest.json")]
    for s in samples:
        checks.append((s["file"], prefix + "songs/" + urllib.parse.quote(s["file"], safe="")))
        if s.get("picUrl"):
            checks.append((s["picUrl"], prefix + "/".join(urllib.parse.quote(p, safe="") for p in s["picUrl"].split("/"))))

    print("\n=== 公开 URL 验证 ===")
    vok = 0
    for name, url in checks:
        st, info = _verify(url)
        if st == 200:
            vok += 1
            print(f"  [200 OK] {name} ({info} bytes)")
        else:
            print(f"  [FAIL] {name}: {st} {info}")
    print(f"\n=== 验证 {vok}/{len(checks)} 通过 ===")

    if fail or not ms_ok or vok != len(checks):
        sys.exit(1)
    print(f"\n✅ 曲库已更新到云端（{m['total']} 首）  COS_BASE_URL = {prefix[:-1]}")


if __name__ == "__main__":
    main()
