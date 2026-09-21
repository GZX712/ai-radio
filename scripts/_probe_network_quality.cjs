/**
 * 跨境 vs 国内 网络质量对照探针
 * 从本机（中国大陆）分别量 Render 新加坡 与 腾讯云 COS 南京
 * 分层测量：DNS / TCP 握手 / TLS 握手 / TTFB / 总时长，各采样 N 次
 */
const tls = require('node:tls');
const dns = require('node:dns').promises;

const N = Number(process.env.N || 8);

const TARGETS = [
  { label: 'Render 新加坡 (后端)', host: 'ai-radio-server.onrender.com', path: '/api/health' },
  { label: 'COS 南京 (音乐/封面)', host: 'ai-radio-library-1463614289.cos.ap-nanjing.myqcloud.com', path: '/manifest.json' },
];

function timeIt() { return Number(process.hrtime.bigint()) / 1e6; }

/** 用裸 tls 连接分离出 DNS / TCP / TLS 三段耗时 */
function tlsHandshake(host, port = 443) {
  return new Promise((resolve) => {
    const t0 = timeIt();
    let tDns = 0, tTcp = 0;
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      resolve({ dns: tDns - t0, tcp: tTcp - tDns, tls: timeIt() - tTcp, total: timeIt() - t0 });
      socket.destroy();
    });
    socket.on('connect', () => { tTcp = timeIt(); });
    socket.on('lookup', () => { tDns = timeIt(); });
    socket.on('error', () => { resolve({ error: true, total: timeIt() - t0 }); });
    socket.setTimeout(12000, () => { socket.destroy(); resolve({ error: true, timeout: true, total: timeIt() - t0 }); });
  });
}

async function httpSample(url) {
  const t0 = timeIt();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 40000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'net-probe' } });
    const ttfb = timeIt() - t0;
    const body = await r.text();
    clearTimeout(to);
    return { ok: r.status === 200, status: r.status, ttfb, total: timeIt() - t0, bytes: body.length };
  } catch (e) {
    return { ok: false, err: (e.name || '') + ' ' + String(e.message || '').slice(0, 40), total: timeIt() - t0 };
  }
}

const stat = (a) => {
  if (!a.length) return '-';
  const s = [...a].sort((x, y) => x - y);
  const avg = a.reduce((x, y) => x + y, 0) / a.length;
  return { min: Math.round(s[0]), med: Math.round(s[Math.floor(s.length / 2)]), max: Math.round(s[s.length - 1]), avg: Math.round(avg) };
};

(async () => {
  const out = { at: new Date().toISOString(), n: N, targets: {} };

  for (const t of TARGETS) {
    console.log('\n===== ' + t.label + ' =====');
    console.log('  主机: ' + t.host);

    // 1) DNS
    const dnsRuns = [];
    for (let i = 0; i < Math.min(3, N); i++) {
      const t0 = timeIt();
      try { await dns.lookup(t.host); dnsRuns.push(timeIt() - t0); } catch { }
    }

    // 2) 握手分层
    const hsRuns = [];
    for (let i = 0; i < Math.min(4, N); i++) hsRuns.push(await tlsHandshake(t.host));

    // 3) HTTP 采样
    const url = 'https://' + t.host + t.path;
    const httpRuns = [];
    for (let i = 0; i < N; i++) {
      const r = await httpSample(url);
      httpRuns.push(r);
      process.stdout.write(`  [${i + 1}/${N}] ${r.ok ? 'OK' : 'FAIL'} ttfb=${r.ttfb ? Math.round(r.ttfb) + 'ms' : '-'} total=${Math.round(r.total)}ms${r.err ? ' ' + r.err : ''}\n`);
    }

    const okRuns = httpRuns.filter((r) => r.ok);
    const summary = {
      host: t.host,
      dns: stat(dnsRuns),
      tls: {
        tcp: stat(hsRuns.filter((x) => !x.error).map((x) => x.tcp)),
        handshake: stat(hsRuns.filter((x) => !x.error).map((x) => x.tls)),
        errors: hsRuns.filter((x) => x.error).length,
      },
      http: {
        success: okRuns.length + '/' + N,
        ttfb: stat(okRuns.map((r) => r.ttfb)),
        total: stat(okRuns.map((r) => r.total)),
        failures: httpRuns.filter((r) => !r.ok).map((r) => r.err || 'status ' + r.status),
      },
    };
    out.targets[t.label] = summary;

    console.log('  DNS  ' + JSON.stringify(summary.dns));
    console.log('  TCP  ' + JSON.stringify(summary.tls.tcp) + '  TLS ' + JSON.stringify(summary.tls.handshake) + '  (握手失败 ' + summary.tls.errors + ')');
    console.log('  HTTP ' + summary.http.success + '  TTFB ' + JSON.stringify(summary.http.ttfb));
    console.log('       总时长 ' + JSON.stringify(summary.http.total));
    if (summary.http.failures.length) console.log('  失败: ' + JSON.stringify(summary.http.failures));
  }

  require('node:fs').writeFileSync('shots/_net_quality.json', JSON.stringify(out, null, 2));
  console.log('\n结果已写入 shots/_net_quality.json');
})();
