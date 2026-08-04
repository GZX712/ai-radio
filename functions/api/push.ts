/**
 * EdgeOne Pages Functions — DJ 端推送入口
 * 电脑端 ai-radio 后端每次说话/切歌时 POST 到此，写入 KV 并广播给听众
 *
 * 请求头：X-DJ-Token: <DJ_TOKEN>（防滥用）
 * Body：  { type: "subtitle", en, zh, laugh? }
 *         { type: "track", name, artist, picUrl? }
 *         { type: "heartbeat" }
 */
export async function onRequest({ request, env }) {
  // CORS
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-DJ-Token",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // Token 校验
  const token = request.headers.get("X-DJ-Token");
  if (!token || token !== (env.DJ_TOKEN || "changeme")) {
    return new Response(JSON.stringify({ code: 401, message: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ code: 400, message: "bad json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  const episodeId = "live"; // 默认直播频道（后续可按需扩展多频道）
  const now = Date.now();

  // 写 KV（字幕时间轴持久化，供回放）
  if (body.type === "subtitle") {
    const key = `ep:${episodeId}:history`;
    const history = JSON.parse((await env.RADIO_KV.get(key)) || "[]");
    history.push({
      en: body.en,
      zh: body.zh || "",
      laugh: body.laugh || null,
      timestamp: now,
    });
    // 只保留最近 500 条，防 KV 膨胀
    if (history.length > 500) history.splice(0, history.length - 500);
    await env.RADIO_KV.put(key, JSON.stringify(history));
  }

  // 当前曲目 / 状态
  if (body.type === "track") {
    await env.RADIO_KV.put(`ep:${episodeId}:now`, JSON.stringify({ name: body.name, artist: body.artist, picUrl: body.picUrl || "", at: now }));
  }
  await env.RADIO_KV.put(`ep:${episodeId}:lastbeat`, String(now));

  return new Response(JSON.stringify({ code: 0, message: "ok" }), {
    headers: { "Content-Type": "application/json", ...cors },
  });
}
