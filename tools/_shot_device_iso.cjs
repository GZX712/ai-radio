// 设备隔离 e2e 截图验证：
// 1) 主人设备（有 bond）：不再弹「开始/绑定」引导页，直接进电台；本地聊天历史保留并 hydrate 显示
// 2) 新接入客人设备（无 bond）：显示引导页；本地聊天历史启动即清空（无痕），不 hydrate
const { chromium } = require("C:\\Users\\hxaka\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core\\index.js");
const path = require("node:path");

const URL = "http://127.0.0.1:8791/";
const OUT_DIR = "/d/Workspace/AI工作空间仓库/ai-radio/shots/device_iso";
const HISTORY = [
  { id: 1, role: "user", kind: "user", en: "主人的秘密问题：今天股票涨了吗？", zh: "主人的秘密问题：今天股票涨了吗？", time: "19:00" },
  { id: 2, role: "dj", kind: "reply", en: "This is the owner-only private chat log.", zh: "这是只有主人设备才该看到的私密对话。", time: "19:01" },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:\\Users\\hxaka\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  const results = {};

  // ============ 场景 1：主人设备（desktop） ============
  {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    });
    await ctx.addInitScript((hist) => {
      localStorage.setItem("radio_device_id", "e2e-owner-device-0001");
      localStorage.setItem("radio_owner_bond", "e2e-bond-dummy");
      localStorage.setItem("ai-radio-chat-history", JSON.stringify(hist));
    }, HISTORY);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    results.owner_noOverlay = (await page.locator(".start-overlay").count()) === 0;
    results.owner_historyKept = !!(await page.evaluate(() => localStorage.getItem("ai-radio-chat-history")));
    const chatText = await page.evaluate(() => document.querySelector(".chat-list")?.textContent ?? "");
    results.owner_historyHydrated = chatText.includes("私密对话");
    results.owner_roleOwnerChip = (await page.locator(".role-badge.owner").count()) > 0;
    await page.screenshot({ path: path.join(OUT_DIR, "1_owner_desktop.png"), fullPage: false });
    console.log("[owner] noOverlay=" + results.owner_noOverlay +
      " historyKept=" + results.owner_historyKept +
      " hydrated=" + results.owner_historyHydrated +
      " ownerChip=" + results.owner_roleOwnerChip);
    await ctx.close();
  }

  // ============ 场景 2：主人设备（mobile viewport） ============
  {
    const ctx = await browser.newContext({
      viewport: { width: 480, height: 900 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript((hist) => {
      localStorage.setItem("radio_device_id", "e2e-owner-device-0002");
      localStorage.setItem("radio_owner_bond", "e2e-bond-dummy");
      localStorage.setItem("ai-radio-chat-history", JSON.stringify(hist));
    }, HISTORY);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    results.ownerMobile_noOverlay = (await page.locator(".start-overlay").count()) === 0;
    await page.screenshot({ path: path.join(OUT_DIR, "2_owner_mobile.png"), fullPage: false });
    console.log("[owner-mobile] noOverlay=" + results.ownerMobile_noOverlay);
    await ctx.close();
  }

  // ============ 场景 3：客人设备（无 bond，mobile） ============
  {
    const ctx = await browser.newContext({
      viewport: { width: 480, height: 900 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript((hist) => {
      localStorage.setItem("radio_device_id", "e2e-guest-device-0001");
      localStorage.setItem("ai-radio-chat-history", JSON.stringify(hist)); // 残留旧历史
    }, HISTORY);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);
    results.guest_hasOverlay = (await page.locator(".start-overlay").count()) > 0;
    results.guest_hasBindBtn = (await page.locator(".start-bind-btn").count()) > 0;
    await page.screenshot({ path: path.join(OUT_DIR, "3_guest_overlay.png"), fullPage: false });
    // 点「开始电台」进主页，验证历史已被清空、无痕
    await page.locator(".start-btn").first().click();
    await page.waitForTimeout(2000);
    results.guest_historyCleared = (await page.evaluate(() => localStorage.getItem("ai-radio-chat-history"))) === null;
    const chatText2 = await page.evaluate(() => document.querySelector(".chat-list")?.textContent ?? "");
    results.guest_notHydrated = !chatText2.includes("私密对话");
    results.guest_guestChip = (await page.locator(".role-badge.guest").count()) > 0;
    await page.screenshot({ path: path.join(OUT_DIR, "4_guest_after_start.png"), fullPage: false });
    console.log("[guest] hasOverlay=" + results.guest_hasOverlay +
      " hasBindBtn=" + results.guest_hasBindBtn +
      " historyCleared=" + results.guest_historyCleared +
      " notHydrated=" + results.guest_notHydrated +
      " guestChip=" + results.guest_guestChip);
    await ctx.close();
  }

  const fail = Object.entries(results).filter(([, v]) => v === false).map(([k]) => k);
  console.log("\n=== 汇总 ===");
  console.log(fail.length === 0 ? "ALL PASS" : "FAIL: " + fail.join(", "));
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
