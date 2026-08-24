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
      try {
        const upstream = await fetch(upstreamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            Referer: 'https://music.163.com/',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        });
        if (!upstream.ok) { res.status(502).json({ code: 502, message: 'upstream ' + upstream.status }); return; }
        const buf = Buffer.from(await upstream.arrayBuffer());
        // CORS：前端页面在 ai-radio-server.onrender.com（跨域），必须放行
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(buf);
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
