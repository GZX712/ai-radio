/**
 * 验证「云端档案被 Deploy 重置后自愈」：
 *   PC 已同步过（sync-meta.lastModified = 旧时间戳 > 0）+ 本地有 pop 壁纸设置，
 *   但云端 owner-settings.json 为空（模拟 Render 重建实例丢档）→ 打开页面后
 *   pullSettings 应识别「云端无档案」并【无条件重新种子推送】→ 云端恢复 pop。
 *
 * 断言：页面加载 4s 后，用同一主人 bond GET /api/owner/settings → wallpaper === "pop"
 */
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");

const URL = "http://127.0.0.1:8899";
const CHROME = "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe";
const DEVICE = "e2e-heal-pc-001";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // claim 换 bond（deviceId 必须与 radio_device_id 一致）
  const bond = await page.evaluate(async (deviceId) => {
    const r = await fetch("/api/device/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "xradio-master-2026", deviceId }),
    });
    const j = await r.json();
    return j.code === 0 ? j.data.bond : null;
  }, DEVICE);
  if (!bond) throw new Error("claim failed");

  // 预置「已同步过」状态 + 本地设置，云端此时为空档
  await page.evaluate(({ deviceId, bond }) => {
    localStorage.setItem("radio_device_id", deviceId);
    localStorage.setItem("radio_owner_bond", bond);
    localStorage.setItem("ai-radio-wallpaper", "pop");
    localStorage.setItem("ai-radio-sync-meta", JSON.stringify({ lastModified: 1700000000000 })); // 旧时间戳 meta>0
  }, { deviceId: DEVICE, bond });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000); // 等 pullSettings 跑完

  // 用同一 bond GET 云端档案
  const remote = await page.evaluate(async ({ deviceId, bond }) => {
    const r = await fetch(`/api/owner/settings?deviceId=${deviceId}&bond=${bond}`);
    const j = await r.json();
    return j.data?.settings ?? null;
  }, { deviceId: DEVICE, bond });

  console.log("=== 云端档案现状 ===");
  if (remote && remote.wallpaper === "pop") {
    console.log("PASS: 云端空档 + meta>0 → 打开页面自动补推成功 → wallpaper =", remote.wallpaper, "| updatedAt =", remote.updatedAt);
  } else {
    console.log("FAIL: 云端 =", JSON.stringify(remote).slice(0, 200));
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
