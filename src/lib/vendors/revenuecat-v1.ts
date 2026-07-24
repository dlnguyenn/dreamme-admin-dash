/**
 * RevenueCat v1 REST API — support actions only.
 *
 * The v1 API takes a DIFFERENT key than the v2 key in REVENUECAT_API_KEY
 * (v2 sk_ keys are rejected by v1 endpoints): create a v1 secret key in
 * RC dashboard → Project settings → API keys and set REVENUECAT_V1_API_KEY.
 *
 * Only Google Play purchases can be refunded through RevenueCat
 * (POST /v1/subscribers/{app_user_id}/subscriptions/{product_id}/refund —
 * refunds the latest purchase AND revokes access immediately). Apple refunds
 * are Apple-only (reportaproblem.apple.com); Stripe goes through the Stripe
 * API directly.
 */

const BASE = "https://api.revenuecat.com/v1";

function getKey(): string {
  return process.env.REVENUECAT_V1_API_KEY ?? "";
}

export function rcV1Configured(): boolean {
  return !!getKey();
}

export interface RcRefundResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Refund the latest Play Store purchase and revoke access. */
export async function refundAndRevokePlaySubscription(
  appUserId: string,
  productId: string,
): Promise<RcRefundResult> {
  const key = getKey();
  if (!key) throw new Error("REVENUECAT_V1_API_KEY not set");
  const res = await fetch(
    `${BASE}/subscribers/${encodeURIComponent(appUserId)}/subscriptions/${encodeURIComponent(productId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  );
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = { raw: await res.text().catch(() => "") };
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `status ${res.status}`;
    throw new Error(`RevenueCat v1 refund failed: ${msg}`);
  }
  return { ok: true, status: res.status, body };
}
