/**
 * EdgeOne Pages Functions — 微信分享落地页（SSR OG Meta 注入）
 * GET /share/:id → 返回含 og:title / og:description / og:image 的 HTML
 * 微信内打开显示分享卡片，点击进入 /live 直播页
 */
export async function onRequest({ params, env }) {
  const id = params.id || "live";

  let title = "AI 电台 — 正在直播";
  let desc = "深夜独自调频，收到来自宇宙的信号。点进来一起听。";
  let nowTrack = "";
  try {
    const raw = await env.RADIO_KV.get(`ep:${id}:now`);
    if (raw) {
      const song = JSON.parse(raw);
      nowTrack = song.name ? `当前播放：${song.name}` : "";
      title = `AI 电台 — ${song.name || "直播中"}`;
      desc = nowTrack ? `${nowTrack} · 深夜独自调频，收到来自宇宙的信号。点进来一起听。` : desc;
    }
  } catch { /* ignore */ }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://${new URL(request.url).host}/og-cover.png" />
  <meta http-equiv="refresh" content="0; url=/live" />
  <title>${title}</title>
  <style>
    body { margin:0; background:#0a0a0f; color:#d8e0ec; font-family: monospace;
           display:flex; align-items:center; justify-content:center; height:100vh; }
    .card { text-align:center; max-width:320px; }
    .title { color:#00f3ff; font-size:20px; letter-spacing:.08em; margin-bottom:8px; }
    .desc { color:#6b7b8d; font-size:13px; line-height:1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">${title}</div>
    <div class="desc">${desc}<br/>正在跳转直播…</div>
  </div>
  <script>setTimeout(() => location.href = "/live", 800);</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
