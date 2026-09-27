type MessageHandler = (msg: unknown) => void;

const MAX_RETRY = 5;
const BASE_DELAY = 1000;
const HEARTBEAT_INTERVAL = 30000;
/** ping 发出后等 pong 的时限：超时判僵尸（正常链路 pong 往返 <1s，跨境 <2s，10s 很宽松） */
const PONG_TIMEOUT = 10000;
/** 断线期间待补发消息的上限（防爆内存；聊天场景远超够用） */
const SEND_QUEUE_MAX = 50;

/**
 * 带指数退避重连 + 心跳 + 僵尸检测 + 断线补发的 WebSocket 封装。
 * 接收所有类型的消息（dj / chat-reply / hello），广播给所有注册 handler。
 *
 * [2026-09-25 客人路径排查] 退避重连最多 5 次（约 31 秒）就**永久放弃**：
 * 手机锁屏/切后台几分钟后回来，WS 早已死透且不再重试 —— DJ 串场、点歌同步、
 * 聊天回复全部静默丢失，只能手动刷新。补一个「唤醒重踢」：页面回到前台或
 * 网络恢复时，若连接已死则重置退避立即重连。
 *
 * [2026-09-25 DJ 回复时灵时不灵] 线上实证：服务端 5.6s 正常回包，问题全在客户端：
 *  1) 僵尸连接无检测 —— 锁屏/切网后 socket 本地还显示 OPEN，send() 成功发出
 *     却进了虚空（TCP 半开），消息永远到不了服务器。补 pong 看门狗：每次 ping
 *     后 10s 无 pong → 主动关闭走重连。
 *  2) send() 在非 OPEN 状态静默丢弃 —— 重连窗口期发的聊天直接蒸发。补发送队列：
 *     非 OPEN 时入队 + 立即踢重连，onopen 时按序补发。
 *  3) 旧 socket 的 onclose 会误杀新 socket 的心跳（共享 timer 字段）——回调全部
 *     加 socket 身份校验（this.ws !== sock 直接忽略），兼防重复连接。
 */
export class ReconnectingWS {
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private heartbeatTimer: number | null = null;
  private pongTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private readonly handlers = new Set<MessageHandler>();
  private shouldReconnect = true;
  private sendQueue: string[] = [];

  private readonly onVisible = (): void => {
    if (document.visibilityState === "visible") this.kick();
  };
  private readonly onOnline = (): void => {
    this.kick();
  };

  constructor(private readonly url: string) {
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onOnline);
  }

  /** 连接已死（重试耗尽 / 休眠断开）时立即重连；活着则不动。 */
  private kick(): void {
    if (!this.shouldReconnect) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.retryCount = 0;
    this.connect();
  }

  connect(): void {
    // 已有存活/在建连接 → 不重复开（旧 socket 迟到的 onclose 触发的重连会撞在这里，直接拦下）
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    const sock = new WebSocket(this.url);
    this.ws = sock;

    sock.onopen = () => {
      if (this.ws !== sock) return;
      this.retryCount = 0;
      this.startHeartbeat();
      this.flushQueue();
    };

    sock.onmessage = (e: MessageEvent) => {
      if (this.ws !== sock) return;
      try {
        const raw = JSON.parse(e.data);
        // pong 是心跳回执：喂看门狗，不发给业务 handler
        if (raw && typeof raw === "object" && (raw as { type?: string }).type === "pong") {
          this.notePong();
          return;
        }
        // 不做 schema 验证——接受所有消息类型（dj / chat-reply / hello 等）
        this.handlers.forEach((h) => h(raw));
      } catch {
        // 忽略非 JSON 消息
      }
    };

    sock.onclose = () => {
      if (this.ws !== sock) return; // 旧 socket 迟到的事件：不许动新连接的心跳/状态
      this.stopHeartbeat();
      if (this.shouldReconnect) this.scheduleReconnect();
    };

    sock.onerror = () => {
      if (this.ws !== sock) return;
      this.ws?.close();
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
        // 僵尸看门狗：ping 发出 10s 还没 pong → 这条连接已是半开尸体，主动杀掉重连
        if (this.pongTimer !== null) clearTimeout(this.pongTimer);
        this.pongTimer = window.setTimeout(() => {
          this.pongTimer = null;
          console.warn("[WS] ping 发出 10s 无 pong —— 判定僵尸连接，主动重连");
          this.ws?.close(); // onclose → scheduleReconnect
        }, PONG_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }

  private notePong(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= MAX_RETRY) return;
    if (this.reconnectTimer !== null) return; // 已有一张重连票，不重复排期
    const delay = BASE_DELAY * Math.pow(2, this.retryCount);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.retryCount++;
      this.connect();
    }, delay);
  }

  /**
   * 发送消息。OPEN 时直发；否则入队 + 立即踢重连，恢复后 onopen 按序补发。
   * （旧行为：非 OPEN 静默丢弃 —— 聊天消息蒸发、用户永远等不到回复）
   */
  send(data: unknown): void {
    const payload = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    if (this.sendQueue.length < SEND_QUEUE_MAX) {
      this.sendQueue.push(payload);
    }
    this.kick();
  }

  private flushQueue(): void {
    if (this.sendQueue.length === 0) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const pending = this.sendQueue.splice(0);
    for (const p of pending) this.ws.send(p);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onOnline);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.sendQueue = [];
    this.ws?.close();
    this.ws = null;
  }
}
