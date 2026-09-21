/**
 * 采样实测曲库码率（manifest 无 duration 字段，只能真读元数据）。
 * 做法：空白页里逐个 preload=metadata 读 duration，配合 HEAD 拿体积 → kbps。
 * 采样量由 N 控制（默认 16），用于推算「Chrome 起播预读 60 秒 ≈ 多少 MB」。
 */
const PW = require('C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js');
const CHROME = 'C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const COS = 'https://ai-radio-library-1463614289.cos.ap-nanjing.myqcloud.com';
const N = Number(process.env.N || 16);

(async () => {
  const m = await (await fetch(COS + '/manifest.json')).json();
  const songs = m.songs;
  // 均匀采样
  const step = Math.max(1, Math.floor(songs.length / N));
  const pick = songs.filter((_, i) => i % step === 0).slice(0, N);
  console.log(`曲库 ${songs.length} 首，均匀采样 ${pick.length} 首`);

  const browser = await PW.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');

  const rows = [];
  let totalBytes = 0;
  for (const s of songs) {
    const sz = Number(await fetch(`${COS}/songs/${encodeURIComponent(s.file)}`, { method: 'HEAD' })
      .then((r) => r.headers.get('content-length') || 0).catch(() => 0));
    totalBytes += sz;
    s.__size = sz;
  }
  console.log(`全库总体积 ${(totalBytes / 1024 / 1024).toFixed(0)} MB`);

  for (const s of pick) {
    const url = `${COS}/songs/${encodeURIComponent(s.file)}`;
    const dur = await page.evaluate(async (u) => {
      const a = new Audio();
      a.preload = 'metadata';
      return await new Promise((res) => {
        const to = setTimeout(() => res(0), 12000);
        a.addEventListener('loadedmetadata', () => { clearTimeout(to); res(a.duration || 0); });
        a.addEventListener('error', () => { clearTimeout(to); res(0); });
        a.src = u;
      });
    }, url).catch(() => 0);
    if (dur > 5 && s.__size > 0) {
      const kbps = Math.round((s.__size * 8) / dur / 1000);
      rows.push({ id: s.id, file: s.file.slice(0, 34), mb: +(s.__size / 1024 / 1024).toFixed(2), dur: Math.round(dur), kbps });
      console.log(`  ${s.id} ${String(s.file).slice(0, 34).padEnd(36)} ${(s.__size / 1024 / 1024).toFixed(2).padStart(5)}MB ${String(Math.round(dur)).padStart(4)}s ${String(kbps).padStart(4)}kbps`);
    } else {
      console.log(`  ${s.id} 元数据读取失败（跳过）`);
    }
  }
  await browser.close();

  const ks = rows.map((r) => r.kbps).sort((a, b) => a - b);
  const avg = Math.round(ks.reduce((a, b) => a + b, 0) / ks.length);
  const med = ks[Math.floor(ks.length / 2)];
  const leadBytes = (avg * 1000 * 60) / 8;           // Chrome 起播预读 ~60s 音频
  console.log('\n===== 采样结论 =====');
  console.log(`平均码率 ${avg} kbps | 中位 ${med} | 最低 ${ks[0]} | 最高 ${ks[ks.length - 1]}`);
  console.log(`>256kbps 占比 ${Math.round((ks.filter((k) => k > 256).length / ks.length) * 100)}%`);
  console.log(`Chrome 起播预读 ~60s → 首包约 ${(leadBytes / 1024 / 1024).toFixed(2)} MB`);
  const nets = { '4G(8Mbps)': 1024, '3G(3Mbps)': 384, 'Slow4G(1.6Mbps)': 205 };
  for (const [label, kbs] of Object.entries(nets)) {
    console.log(`  ${label.padEnd(16)} 受 60s 预读限制的起播 ≈ ${(leadBytes / 1024 / kbs).toFixed(1)}s` +
      `  | 降 128kbps 后 ≈ ${(128 * 1000 * 60 / 8 / 1024 / kbs).toFixed(1)}s`);
  }
  require('fs').writeFileSync('D:/Workspace/AI工作空间仓库/ai-radio/shots/_bitrate_sample.json', JSON.stringify({ rows, avg, med, totalBytesMB: Math.round(totalBytes / 1024 / 1024) }, null, 1));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
