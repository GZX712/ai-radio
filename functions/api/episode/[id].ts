/**
 * EdgeOne Pages Functions — 回放数据 API
 * GET /api/episode/:id → 完整字幕时间轴 JSON（回放页用）
 */
export async function onRequest({ params, env }) {
  const id = params.id || "live";
  const key = `ep:${id}:history`;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  try {
    const history = await env.RADIO_KV.get(key);
    return new Response(history || "[]", { headers: cors });
  } catch {
    return new Response("[]", { headers: cors });
  }
}
