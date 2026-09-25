type MessageHandler = (msg: unknown) => void;

const MAX_RETRY = 5;
const BASE_DELAY = 1000;
const HEARTBEAT_INTERVAL = 30000;

/**
 * 带指数退避重连 + 心跳的 WebSocket 封装。
 * 接收所有类型的消息（dj / chat-reply / hello），广播给所有注册 handler。
 *
 * [2026-09-25 客人路径排查] 退避重连最多 5 次（约 31 秒）就**永久放弃**：
 * 手机锁屏/切后台几分钟后回来，WS 早已死透且不再重试 —— DJ 串场、点歌同步、
 * 聊天回复全部静默丢失，只能手动刷新。补一个「唤醒重踢」：页面回到前台或
 * 网络恢复时，若连接已死则重置退避立即重连。
 */
export class ReconnectingWS {
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private readonly handlers = new Set<MessageHandler>();
  private shouldReconnect = true;

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
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.retryCount = 0;
      this.startHeartbeat();
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data);
        // 不做 schema 验证——接受所有消息类型（dj / chat-reply / hello 等）
        this.handlers.forEach((h) => h(raw));
      } catch {
        // 忽略非 JSON 消息
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (this.shouldReconnect) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= MAX_RETRY) return;
    const delay = BASE_DELAY * Math.pow(2, this.retryCount);
    this.reconnectTimer = window.setTimeout(() => {
      this.retryCount++;
      this.connect();
    }, delay);
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
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
    this.ws?.close();
    this.ws = null;
  }
}