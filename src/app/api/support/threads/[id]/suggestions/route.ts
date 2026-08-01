/**
 * GET /api/support/threads/[id]/suggestions
 *
 * "Maybe this user?" — Stripe customers whose card billing name matches
 * the email sender's display name, for threads whose address matches no
 * account. `?q=` replaces the automatic match with a manual name search.
 *
 * Reads the local stripe_customer_names index (Stripe itself cannot
 * search by name), then enriches the top few with live subscription data
 * so the card can show plan and spend before linking.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { getThread, supportDbConfigured } from "@/lib/support/db";
import {
  searchStripeNames,
  suggestByName,
  type StripeNameRow,
} from "@/lib/support/stripe-names";
import { contextFromStripeCustomers } from "@/lib/support/resolve-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Enriching hits Stripe twice per customer, so cap it. */
const ENRICH_LIMIT = 4;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  const { id } = await params;
  try {
    const thread = await getThread(id);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    const rows: StripeNameRow[] = q
      ? await searchStripeNames(q, ENRICH_LIMIT * 2)
      : await suggestByName(thread.counterpart_name, ENRICH_LIMIT);

    const suggestions = await Promise.all(
      rows.slice(0, ENRICH_LIMIT).map(async (r) => {
        const ctx = await contextFromStripeCustomers(
          [r.customer_id],
          r.email,
          { name: r.name },
        ).catch(() => null);
        return {
          customerId: r.customer_id,
          name: r.name,
          email: r.email,
          lastChargeAt: r.last_charge_at,
          subscriptions: ctx?.subscriptions ?? [],
          totalSpentUsd: ctx?.totalSpentUsd ?? 0,
        };
      }),
    );

    return NextResponse.json({
      ok: true,
      manual: !!q,
      suggestions,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
