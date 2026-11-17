/**
 * GET /api/experiment-readouts/paywall-close-x — the Paywall X test readout
 * (src/lib/paywall-x). Admin only: the payload lists recent exposed users.
 * `?fresh=1` recomputes past the 5-minute cache.
 *
 * Off production only, `?demo=fixture|empty|unconfigured` returns the
 * made-up fixture, the no-data state or the missing-setup state, so the page
 * can be looked at on a machine with no database keys.
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { loadPaywallXReadout, paywallXSetup, type PaywallXResponse } from "@/lib/paywall-x/data";
import { EMPTY_INPUT, demoInput } from "@/lib/paywall-x/fixtures";
import { buildPaywallXReadout } from "@/lib/paywall-x/readout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function demo(kind: string): PaywallXResponse | null {
  const now = new Date();
  const setup = paywallXSetup();
  if (kind === "fixture") return { configured: true, setup: { missing: [] }, readout: buildPaywallXReadout(demoInput({ now }), now) };
  if (kind === "empty") return { configured: true, setup: { missing: [] }, readout: buildPaywallXReadout(EMPTY_INPUT, now) };
  if (kind === "unconfigured") {
    return { configured: false, setup: { missing: setup.missing.length ? setup.missing : ["CONSUMER_SUPABASE_URL", "CONSUMER_SERVICE_ROLE_KEY"] } };
  }
  return null;
}

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const demoKind = url.searchParams.get("demo");
  if (demoKind && process.env.NODE_ENV !== "production") {
    const body = demo(demoKind);
    if (body) return NextResponse.json({ ok: true, demo: demoKind, ...body });
  }
  try {
    const body = await loadPaywallXReadout({ fresh: url.searchParams.get("fresh") === "1" });
    return NextResponse.json({ ok: true, ...body });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
