/**
 * 切歌话术池（djScripts）
 * [2026-09-07] 辛老师反馈三连：
 *   1) 歌曲介绍出错（张冠李戴/念怪/跑题）——根因是旧切歌话术让 LLM 拿歌名猜节奏自由发挥 + 档案幻觉
 *   2) 话术太单一——固定 5 句 mp3 过渡语 + phraseBank 冷笑话来回听
 *   3) 没人味、不接地气——要星期梗/时段/节气/中国式生活梗
 *
 * 本模块：纯模板 + 运行时变量（0 LLM 调用 → 不会幻觉、不会编歌、不会张冠李戴）。
 * - 切入点池：歌本身(客观转述不猜) / 星期梗(周一~周日) / 时段梗(早中晚深夜) /
 *             天气节气(一句带过) / 冷笑话无厘头 —— 随机轮抽
 * - 念歌名规则：仅当歌名是纯 ASCII（英文/数字）才偶尔念（en 语音能正确读）；
 *   含 CJK 或其他非拉丁字符一律不念 → 杜绝"英文音色念中文歌名"的怪声
 * - en 语音句 + zh 字幕句成对给出，由调用方决定最终 TTS 读哪种（与聊天回复一致）
 */

export interface TransitionScriptInput {
  song?: { name: string; artist: string } | null;
  weather?: { city: string; description: string; temperature: number } | null;
  /** 北京时间小时 0-23 */
  hour: number;
  /** 星期：0=周日 1=周一 ... 6=周六 */
  weekday: number;
}

export interface TransitionScript {
  en: string;
  zh: string;
  /** 是否搞笑话术（切歌冷笑话标记 funny，前端可配罐头笑声） */
  funny: boolean;
}

/** 歌名是否"可念"：纯 ASCII 可打印字符（英文/数字/标点）→ en 语音能自然读出 */
function speakableTitle(name: string): boolean {
  return /^[\x20-\x7E]+$/.test(name) && /[A-Za-z0-9]/.test(name);
}

// ============ 歌本身（客观转述，不猜风格不编故事）============
// 仅在歌名可念时把 {title} 替换成真名；不可念 → 用"这一首/下一首"模糊指代
const SONG_LINES: Array<{ en: string; zh: string }> = [
  { en: "And now, {title}. A change of scenery for your ears — enjoy.", zh: "接下来{title}，给耳朵换个风景，慢慢享受。" },
  { en: "{title} coming your way. No spoilers — just press play and feel it.", zh: "{title}这就来。不剧透——按播放，用心感受。" },
  { en: "Next up, {title}. I won't tell you what to think — the music will do the talking.", zh: "下一首{title}。我不剧透感受，音乐自己会说话。" },
];

// ============ 星期梗（中国打工人式共鸣）============
const WEEKDAY_LINES: Record<number, Array<{ en: string; zh: string }>> = {
  1: [
    { en: "Monday again. The week's opening bell just rang — coffee in, complaints out. Here's something to carry you through.", zh: "又是周一，本周开盘钟已敲响——咖啡满上，怨气清仓。来首歌扛过今天。" },
    { en: "Fresh week, fresh you — allegedly. Let's ease into it with a track that won't ask too much of you before 9 AM.", zh: "新的一周，崭新的你——据说。先来首不给你压力的歌，毕竟九点前别要求太多。" },
  ],
  2: [
    { en: "Tuesday. Officially too far from the weekend to celebrate, too early to despair. Music fills the gap nicely.", zh: "周二。离周末远到不值得庆祝，又近到不必绝望——正好用音乐填补这段尴尬。" },
  ],
  3: [
    { en: "Wednesday, the hump day. You've climbed this far — here's a track to push you over the top.", zh: "周三，爬坡日。都爬到这儿了——一首歌帮你翻过山头。" },
  ],
  4: [
    { en: "Thursday. The weekend is now within shouting distance. Let this one be the cheerleader.", zh: "周四。周末已经近到可以喊话了，让这首歌当你的拉拉队。" },
  ],
  5: [
    { en: "Friday! The work week is unofficially over. Cue the victory music — this is it.", zh: "周五！本周工作正式宣告（非官方）结束。胜利配乐就位——就是这首。" },
    { en: "It's Friday. Somewhere, a spreadsheet is crying. Here's your reward for not quitting on Thursday.", zh: "周五了。某处有张报表正在哭泣。这是你周四没撂挑子的奖励。" },
  ],
  6: [
    { en: "Saturday. No alarms, no meetings, no dress code. Let the music be your only schedule today.", zh: "周六。没有闹钟、没有会议、没有着装要求。今天唯一的日程就是这首歌。" },
  ],
  0: [
    { en: "Sunday night. Tomorrow is Monday, but let's not think about that — here's a track to enjoy the calm before the storm.", zh: "周日晚。明天周一——先别想，享受暴风雨前的宁静，来首歌。" },
    { en: "Sunday. The weekend is winding down, but the music isn't. One more before the real world calls.", zh: "周日。周末在收尾，音乐不停摆。在现实召唤之前，再听一首。" },
  ],
};

