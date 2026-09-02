/* 测量 chat-input-row / chat-panel 是否溢出视口右缘（各壁纸主题） */
const { chromium } = require("playwright-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = process.env.BASE_URL || "http://localhost:8787";
const VIEWPORTS = [
  { w: 1280, h: 900 },
  { w: 390, h: 844 }, // iPhone 12/13 逻辑宽度
  { w: 360, h: 800 },
];

const THEMES = ["cyber", "glass", "comic", "pop", "cream", "custom"];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (const theme of THEMES) {
    // 直接切壁纸：localStorage wallpaperId
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => {
      try {
        localStorage.setItem("ai-radio-wallpaper", JSON.stringify({ id: t }));
        localStorage.setItem("wallpaperId", JSON.stringify(t));
        localStorage.setItem("ai-radio-wallpaper-id", t);
      } catch (e) { /* ignore */ }
    }, theme);
    // 刷新应用壁纸（真实用户路径：设置存储后 reload）
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(1500);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await sleep(400);
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const out = {
          docScrollW: doc.scrollWidth,
          winInnerW: window.innerWidth,
          bodyScrollW: body ? body.scrollWidth : -1,
          bodyOverflowX: body ? getComputedStyle(body).overflowX : "",
          overflowX: getComputedStyle(doc).overflowX,
        };
        // 找到 input row 及其每个子元素
        const row = document.querySelector(".chat-input-row");
        if (row) {
          const r = row.getBoundingClientRect();
          out.row = { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
          out.rowChildren = [...row.children].map((el) => {
            const b = el.getBoundingClientRect();
            return {
              cls: el.className,
              left: Math.round(b.left),
              right: Math.round(b.right),
              width: Math.round(b.width),
            };
          });
        }
        const panel = document.querySelector(".chat-panel");
        if (panel) {
          const p = panel.getBoundingClientRect();
          out.panel = { left: Math.round(p.left), right: Math.round(p.right), width: Math.round(p.width) };
          // 是否有横向滚动 / 超宽元素
          const wide = [...panel.querySelectorAll("*")].filter((el) => {
            const b = el.getBoundingClientRect();
            return b.right > window.innerWidth + 0.5;
          }).slice(0, 5).map((el) => ({
            tag: el.tagName,
            cls: (el.className && String(el.className).slice(0, 60)) || "",
            right: Math.round(el.getBoundingClientRect().right),
          }));
          out.wideInPanel = wide;
        }
        return out;
      });
      const flag = (m.row && m.row.right > vp.w + 0.5) || m.docScrollW > vp.w + 1 ? "  <<< OVERFLOW" : "";
      console.log(
        `[${theme.padEnd(6)}] vw=${String(vp.w).padStart(4)}  docSW=${m.docScrollW} winW=${m.winInnerW}` +
        (m.row ? `  row.R=${m.row.right} row.w=${m.row.width}` : "  no-row") +
        (m.panel ? `  panel.R=${m.panel.right}` : "") +
        flag
      );
      if (m.rowChildren) {
        console.log(`      children: ` + m.rowChildren.map((c) => `${c.cls}=${c.width}px[${c.left}→${c.right}]`).join(" "));
      }
      if (m.wideInPanel && m.wideInPanel.length) {
        console.log(`      wide-in-panel: ` + JSON.stringify(m.wideInPanel));
      }
      if ((m.row && m.row.right > vp.w + 0.5)) {
        // 溢出时截图留证
        await page.screenshot({ path: `D:/Workspace/AI工作空间仓库/ai-radio/shots/_ovf_${theme}_${vp.w}.png` });
      }
    }
  }

  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
