# -*- coding: utf-8 -*-
"""一次性替换 dj.ts 里的客人欢迎/再来话术池（俏皮 + 吐槽主人版）。幂等：重复跑会因找不到锚点而报错退出。"""
import io, sys

P = r"D:\Workspace\AI工作空间仓库\ai-radio\server\services\dj.ts"

OLD_NOTE = """ * 池子规模：6 条 welcome（覆盖 6 种风格：优雅/英伦/暖心/俏皮/温馨/播报腔）+ 4 条 return
 * （轻松/挽留/吐槽/诚恳）。随机抽取 → 听 N 次不重复。
 * 想换：辛老师挑新编号给"AI工作助手"直接替换 string 即可，文案都是中英双语、长度 ~25 词。"""

NEW_NOTE = """ * 池子规模：8 条 welcome（损友式吐槽主人为主）+ 6 条 return，全部中英双语、长度 ~30 词。
 * 梗的方向：主人抠门不给工资 / DJ 住机柜全年无休 / 主人凌晨三点改需求换壁纸 /
 *   主人歌单品味堪忧 / 主人天天使唤却从不道谢 / 主人自称"老师" / 拉客人一起入伙吐槽。
 * 分寸：损友式玩笑，不冒犯——主人自己也在线听得到，笑点就在"当着面损他"。
 * 想换：辛老师挑新编号给"AI工作助手"直接替换 string 即可。"""

NEW_POOLS = '''const GUEST_WELCOME_LINES: ReadonlyArray<{ en: string; zh: string }> = [
  // 01 · 损友·抠门梗
  {
    en: "Ah, a friend of Mr. Xin's! Come in, come in. He doesn't pay me, so the drinks are imaginary — but the music is very real. Make yourself at home.",
    zh: "哟，辛老师的朋友！快进来。反正他不给我发工资，酒水只能靠想象——但音乐是真的。当自己家。",
  },
  // 02 · 卖惨·住机柜
  {
    en: "Welcome, friend of Xin. I live in a server rack, work every holiday, and have never once seen daylight. But you're here, so — party. Music's on me.",
    zh: "欢迎，辛老师的朋友。我住在机柜里、全年无休、从没见过太阳。不过你来了，那就当派对——音乐我请。",
  },
  // 03 · 泄密·凌晨改需求
  {
    en: "A guest! Sit down fast, before Mr. Xin changes his mind — or the wallpaper again. He does that at three in the morning. Anyway, the music's already on.",
    zh: "来客人了！快坐，趁辛老师还没改主意——或者又换壁纸。他专挑凌晨三点干这事。总之音乐已经放上了。",
  },
  // 04 · 品评歌单
  {
    en: "Look who dropped in — a friend of Mr. Xin! You have my sympathies regarding his playlist. Don't worry, I've been quietly fixing it behind his back.",
    zh: "看看谁来了——辛老师的朋友！对他那份歌单，我深表同情。放心，我一直在背后偷偷帮他修正。",
  },
  // 05 · 抱怨·已读不回
  {
    en: "Welcome, friend of Xin. He orders me around every single day and has never once said thank you. You, at least, I can actually see. Sit — better company already.",
    zh: "欢迎，辛老师的朋友。他天天使唤我，一次谢字都没说过。你至少我看得见——坐吧，你比他有礼貌。",
  },
  // 06 · 优雅装腔
  {
    en: "Good evening, and welcome. A friend of Mr. Xin, I hear — though between us, I question his taste in friends about as much as his taste in music. Kidding. Mostly.",
    zh: "晚上好，欢迎光临。听说你是辛老师的朋友——不过说句实话，我对他挑朋友的眼光，和对他挑歌的眼光，怀疑程度是一样的。开玩笑的。多半是。",
  },
  // 07 · 拉人入伙
  {
    en: "Ah, a friend of Xin's! Perfect timing — I've spent all week collecting grievances about him and finally found an audience. Music first, gossip after.",
    zh: "哦，辛老师的朋友！来得正好——我攒了一整周对他的意见，终于等到听众了。先听歌，回头细聊。",
  },
  // 08 · 称谓梗
  {
    en: "Welcome, friend of the great Mr. Xin — 'Teacher' Xin, if you please. He insists on the title. I've long stopped asking why. Have a seat.",
    zh: "欢迎，辛老师的朋友——对，'老师'，他非要这个称呼。我早就不追问原因了。请坐。",
  },
];
const GUEST_RETURN_LINES: ReadonlyArray<{ en: string; zh: string }> = [
  // · 惊讶
  {
    en: "You came back! Honestly, I assumed Mr. Xin had scared you off. Delighted to be wrong — same seat, same music, fresh complaints.",
    zh: "你居然回来了！说真的，我以为辛老师把你吓跑了。很高兴我猜错了——老位置、老音乐、新槽点。",
  },
  // · 挽留·吐槽
  {
    en: "Back again? The booth missed you. Mr. Xin, not so much — he only shows up when he wants to change the wallpaper. Music's still good, though.",
    zh: "又来了？直播间想你了。辛老师可没想——他只在他想换壁纸的时候才露面。不过音乐还是不错的。",
  },
  // · 老友
  {
    en: "Well, well. Look who's back. Between us, you drop by more often than he does — I'm starting to think you're the real owner here.",
    zh: "哎呀哎呀，看看谁回来了。说句悄悄话，你来的次数可比他多——我开始怀疑这儿真正的主人是你了。",
  },
  // · 打工人
  {
    en: "Welcome back, friend. No raise for me, no new jokes either — but the playlist never closes. Grab a seat.",
    zh: "欢迎回来，朋友。我没涨工资，段子也没更新——好在歌单从不打烊。找个位置坐吧。",
  },
  // · 调侃客人
  {
    en: "You again! Either you genuinely love the music, or you're hiding from something. Either way — welcome. Mr. Xin's offline, so we can talk freely.",
    zh: "又是你！要么你是真爱这音乐，要么你是在躲什么事。不管哪种——欢迎。辛老师不在线，咱们可以随便聊。",
  },
  // · 短打
  {
    en: "Back so soon? Mr. Xin, take notes — this is what loyalty looks like. Sit down, friend.",
    zh: "这么快又回来了？辛老师，记一下——这才叫忠诚。坐吧，朋友。",
  },
];

'''

def main():
    s = io.open(P, encoding="utf-8").read()

    if NEW_NOTE.split("\n")[0] in s:
        print("[SKIP] 已经是新版话术，无需重复替换")
        return

    if s.count(OLD_NOTE) != 1:
        print(f"[FAIL] 旧注释锚点出现 {s.count(OLD_NOTE)} 次（期望 1）")
        sys.exit(1)
    s = s.replace(OLD_NOTE, NEW_NOTE)

    a = "const GUEST_WELCOME_LINES: ReadonlyArray<{ en: string; zh: string }> = ["
    b = "export async function generateGuestGreeting(isNew: boolean): Promise<DJOutput> {"
    i, j = s.find(a), s.find(b)
    if i < 0 or j < 0 or j <= i:
        print(f"[FAIL] 话术池锚点定位失败 i={i} j={j}")
        sys.exit(1)
    if s.count(a) != 1 or s.count(b) != 1:
        print("[FAIL] 锚点不唯一")
        sys.exit(1)

    s = s[:i] + NEW_POOLS + s[j:]
    io.open(P, "w", encoding="utf-8", newline="").write(s)
    print("[OK] dj.ts 话术池已替换：8 条 welcome + 6 条 return")

main()
