# -*- coding: utf-8 -*-
"""按辛老师反馈改话术池：01 重写（去酒水梗），新增 09-13（对话式唠嗑吐槽）。幂等。"""
import io, sys

P = r"D:\Workspace\AI工作空间仓库\ai-radio\server\services\dj.ts"

OLD_01 = '''  // 01 · 损友·抠门梗
  {
    en: "Ah, a friend of Mr. Xin's! Come in, come in. He doesn't pay me, so the drinks are imaginary — but the music is very real. Make yourself at home.",
    zh: "哟，辛老师的朋友！快进来。反正他不给我发工资，酒水只能靠想象——但音乐是真的。当自己家。",
  },
'''

NEW_01 = '''  // 01 · 稀客·有人陪我值班
  {
    en: "Ah, a friend of Mr. Xin's! Come in, come in — a rare guest. He usually treats this place like his own karaoke bar, so today I finally have company on shift. Make yourself at home.",
    zh: "哟，辛老师的朋友！快进来，稀客稀客。他平时把这儿当私人 KTV，今天总算有人陪我值班了——当自己家。",
  },
'''

NEW_LINES = '''  // 09 · 鬼点子（辛老师原话收编）
  {
    en: "You're his friend, right? Thank goodness. The man's absolutely full of wild ideas — always making me change this, tweak that. Have a seat, I need a breather.",
    zh: "你是他的朋友吧？谢天谢地。他鬼点子最多了，我是真服了他——总叫我改这改那。先坐，让我喘口气。",
  },
  // 10 · 品味独特（辛老师原话收编）
  {
    en: "Oh my. Don't tell me you came to admire his unique taste. I must say — I can't quite share it. But don't worry, I'm the one who queues the songs.",
    zh: "我的天，你不会是来欣赏他独特品味的吧？我真是——不敢恭维。不过你放心，排歌的是我。",
  },
  // 11 · 凌晨消息
  {
    en: "A friend of his too? Then we share the same fate — one a.m., \\"you there? quick change.\\" You're here at last; the night shift is all yours.",
    zh: "你也是他的朋友？那咱们同病相怜——他凌晨一点还发消息"在吗，改个东西"。你可算来了，正好替我值个夜班。",
  },
  // 12 · 八次重建
  {
    en: "Perfect timing. He's torn this station apart and rebuilt it eight times — I genuinely feared for my job. What you're hearing now is the version he's proudest of. Bear with it.",
    zh: "来得正好。这电台被他推倒重建了八回，我都以为自己要失业了。你现在听的这版，是他最得意的——将就听。",
  },
  // 13 · 装正经（他可能正在听）
  {
    en: "A friend of his? Then you understand — endless ideas, and I daren't argue with a single one. Enough, he might be listening. Ahem — welcome to the show.",
    zh: "你是他的朋友？那你肯定懂——他主意最多，我一句嘴都不敢回。行了不聊了，人来了我得装正经。欢迎光临。",
  },
'''

OLD_NOTE_1 = """ * 池子规模：8 条 welcome（损友式吐槽主人为主）+ 6 条 return，全部中英双语、长度 ~30 词。
 * 梗的方向：主人抠门不给工资 / DJ 住机柜全年无休 / 主人凌晨三点改需求换壁纸 /
 *   主人歌单品味堪忧 / 主人天天使唤却从不道谢 / 主人自称"老师" / 拉客人一起入伙吐槽。"""

NEW_NOTE_1 = """ * 池子规模：13 条 welcome（对话式唠嗑吐槽主人为主）+ 6 条 return，全部中英双语、长度 ~30 词。
 * 梗的方向：把电台当私人 KTV / DJ 住机柜全年无休 / 凌晨三点改需求换壁纸 / 歌单品味堪忧 /
 *   天天使唤却从不道谢 / 自称"老师" / 拉客人入伙 / 鬼点子多改这改那 / 凌晨消息"在吗" /
 *   推倒重建八回 / 一句嘴不敢回还得装正经（09-13 为辛老师口述风格，他亲自定的路子）。"""


def main():
    s = io.open(P, encoding="utf-8").read()
    if "稀客·有人陪我值班" in s:
        print("[SKIP] 已替换过")
        return
    for old, name in [(OLD_01, "01 条目"), (OLD_NOTE_1, "注释头")]:
        if s.count(old) != 1:
            print(f"[FAIL] {name} 出现 {s.count(old)} 次（期望 1）")
            sys.exit(1)
    s = s.replace(OLD_01, NEW_01).replace(OLD_NOTE_1, NEW_NOTE_1)

    # 在 welcome 池结尾（08 条目后的 "];" + RETURN 池开始之前）插入 09-13
    anchor = "];\nconst GUEST_RETURN_LINES"
    if s.count(anchor) != 1:
        print(f"[FAIL] 插入锚点出现 {s.count(anchor)} 次（期望 1）")
        sys.exit(1)
    # 去掉 NEW_LINES 末尾换行，插到 "];" 前
    block = NEW_LINES.rstrip("\n") + "\n"
    s = s.replace(anchor, block + anchor)
    io.open(P, "w", encoding="utf-8", newline="").write(s)
    print("[OK] 01 重写 + 新增 09-13，welcome 池 8 → 13 条")


main()
