type MessageHandler = (msg: unknown) => void;

const MAX_RETRY = 5;
const BASE_DELAY = 1000;
const HEARTBEAT_INTERVAL = 30000;

/**
 * 带指数退避重连 + 心跳的 WebSocket 封装。
 * 接收所有类型的消息（dj / chat-reply / hello），广播给所有注册 handler。
 */
export class ReconnectingWS {
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private readonly handlers = new Set<MessageHandler>();
  private shouldReconnect = true;

  constructor(private readonly url: string) {}

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
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}