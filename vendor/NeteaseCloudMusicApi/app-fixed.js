#!/usr/bin/env node
/**
 * 精简版 NeteaseCloudMusicApi 启动入口
 * 显式 require 必要 module（避免 Docker 中 fs.readdir 异步扫描 module 失败）
 * 只保留 ai-radio 用到的 API：cloudsearch / song/url / song/detail / lyric / playlist/detail
 */
const path = require('path');
const { serveNcmApi } = require('./server');

// 显式定义必要 module（用 NeteaseCloudMusicApi 自带的 module/ 目录）
const modulePath = path.join(__dirname, 'module');
const moduleDefs = [
  { identifier: 'cloudsearch', route: '/cloudsearch', module: require(path.join(modulePath, 'cloudsearch.js')) },
  { identifier: 'song_url', route: '/song/url', module: require(path.join(modulePath, 'song_url.js')) },
  { identifier: 'song_detail', route: '/song/detail', module: require(path.join(modulePath, 'song_detail.js')) },
  { identifier: 'lyric', route: '/lyric', module: require(path.join(modulePath, 'lyric.js')) },
  { identifier: 'playlist_detail', route: '/playlist/detail', module: require(path.join(modulePath, 'playlist_detail.js')) },
  { identifier: 'search', route: '/search', module: require(path.join(modulePath, 'search.js')) },
  { identifier: 'user_account', route: '/user/account', module: require(path.join(modulePath, 'user_account.js')) },
];

serveNcmApi({ moduleDefs, checkVersion: false })
  .then((app) => {
    // ===== 音频代理路由（供 ai-radio-server 前端播放音乐）=====
    // 主服务访问网易云流可能超时，但这个节点访问是通的 → 在这里中转
    app.get('/proxy-audio', async (req, res) => {
      const raw = String(req.query.url || '');
      if (!raw) { res.status(400).json({ code: 400, message: '缺少 url' }); return; }
      const upstreamUrl = raw.replace(/^https:/, 'http:'); // 网易云防盗链只认 http
      // CORS：前端页面在 ai-radio-server.onrender.com（跨域），所有响应必须放行
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      try {
        const headers = {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          Referer: 'https://music.163.com/',
        };
        // Range 透传：audio 元素 seek / 续播进度 / 拖进度条都依赖它。
        // 浏览器带 Range: bytes=xxx- → 原样转给网易 CDN → CDN 回 206 + Content-Range。
        const range = req.headers.range;
        if (range) headers.Range = String(range);
        const upstream = await fetch(upstreamUrl, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        });
        // 206（partial）也是成功，必须放行
        if (!upstream.ok && upstream.status !== 206) { res.status(502).json({ code: 502, message: 'upstream ' + upstream.status }); return; }
        res.status(upstream.status === 206 ? 206 : 200);
        const ct = upstream.headers.get('content-type');
        if (ct) res.setHeader('Content-Type', ct);
        const cl = upstream.headers.get('content-length');
        if (cl) res.setHeader('Content-Length', cl);
        const cr = upstream.headers.get('content-range');
        if (cr) res.setHeader('Content-Range', cr);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=300');
        // 流式转发（不整段 buffer 到内存：12MB 歌不等全下完就出声，消除大文件超时）
        // 带背压：res.write 返回 false 时等 drain，避免内存暴涨
        const reader = upstream.body?.getReader();
        if (!reader) { res.end(); return; }
        res.flushHeaders?.();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(value)) {
              await new Promise((resolve) => res.once('drain', resolve));
            }
          }
          res.end();
        } catch {
          res.destroy();
        }
      } catch (err) {
        if (!res.headersSent) res.status(502).json({ code: 502, message: err instanceof Error ? err.message : 'proxy fail' });
        else res.destroy();
      }
    });
    console.log('[netease-fixed] 服务已启动，显式 module 路由 + /proxy-audio 已注册');
  })
  .catch((err) => {
    console.error('[netease-fixed] 启动失败:', err);
    process.exit(1);
  });
