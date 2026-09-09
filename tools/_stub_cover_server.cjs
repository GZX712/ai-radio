// 封面 e2e 用 stub 后端：同源 serve dist + GET /api/now 返回带真实 COS 封面的歌
// （COS 允许 CORS → canvas 可取色/显影，贴近生产）
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const DIST = "D:\\Workspace\\AI工作空间仓库\\ai-radio\\dist";
const PORT = 8899;
const COVER = "https://ai-radio-library-1463614289.cos.ap-nanjing.myqcloud.com/covers/L0089.jpg";

const now = {
  code: 0,
  data: {
    songmid: "L0089",
    name: "少年维持着烦恼",
    artist: "堡(测试歌)",
    url: "https://example.com/noop.mp3",
    picUrl: COVER,
    lyric: null,
  },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/api/now") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(now));
      return;
    }
    if (u.pathname.startsWith("/api/")) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ code: 404, message: "stub" }));
      return;
    }
    if (u.pathname.startsWith("/ws")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    // 静态文件（SPA fallback 到 index.html）
    let p = path.normalize(path.join(DIST, u.pathname === "/" ? "index.html" : u.pathname));
    if (!p.startsWith(DIST)) { res.statusCode = 403; res.end(); return; }
    fs.readFile(p, (err, buf) => {
      if (err) {
        fs.readFile(path.join(DIST, "index.html"), (e2, buf2) => {
          if (e2) { res.statusCode = 500; res.end(); return; }
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(buf2);
        });
        return;
      }
      const ext = path.extname(p).toLowerCase();
      res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(buf);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[stub-cover] http://127.0.0.1:${PORT}`));
