/**
 * EdgeOne Pages Functions — WebSocket 信令中枢
 * - 听众端：连接 /ws?episode=live → 实时接收字幕/曲目广播
 * - 新听众加入时从 KV 回放最近字幕（catch-up）
 * - DJ 端推送走 /api/push（HTTP），这里只做广播层
 *
 * 注意：EdgeOne Functions 的 WebSocket 广播基于单 worker 实例内存，
 * 多实例时用 KV 做状态兜底（广播可能跨实例延迟，可接受）
 */
export async function onRequest({ request, env }) {
  const upgrade = request.headers.get("Upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const url = new URL(request.url);
  const episodeId = url.searchParams.get("episode") || "live";

  // EdgeOne Functions WebSocket 支持（Hono 风格 pair）
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  server.addEventListener("open", async () => {
    try {
      // 新听众 catch-up：回放最近 10 条字幕
      const key = `ep:${episodeId}:history`;
      const raw = await env.RADIO_KV.get(key);
      if (raw) {
        const history = JSON.parse(raw);
        const recent = history.slice(-10);
        server.send(JSON.stringify({ type: "catchup", items: recent }));
      }
      // 当前曲目
      const nowRaw = await env.RADIO_KV.get(`ep:${episodeId}:now`);
      if (nowRaw) {
        server.send(JSON.stringify({ type: "track", song: JSON.parse(nowRaw) }));
      }
    } catch {
      /* 忽略 catch-up 失败 */
    }
  });

  server.addEventListener("message", (event) => {
    // 听众端一般不发消息；如需弹幕可在此处理
    try {
      const data = JSON.parse(event.data);
      if (data.type === "ping") {
        server.send(JSON.stringify({ type: "pong" }));
      }
    } catch { /* ignore */ }
  });

  return new Response(null, { status: 101, webSocket: client });
}