// ============ 时段梗（北京时间）============
const TIME_LINES: Array<{ hourFrom: number; hourTo: number; en: string; zh: string }> = [
  { hourFrom: 6, hourTo: 10, en: "Morning rush hour — the subway's packed and your coffee's still waking up. This one's for the commute.", zh: "早高峰——地铁挤爆，咖啡还没醒。这首歌献给通勤路上的你。" },
  { hourFrom: 11, hourTo: 13, en: "Lunch break. If you're eating at your desk again, this track is your tiny rebellion.", zh: "午休时间。如果你又在工位边吃边干活，这首歌就是你小小的叛逆。" },
  { hourFrom: 14, hourTo: 18, en: "Afternoon grind. The 3 PM slump is real — let this shake it off.", zh: "下午场硬仗。三点半综合症是真的——让这首把困意抖掉。" },
  { hourFrom: 19, hourTo: 23, en: "Evening unwind. Work's done, the city's lit up — here's your soundtrack for the night.", zh: "晚上放空。班也下了，城也亮了——这是你今晚的配乐。" },
  { hourFrom: 0, hourTo: 6, en: "Late night. If you're still up, you're either busy or brave — either way, this one's for you.", zh: "深夜档。这个点还醒着，你不是在忙就是在硬扛——不管哪种，这首给你。" },
];

// ============ 天气/节气（一句带过，非完整播报）============
const WEATHER_LINES: Array<{ en: string; zh: string }> = [
  { en: "It's {temp} degrees out there — {desc}. Music works better than a jacket, trust me.", zh: "外面 {temp}°C，{desc}。相信我，音乐比外套管用。" },
  { en: "{city} is doing its weather thing — {desc}. Good thing the playlist doesn't care.", zh: "{city}又在闹天气——{desc}。好在歌单不在乎。" },
];

// ============ 冷笑话 / 无厘头（纯调节气氛，与歌无关）============
const JOKE_LINES: Array<{ en: string; zh: string }> = [
  { en: "Why did the song cross the road? To get to the other side of your speakers. I'll see myself out after this track.", zh: "为什么这首歌要过马路？为了到音箱的另一边。播完这首我自己走。" },
  { en: "A track walked into a bar. The bartender said — we don't serve loops here. Anyway, here's the next one.", zh: "一首歌走进酒吧，酒保说：我们这儿不循环播放。总之，下一首来了。" },
  { en: "I asked the playlist for a sign today. It gave me a sharp — that counts, right?", zh: "今天我让歌单给个提示，它给了我一个升号。也算提示吧？" },
];

// 切入权重：歌本身略高（辛老师主选），星期/时段其次，冷笑话/天气兜底
interface PoolItem { kind: "song" | "weekday" | "time" | "weather" | "joke" }
const POOL: PoolItem[] = [
  { kind: "song" }, { kind: "song" }, { kind: "song" },
  { kind: "weekday" }, { kind: "weekday" },
  { kind: "time" },
  { kind: "weather" },
  { kind: "joke" }, { kind: "joke" },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * 生成一条切歌话术（模板 + 变量，无 LLM）。
 * 返回 null 表示无可用话术（调用方应静默切歌，绝不降级到会出错的路径）。
 */
export function buildTransitionScript(input: TransitionScriptInput): TransitionScript {
  const { song, weather, hour, weekday } = input;
  const roll = pick(POOL);

  // 歌本身：客观转述。歌名可念 → 念真名（en/zh 都是）；不可念 → 模糊指代
  if (roll.kind === "song" && song) {
    const line = pick(SONG_LINES);
    const safe = speakableTitle(song.name);
    const titleText = safe ? `"${song.name}"` : "this one";
    const zhTitle = safe ? `《${song.name}》` : "这一首";
    return {
      en: line.en.replace(/\{title\}/g, titleText),
      zh: line.zh.replace(/\{title\}/g, zhTitle),
      funny: false,
    };
  }

  // 星期梗（无天气也永远可用）
  if (roll.kind === "weekday") {
    const dayLines = WEEKDAY_LINES[weekday];
    const line = dayLines ? pick(dayLines) : pick(WEEKDAY_LINES[5]!);
    return { en: line.en, zh: line.zh, funny: false };
  }

  // 时段梗
  if (roll.kind === "time") {
    const line = pick(TIME_LINES.filter((t) => hour >= t.hourFrom && hour < t.hourTo)) ?? pick(TIME_LINES);
    return { en: line.en, zh: line.zh, funny: false };
  }

  // 天气/节气：有天气数据才走；没有 → 落到冷笑话
  if (roll.kind === "weather" && weather) {
    const line = pick(WEATHER_LINES);
    return {
      en: line.en
        .replace(/\{city\}/g, weather.city)
        .replace(/\{temp\}/g, String(Math.round(weather.temperature)))
        .replace(/\{desc\}/g, weather.description.toLowerCase()),
      zh: line.zh
        .replace(/\{city\}/g, weather.city)
        .replace(/\{temp\}/g, String(Math.round(weather.temperature)))
        .replace(/\{desc\}/g, weather.description),
      funny: false,
    };
  }

  // 冷笑话 / 无厘头（兜底，永远可用）
  const joke = pick(JOKE_LINES);
  return { en: joke.en, zh: joke.zh, funny: true };
}
