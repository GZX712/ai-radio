"""
COS 音乐库批量上传脚本（备用：辛老师选择用脚本而不是网页拖拽时使用）

用法：
  python tools/cos_upload.py <SecretId> <SecretKey> <bucket-appid> <region>

示例：
  python tools/cos_upload.py AKIDxxxx SECRETKEYxxx ai-radio-library-1250000000 ap-chengdu

流程：
  1. 读取 library/manifest.json
  2. 逐个上传 library/songs/ 下文件到 COS songs/ 目录（ContentType audio/mpeg）
  3. 上传 manifest.json 到桶根目录
  4. 打印所有公开 URL 供验证
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------- COS 签名（腾讯云签名算法 v5）----------
def hmac_sha1(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha1).digest()


def sign(secret_id: str, secret_key: str, method: str, path: str, params: dict, headers: dict, region: str) -> str:
    now = datetime.now(timezone.utc)
    start = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    end = (now.replace(minute=0, second=0) + __import__("datetime").timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

    def qe(s: str) -> str:
        return urllib.parse.quote(s, safe="-_.~")

    # 1. KeyTime / SignKey
    key_time = f"{start};{end}"
    sign_key = hmac_sha1(secret_key.encode(), key_time).hex()

    # 2. HttpString
    http_method = method.lower()
    http_uri = path  # 已编码
    # query 参数
    qk = sorted(params.keys())
    http_query = "&".join(f"{qe(k)}={qe(params[k])}" for k in qk)
    # header 参数（host 必带）
    hk = sorted(headers.keys())
    http_headers = "&".join(f"{qe(k.lower())}={qe(headers[k])}" for k in hk)
    http_string = f"{http_method}\n{http_uri}\n{http_query}\n{http_headers}\n"

    # 3. StringToSign
    sha1_http = hashlib.sha1(http_string.encode()).hexdigest()
    string_to_sign = f"sha1\n{key_time}\n{sha1_http}\n"

    # 4. Signature
    signature = hmac_sha1(bytes.fromhex(sign_key), string_to_sign).hex()

    # 5. Authorization
    signed_headers = ";".join(k.lower() for k in sorted(headers.keys()))
    auth = (f"q-sign-algorithm=sha1&q-ak={secret_id}&q-sign-time={key_time}"
            f"&q-key-time={key_time}&q-header-list={signed_headers}"
            f"&q-url-param-list={';'.join(qk)}&q-signature={signature}")
    return auth


def upload_file(secret_id, secret_key, bucket, region, local_path, cos_key):
    """cos_key 是编码后的对象路径（如 songs/xxx.mp3）"""
    host = f"{bucket}.cos.{region}.myqcloud.com"
    url = f"https://{host}/{cos_key}"
    path = "/" + cos_key
    with open(local_path, "rb") as f:
        data = f.read()
    headers = {"host": host, "content-type": "audio/mpeg"}
    auth = sign(secret_id, secret_key, "PUT", path, {}, headers, region)
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Authorization", auth)
    for k, v in headers.items():
        if k != "host":
            req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status


def upload_json(secret_id, secret_key, bucket, region, local_path, cos_key):
    host = f"{bucket}.cos.{region}.myqcloud.com"
    url = f"https://{host}/{cos_key}"
    path = "/" + cos_key
    with open(local_path, "rb") as f:
        data = f.read()
    headers = {"host": host, "content-type": "application/json"}
    auth = sign(secret_id, secret_key, "PUT", path, {}, headers, region)
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Authorization", auth)
    for k, v in headers.items():
        if k != "host":
            req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)
    sid, skey, bucket, region = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    manifest_path = os.path.join(base, "library", "manifest.json")
    songs_dir = os.path.join(base, "library", "songs")
    m = json.load(open(manifest_path, encoding="utf-8"))

    ok = fail = 0
    for s in m["songs"]:
        local = os.path.join(songs_dir, s["file"])
        cos_key = "songs/" + urllib.parse.quote(s["file"], safe="")
        try:
            upload_file(sid, skey, bucket, region, local, cos_key)
            ok += 1
            print(f"[OK] {s['file']}")
        except Exception as e:
            fail += 1
            print(f"[FAIL] {s['file']}: {e}")
    # manifest.json 到根
    try:
        upload_json(sid, skey, bucket, region, manifest_path, "manifest.json")
        print("[OK] manifest.json")
    except Exception as e:
        print(f"[FAIL] manifest.json: {e}")

    print(f"\n=== 完成: {ok} 成功 / {fail} 失败 ===")
    if ok == len(m["songs"]):
        print(f"\n公开 URL 前缀: https://{bucket}.cos.{region}.myqcloud.com/songs/")


if __name__ == "__main__":
    main()
