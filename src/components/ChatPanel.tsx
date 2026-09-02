import { useState, useRef, useEffect } from "react";
import type { ReconnectingWS } from "@/lib/ws";
import { useRadioStore, type CustomColors, type WallpaperId } from "@/store/useRadioStore";

interface ChatMessage {
  id: number;
  role: "user" | "dj";
  /** auto = 切歌/开场/天气（自动播）；reply = 聊天回复（手动 ▶ 播） */
  kind: "auto" | "reply";
  en: string;
  zh: string;
  audioUrl?: string;
  time: string;
}

interface ChatPanelProps {
  ws: ReconnectingWS;
  onAction: (action: string, payload?: unknown) => void;
  /** 播放/停止 DJ 语音（用于 chat-reply 手动 ▶ 播放） */
  playDj: (url: string, en?: string, zh?: string, force?: boolean) => Promise<void>;
  stopDj: () => void;
  /** 让 DJ 设置弹窗跟随当前壁纸（custom 模式带入 7 token 颜色） */
  wallpaperId: WallpaperId;
  customColors: CustomColors;
}

// Web Speech API 类型（iOS Safari 用 webkit 前缀）
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type DjGender = "male" | "female" | "neutral";

interface Personality {
  gender: DjGender;
  /** 音色：MiMo ID（Milo/冰糖…）或 Edge 音色名（en-US-GuyNeural…） */
  voice: string;
  traits: string;
  /** 幽默风格：跨领域专业术语包装话术（金融/医学/法律/博弈/经典/无） */
  humorStyle: HumorStyle;
}

/** 幽默风格选项（与后端 dj.ts HumorStyle 对齐） */
type HumorStyle = "financial" | "medical" | "legal" | "poker" | "british" | "none";

const HUMOR_STYLES: { value: HumorStyle; label: string; emoji: string; desc: string }[] = [
  { value: "financial", label: "金融",       emoji: "📈", desc: "用股票/期权/仓位包装感情" },
  { value: "medical",   label: "医学",       emoji: "🩺", desc: "处方/诊断/临床口吻" },
  { value: "legal",     label: "法律",       emoji: "⚖️", desc: "合同/条款/判决口吻" },
  { value: "poker",     label: "博弈",       emoji: "♠️", desc: "扑克/筹码/All-in 口吻" },
  { value: "british",   label: "经典",       emoji: "🎙️", desc: "BBC 毒舌旁白（默认）" },
  { value: "none",      label: "无",         emoji: "🔇", desc: "不加幽默，正常回应" },
];

/** 音色目录条目（来自 /api/voices） */
interface VoiceItem {
  id: string;
  name: string;
  lang: "zh" | "en" | "auto";
  gender: DjGender;
  desc: string;
  engine: "mimo" | "edge";
  free: boolean;
}

const PERSONALITY_KEY = "ai-radio-dj-personality";
// 默认音色（老数据只有 gender → 映射默认 voice）
const GENDER_DEFAULT_VOICE: Record<DjGender, string> = {
  male: "en-US-GuyNeural",
  female: "en-US-JennyNeural",
  neutral: "en-US-GuyNeural",
};
const DEFAULT_PERSONALITY: Personality = { gender: "male", voice: "en-US-GuyNeural", traits: "", humorStyle: "british" };

function loadPersonality(): Personality {
  if (typeof localStorage === "undefined") return DEFAULT_PERSONALITY;
  try {
    const raw = localStorage.getItem(PERSONALITY_KEY);
    if (!raw) return DEFAULT_PERSONALITY;
    const p = JSON.parse(raw) as Partial<Personality>;
    const gender: DjGender = (p.gender === "female" || p.gender === "neutral") ? p.gender : "male";
    return {
      gender,
      // 兼容老数据：没存 voice 时按 gender 给默认音色
      voice: typeof p.voice === "string" && p.voice ? p.voice : GENDER_DEFAULT_VOICE[gender],
      traits: typeof p.traits === "string" ? p.traits : "",
      // 兼容老数据：没存 humorStyle 默认 british
      humorStyle: (typeof p.humorStyle === "string" && ["financial","medical","legal","poker","british","none"].includes(p.humorStyle))
        ? (p.humorStyle as HumorStyle)
        : "british",
    };
  } catch {
    return DEFAULT_PERSONALITY;
  }
}

