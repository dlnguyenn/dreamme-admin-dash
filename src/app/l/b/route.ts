/**
 * The ad link's beacon — POST /l/b, fired by the /l page just before it
 * redirects (navigator.sendBeacon, so it never delays the store hop).
 *
 * Carries the device signals a UA cannot: screen in CSS points, dpr,
 * language, Intl timezone, and the AppleWebKit build. They complete the
 * click-side fingerprint the matcher gates on (attr-match), and they are
 * the only way a plain-Safari click (UA says just "iPhone") gets one.
 *
 * Public by design, like /l itself: the body is validated and capped, the
 * click id is the only key, an unknown id updates nothing, and the first
 * beacon per click wins. Always 204 — a beacon has no reader.
 */
import { applyBeacon, BeaconBody } from "@/lib/attr-installs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_BODY_BYTES = 2_048;

export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 204 });
    const parsed = BeaconBody.safeParse(JSON.parse(text));
    if (parsed.success) await applyBeacon(parsed.data);
  } catch {
    // malformed or hostile input is simply ignored
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
