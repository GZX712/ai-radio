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
  .then(() => console.log('[netease-fixed] 服务已启动，显式 module 路由已注册'))
  .catch((err) => {
    console.error('[netease-fixed] 启动失败:', err);
    process.exit(1);
  });