/**
 * 统一对话界面：DJ 播报台 + 聊天窗合体
 * - DJ 消息（切歌/开场/天气/趣闻/回复）与用户消息交替显示
 * - 单轮对话：发新消息时清掉上一条
 * - ⚙️ 按钮可修改 DJ 性别 + 性格特征（持久化于 localStorage）
 * - 语音播放由 App 统一处理，这里只负责显示
 */
export function ChatPanel({ ws, onAction, playDj, stopDj, wallpaperId, customColors }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // 截图脚本专用：从 localStorage 读测试消息（?testMsgs=1 触发）
    if (typeof window === "undefined") return [];
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("testMsgs") === "1") {
        const raw = localStorage.getItem("ai-radio-test-messages");
        if (raw) return JSON.parse(raw) as ChatMessage[];
      }
    } catch { /* ignore */ }
    return [];
  });
  const [input, setInput] = useState("");
  const [hideZh, setHideZh] = useState(false);
  const [isOpen, setIsOpen] = useState(true); // 默认展开对话窗口
  const [isListening, setIsListening] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [personality, setPersonality] = useState<Personality>(() => loadPersonality());
  // 测试模式：自动打开 thinking
  const [testThinking, setTestThinking] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URL(window.location.href).searchParams.get("testThinking") === "1";
    } catch { return false; }
  });
  // 用户头像（dataURL，存 localStorage；null 时显示 fallback 字母）
  const [userAvatar, setUserAvatar] = useState<string | null>(() => {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem("ai-radio-user-avatar");
  });
  // DJ 头像（上传后覆盖默认 🎙，影响所有 DJ 消息气泡左边的圆形头像）
  const [djAvatar, setDjAvatar] = useState<string | null>(() => {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem("ai-radio-dj-avatar");
  });
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const djAvatarFileRef = useRef<HTMLInputElement>(null);
  const syncTimerRef = useRef<number | null>(null);
  // 立即同步 personality 到后端（debounce 200ms 避免 traits 每次按键都请求）
  // 解决"选音色后 DJ 还是 Edge 音"——之前必须发消息才会同步
  const syncPersonalityToServer = (p: Personality) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      fetch("/api/dj/personality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }).catch(() => {});
    }, 200);
  };
  // 包装 setPersonality：setState 后立即同步
  const updatePersonality = (updater: (p: Personality) => Personality) => {
    setPersonality((p) => {
      const next = updater(p);
      syncPersonalityToServer(next);
      return next;
    });
  };
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceItem[]>([]);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const djThinking = useRadioStore((s) => s.djThinking);
  // 当前手动播放的 chat-reply 消息 id（▶ 再点变 ⏸）
  const [playingReplyId, setPlayingReplyId] = useState<number | null>(null);

  const now = () => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  // DJ 消息显示（dj 类型语音由 App 自动播；chat-reply 由用户手动 ▶）
  useEffect(() => {
    return ws.onMessage((msg) => {
      const m = msg as Record<string, unknown>;
      if ((m.type === "dj" || m.type === "chat-reply") && m.en) {
        const reply = m as { en: string; zh: string; audioUrl?: string; action?: string; song?: unknown };
        setMessages((prev) => {
          // 去重：与上一条 DJ 消息相同 → 不追加（防"同一句说两遍"）
          const lastDj = [...prev].reverse().find((x) => x.role === "dj");
          if (lastDj && lastDj.en === reply.en) return prev;
          // 替换式：旧的 DJ 消息全部移除，只保留最新一条（用户消息保留）
          return [
            ...prev.filter((x) => x.role !== "dj"),
            {
              id: nextId.current++,
              role: "dj",
              kind: m.type === "chat-reply" ? "reply" : "auto",
              en: reply.en,
              zh: reply.zh ?? "",
              audioUrl: reply.audioUrl,
              time: now(),
            },
          ];
        });
        // 播放控制命令 → 执行对应动作（切歌/暂停/播放/音量/点歌）
        if (reply.action) onAction(reply.action, reply.song);
      }
    });
  }, [ws, onAction]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, djThinking]);

  // 用户头像上传处理：读图 → 转 dataURL → 持久化
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setUserAvatar(dataUrl);
      try {
        localStorage.setItem("ai-radio-user-avatar", dataUrl);
      } catch {
        /* localStorage 可能因 dataURL 过大失败，忽略 */
      }
    };
    reader.readAsDataURL(file);
    // 重置 input value 允许重复选同一文件
    e.target.value = "";
  };

  // 清除用户头像（恢复 fallback 字母）
  const clearUserAvatar = () => {
    setUserAvatar(null);
    try {
      localStorage.removeItem("ai-radio-user-avatar");
    } catch { /* ignore */ }
  };

  // DJ 头像上传处理：与用户头像共用同样模式（FileReader → dataURL → localStorage）
  const handleDjAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setDjAvatar(dataUrl);
      try {
        localStorage.setItem("ai-radio-dj-avatar", dataUrl);
      } catch {
        /* localStorage 可能因 dataURL 过大失败，忽略 */
      }
    };
    reader.readAsDataURL(file);
    // 重置 input value 允许重复选同一文件
    e.target.value = "";
  };

  // 清除 DJ 头像（恢复 🎙 fallback）
  const clearDjAvatar = () => {
    setDjAvatar(null);
    try {
      localStorage.removeItem("ai-radio-dj-avatar");
    } catch { /* ignore */ }
  };

  // 手动播放/暂停一条 chat-reply（▶ / ⏸）
  const toggleReplyPlay = (m: ChatMessage) => {
    if (!m.audioUrl) return;
    if (playingReplyId === m.id) {
      // 正在播这条 → 暂停
      stopDj();
      setPlayingReplyId(null);
    } else {
      // 播这条：先停别的，再播
      stopDj();
      playDj(m.audioUrl, m.en, m.zh, true)
        .then(() => setPlayingReplyId(m.id))
        .catch(() => setPlayingReplyId(null));
    }
  };

  // 发新消息：清掉上一条（单轮对话）+ 停掉正在播的切歌话术（回复独占）
  // 附带 personality 让 LLM 调整话术风格、TTS 切换音色
  const sendMessage = (text: string) => {
    const t = text.trim();
    if (!t) return;
    stopDj();
    setPlayingReplyId(null);
    setMessages([{ id: nextId.current++, role: "user", kind: "auto", en: t, zh: t, time: now() }]);
    setInput("");
    useRadioStore.getState().setDjThinking(true);
    ws.send({ type: "chat", text: t, personality });
  };

  const handleSend = () => sendMessage(input);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSend();
  };

  // 语音识别（Web Speech API，iOS Safari 原生支持）
  const getRecognition = (): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | (new () => SpeechRecognitionLike)
      | undefined;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        sendMessage(transcript);
      }
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    return rec;
  };

  const handleMic = () => {
    const rec = getRecognition();
    if (!rec) {
      setInput("（当前浏览器不支持语音识别）");
      return;
    }
    if (isListening) {
      rec.stop();
      setIsListening(false);
    } else {
      rec.start();
      setIsListening(true);
    }
  };

  // 拉取音色目录（MiMo + Edge）
  useEffect(() => {
    fetch("/api/voices")
      .then((r) => r.json())
      .then((j) => {
        if (j.code === 0 && Array.isArray(j.data)) setVoiceCatalog(j.data as VoiceItem[]);
      })
      .catch(() => {});
  }, []);

  // 试听音色
  const previewVoice = async (voice: string) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = "";
    }
    setPreviewingVoice(voice);
    try {
      const res = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice, style: personality.traits }),
      });
      const j = (await res.json()) as { code: number; data?: { url?: string } };
      if (j.code === 0 && j.data?.url) {
        const a = new Audio(j.data.url);
        previewAudioRef.current = a;
        a.onended = () => setPreviewingVoice(null);
        await a.play();
      }
    } catch {
      /* 试听失败忽略 */
    }
    setPreviewingVoice(null);
  };

  // 保存 DJ 性格设置（持久化于 localStorage，切歌/打开 APP 保持不变）
  const saveSettings = () => {
    try {
      localStorage.setItem(PERSONALITY_KEY, JSON.stringify(personality));
    } catch { /* localStorage 可能不可用，忽略 */ }
    setShowSettings(false);
  };

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  if (!isOpen) {
    return (
      <button type="button" className="chat-toggle magnetic" aria-label="Open DJ chat" onClick={() => setIsOpen(true)}>
        💬 DJ
      </button>
    );
  }

  const GENDERS: { value: DjGender; label: string; emoji: string }[] = [
    { value: "male", label: "男声", emoji: "♂" },
    { value: "female", label: "女声", emoji: "♀" },
    { value: "neutral", label: "中性", emoji: "⚧" },
  ];

  return (
    <section className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">DJ Chat</span>
        <div className="chat-header-actions">
          {/* DJ 头像按钮：点击直接打开 DJ 性格设置窗口（上传/清除在窗口内） */}
          <button
            type="button"
            className="chat-dj-avatar-btn"
            aria-label="DJ 性格设置"
            title="点击打开 DJ 性格设置（可在此上传/更换头像、选音色、调性格）"
            onClick={() => setShowSettings(true)}
          >
            {djAvatar ? (
              <img src={djAvatar} alt="DJ" className="chat-dj-avatar-mini" />
            ) : (
              <span className="chat-dj-avatar-fallback">🎙</span>
            )}
          </button>
          {/* 用户头像按钮：用 label htmlFor 关联 input（iOS Safari/移动端最可靠触发方式） */}
          <input
            id="avatar-file"
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            className="avatar-file-input"
            aria-hidden="true"
          />
          <label
            htmlFor="avatar-file"
            className="chat-avatar-btn"
            aria-label="上传我的头像"
            title="点击上传/更换头像"
            role="button"
          >
            {userAvatar ? (
              <img src={userAvatar} alt="我" className="chat-avatar-mini" />
            ) : (
              <span className="chat-avatar-fallback">你</span>
            )}
          </label>
          <button
            type="button"
            className="caption-toggle"
            onClick={() => setHideZh((v) => !v)}
            aria-label={hideZh ? "显示中文" : "隐藏中文"}
          >
            {hideZh ? "显示中文" : "隐藏中文"}
          </button>
          <button type="button" className="chat-close" aria-label="Close" onClick={() => setIsOpen(false)}>✕</button>
        </div>
      </div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !djThinking && !testThinking && (
          <div className="chat-empty">跟 DJ 聊聊，或按 🎤 语音说话</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {/* 头像上方贴 YOU / DJ 标签 + 时间戳（紧凑模式：紧贴右上角） */}
            <div className="chat-msg-side">
              <div className={`chat-avatar ${m.role}`}>
                {m.role === "user" ? (
                  userAvatar ? (
                    <img src={userAvatar} alt="我" />
                  ) : (
                    <span>你</span>
                  )
                ) : djAvatar ? (
                  <img src={djAvatar} alt="DJ" />
                ) : (
                  <span>🎙</span>
                )}
              </div>
              <div className="chat-meta-row">
                <span className="chat-role">{m.role === "user" ? "YOU" : "DJ"}</span>
                <span className="chat-time">{m.time}</span>
              </div>
            </div>
            <div className="chat-msg-content">
              <span className="chat-text">{m.en}</span>
              {m.role === "dj" && m.zh && m.zh !== m.en && !hideZh && (
                <span className="chat-zh">{m.zh}</span>
              )}
              {m.role === "dj" && m.kind === "reply" && (
                <span className="chat-reply-hint">
                  {playingReplyId === m.id ? "🔊 正在播放…" : "🎧 点 ▶ 听 DJ 的回复"}
                </span>
              )}
              {/* DJ 气泡右下角💡小灯（壁纸主题适配） */}
              {m.role === "dj" && <span className="chat-bulb" aria-hidden="true">💡</span>}
              {/* DJ 消息回复手动 ▶/⏸ 按钮 */}
              {m.role === "dj" && m.kind === "reply" && m.audioUrl && (
                <button
                  type="button"
                  className={`chat-reply-toggle ${playingReplyId === m.id ? "playing" : ""}`}
                  onClick={() => toggleReplyPlay(m)}
                  aria-label={playingReplyId === m.id ? "暂停这段回复" : "播放这段回复"}
                  title={playingReplyId === m.id ? "点击暂停这段回复" : "点击听 DJ 的这段回复"}
                >
                  {playingReplyId === m.id ? "⏸" : "▶"}
                </button>
              )}
            </div>
          </div>
        ))}
        {(djThinking || testThinking) && (
          <div className="chat-msg dj thinking">
            <div className="chat-msg-side">
              <div className="chat-avatar dj">
                {djAvatar ? <img src={djAvatar} alt="DJ" /> : <span>🎙</span>}
              </div>
              <div className="chat-meta-row">
                <span className="chat-role">DJ</span>
                <span className="chat-time">{now()}</span>
              </div>
            </div>
            <div className="chat-msg-content">
              <span className="chat-text">
                💡 正在敲碗回复<span className="dots"><i>.</i><i>.</i><i>.</i></span>
              </span>
              <span className="chat-bulb" aria-hidden="true">💡</span>
            </div>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <input ref={inputRef} type="text" className="chat-input" placeholder="打字或点 🎤 说话..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} aria-label="Type a message" />
        <button
          type="button"
          className={`chat-mic ${isListening ? "mic-active" : ""}`}
          onClick={handleMic}
          aria-label={isListening ? "停止录音" : "语音输入"}
        >
          🎤
        </button>
        <button type="button" className="chat-send" onClick={handleSend} aria-label="Send">Send</button>
      </div>

      {/* DJ 性格设置模态框：跟随当前壁纸主题（data-wallpaper + custom 注入 CSS 变量） */}
      {showSettings && (() => {
        // custom 模式：注入 7 token 21 个变量到 modal，让 7 token 派生 modal-card 颜色
        const customVars: Record<string, string> = {};
        if (wallpaperId === "custom") {
          for (const k of ["bg","surface","surfaceAlt","text","textSoft","accent","border"] as const) {
            const v = customColors[k];
            customVars[`--c-${k}-h`] = `${v.h}`;
            customVars[`--c-${k}-s`] = `${v.s}%`;
            customVars[`--c-${k}-l`] = `${v.l}%`;
          }
        }
        return (
        <div className="modal-overlay" onClick={() => setShowSettings(false)} role="dialog" aria-modal="true">
          <div
            className="modal-card settings-card"
            data-wallpaper={wallpaperId}
            style={customVars as React.CSSProperties}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h3 className="modal-title">🎙 DJ 性格设置</h3>
              <button type="button" className="modal-close" onClick={() => setShowSettings(false)} aria-label="Close">✕</button>
            </header>
            <div className="modal-body">
              <label className="modal-label">DJ 头像（点击更换，影响所有 DJ 气泡左侧）</label>
              <div className="modal-avatar-row">
                <label htmlFor="dj-avatar-file-modal" className="modal-avatar-tile" role="button" title="点击上传 DJ 头像">
                  {djAvatar ? (
                    <img src={djAvatar} alt="DJ" className="modal-avatar-img" />
                  ) : (
                    <span className="modal-avatar-fallback">🎙</span>
                  )}
                  <span className="modal-avatar-edit">📷</span>
                </label>
                {djAvatar && (
                  <button
                    type="button"
                    className="modal-btn-secondary modal-btn-small"
                    onClick={clearDjAvatar}
                  >
                    清除 DJ 头像
                  </button>
                )}
                <input
                  id="dj-avatar-file-modal"
                  ref={djAvatarFileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleDjAvatarChange}
                  className="avatar-file-input"
                  aria-hidden="true"
                />
              </div>

              <label className="modal-label">性别</label>
              <div className="modal-genders">
                {GENDERS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    className={`gender-chip ${personality.gender === g.value ? "active" : ""}`}
                    onClick={() => updatePersonality((p) => ({
                      ...p,
                      gender: g.value,
                      // 切性别时若当前音色性别不匹配，自动换同性别默认音色
                      voice: GENDER_DEFAULT_VOICE[g.value],
                    }))}
                  >
                    <span className="gender-emoji">{g.emoji}</span> {g.label}
                  </button>
                ))}
              </div>

              <label className="modal-label">音色（点 ▶ 试听）</label>
              {voiceCatalog.length === 0 ? (
                <div className="modal-hint">音色加载中...</div>
              ) : (
                <div className="voice-simple-list">
                  {voiceCatalog
                    .filter((v) => v.gender === personality.gender || v.gender === "neutral")
                    .map((v) => (
                      <div
                        key={v.id}
                        className={`voice-item ${personality.voice === v.id ? "active" : ""}`}
                        onClick={() => updatePersonality((p) => ({ ...p, voice: v.id }))}
                        role="button"
                        tabIndex={0}
                      >
                        <span className={`voice-dot ${personality.voice === v.id ? "checked" : ""}`}>
                          {personality.voice === v.id ? "✓" : "○"}
                        </span>
                        <span className="voice-item-name">
                          {v.name}
                          {v.engine === "mimo" && <span className="voice-badge-mimo">MiMo</span>}
                        </span>
                        <span className="voice-item-desc">{v.desc}</span>
                        <button
                          type="button"
                          className="voice-preview"
                          onClick={(e) => { e.stopPropagation(); previewVoice(v.id); }}
                          aria-label={`试听 ${v.name}`}
                        >
                          {previewingVoice === v.id ? "⏳" : "▶"}
                        </button>
                      </div>
                    ))}
                </div>
              )}
              <div className="modal-hint">MiMo 音色需配置 API Key（限时免费）；未配置时自动用 Edge-TTS</div>

              <label className="modal-label">性格特征（逗号分隔）</label>
              <textarea
                className="modal-textarea"
                rows={3}
                placeholder="风趣、毒舌、BBC 风格、温暖、简洁..."
                value={personality.traits}
                onChange={(e) => updatePersonality((p) => ({ ...p, traits: e.target.value }))}
              />
              <div className="modal-hint">
                例如：<code>风趣, 毒舌, BBC 旁白</code> → DJ 会按这些特征即兴发挥
              </div>

              {/* 幽默风格：跨领域专业术语包装话术 */}
              <label className="modal-label">幽默风格（用专业领域包装日常）</label>
              <div className="modal-humors">
                {HUMOR_STYLES.map((h) => (
                  <button
                    key={h.value}
                    type="button"
                    className={`humor-chip ${personality.humorStyle === h.value ? "active" : ""}`}
                    onClick={() => updatePersonality((p) => ({ ...p, humorStyle: h.value }))}
                    title={h.desc}
                  >
                    <span className="humor-emoji">{h.emoji}</span>
                    <span>{h.label}</span>
                  </button>
                ))}
              </div>
              <div className="modal-hint">
                例「金融」风格：聊失恋 → DJ 回「您的情绪正在破发，建议长线持有」；
                例「医学」风格：聊失眠 → DJ 回「建议暂停摄入午夜碳水，先做一次基础 CT」
              </div>
            </div>
            <footer className="modal-actions">
              <button type="button" className="modal-btn-secondary" onClick={() => setShowSettings(false)}>取消</button>
              <button type="button" className="modal-btn-primary" onClick={saveSettings}>保存</button>
            </footer>
          </div>
        </div>
        );
      })()}
    </section>
  );
}