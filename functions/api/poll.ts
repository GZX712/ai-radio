/**
 * EdgeOne Pages Functions — 听众轮询接口（最可靠的实时字幕通道）
 *
 * 说明：EdgeOne Functions 每请求独立实例，WebSocket 连接池不跨请求持久，
 * 纯 WS 广播不可靠。因此听众端以「轮询」为主、WebSocket 为辅：
 *   - 每 2-3s GET /api/poll?after=<lastTs>
 *   - 返回从 after 时间戳之后的字幕 + 当前曲目 + 主播心跳
 *
 * 响应：
 * { code:0, data:{ items:[{en,zh,timestamp}...], now:{name,artist,picUrl}|null,
 *   online:boolean } }
 */
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const episodeId = url.searchParams.get("episode") || "live";
  const after = Number(url.searchParams.get("after") || 0);
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  let items: unknown[] = [];
  try {
    const raw = await env.RADIO_KV.get(`ep:${episodeId}:history`);
    if (raw) {
      const history = JSON.parse(raw) as { timestamp: number }[];
      // after=0 时回放最近 10 条（catch-up）；否则只取新字幕
      const slice = after > 0 ? history.filter((h) => h.timestamp > after) : history.slice(-10);
      items = slice;
    }
  } catch { /* ignore */ }

  // 主播心跳：30s 内有过心跳视为在线
  let online = false;
  try {
    const beat = Number(await env.RADIO_KV.get(`ep:${episodeId}:lastbeat`));
    online = Date.now() - beat < 30_000;
  } catch { /* ignore */ }

  // 当前曲目
  let now = null;
  try {
    const raw = await env.RADIO_KV.get(`ep:${episodeId}:now`);
    if (raw) now = JSON.parse(raw);
  } catch { /* ignore */ }

  return new Response(JSON.stringify({ code: 0, data: { items, now, online } }), { headers: cors });
}
