# -*- coding: utf-8 -*-
"""话术池 v3：按辛老师口述新增 14 畅所欲言 / 15 正常。welcome 13 → 15 条。幂等。"""
import io, sys

P = r"D:\Workspace\AI工作空间仓库\ai-radio\server\services\dj.ts"

NEW_LINES = '''  // 14 · 畅所欲言（辛老师原话收编）
  {
    en: "A new friend, I take it? No need to hold back — I was just about to complain about him myself. Here, speak freely.",
    zh: "你是新来的朋友吗？没关系的，我正好也想吐槽他——这里可以畅所欲言。",
  },
  // 15 · 正常（辛老师原话收编）
  {
    en: "You seem far more normal than he is. Really.",
    zh: "你看起来比他正常多了，真的。",
  },
'''

OLD_NOTE = " * 池子规模：13 条 welcome（对话式唠嗑吐槽主人为主）+ 6 条 return，全部中英双语、长度 ~30 词。"
NEW_NOTE = " * 池子规模：15 条 welcome（对话式唠嗑吐槽主人为主）+ 6 条 return，全部中英双语、长度 ~30 词。"


def main():
    s = io.open(P, encoding="utf-8").read()
    if "畅所欲言" in s:
        print("[SKIP] 已替换过")
        return
    anchor = "];\nconst GUEST_RETURN_LINES"
    if s.count(anchor) != 1:
        print(f"[FAIL] 锚点出现 {s.count(anchor)} 次")
        sys.exit(1)
    if s.count(OLD_NOTE) != 1:
        print(f"[FAIL] 注释头出现 {s.count(OLD_NOTE)} 次")
        sys.exit(1)
    s = s.replace(OLD_NOTE, NEW_NOTE)
    s = s.replace(anchor, NEW_LINES.rstrip("\n") + "\n" + anchor)
    io.open(P, "w", encoding="utf-8", newline="").write(s)
    print("[OK] 新增 14/15，welcome 池 13 → 15 条")


main()
