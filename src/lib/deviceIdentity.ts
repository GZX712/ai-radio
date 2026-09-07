/**
 * 设备身份（主人 / 客人彩蛋）
 *
 * - deviceId：浏览器首次访问生成随机 UUID → localStorage 持久化 → 跨会话稳定
 * - bond：主人凭证。访问 /?claim=<口令> 一次换得（后端 HMAC 无状态签发），
 *   此后任何入口打开都自动带上 → 后端认出"主人"，其他设备一律是"客人"。
 */
const DID_KEY = "radio_device_id";
const BOND_KEY = "radio_owner_bond";

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DID_KEY);
    if (!id) {
      id =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function getOwnerBond(): string | null {
  try {
    return localStorage.getItem(BOND_KEY);
  } catch {
    return null;
  }
}

function saveOwnerBond(bond: string): void {
  try {
    localStorage.setItem(BOND_KEY, bond);
  } catch {
    /* 隐私模式等写不进去 → 本次会话内仍有效（内存变量兜底已由调用方处理） */
  }
}

export function isOwnerDevice(): boolean {
  return !!getOwnerBond();
}

/** WS 地址拼接设备身份参数（deviceId + 主人 bond） */
export function buildWsUrl(base: string): string {
  const u = new URL(base, location.href);
  u.searchParams.set("deviceId", getDeviceId());
  const bond = getOwnerBond();
  if (bond) u.searchParams.set("bond", bond);
  return u.toString();
}

export type ClaimResult = "claimed" | "already" | "no-token" | "failed";

/**
 * URL 带 ?claim=<口令> → 绑定本设备为电台主人（一生一次）。
 * 成功后：保存 bond、清掉地址栏口令（防泄漏在历史里）。
 */
export async function tryClaimFromUrl(): Promise<ClaimResult> {
  const token = new URLSearchParams(location.search).get("claim");
  if (!token) return "no-token";
  if (isOwnerDevice()) return "already";
  const deviceId = getDeviceId();
  try {
    const res = await fetch("/api/device/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, deviceId }),
    });
    const j = (await res.json()) as { code?: number; data?: { bond?: string } };
    if (res.ok && j.code === 0 && j.data?.bond) {
      saveOwnerBond(j.data.bond);
      // 清掉 ?claim=… 保留其余参数（如已有其它配置参数）
      const q = location.search.replace(/([?&])claim=[^&]*/, "$1").replace(/[?&]$/, "");
      history.replaceState(null, "", location.pathname + q);
      return "claimed";
    }
    return "failed";
  } catch {
    return "failed";
  }
}
