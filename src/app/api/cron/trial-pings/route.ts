/**
 * Silent-push trial-quality pings — the DAD-native replacement for the dead
 * n8n workflow wEZAcV8qNd0OTUBQ (instance offline since ~2026-07-06).
 *
 * Every run: find trials whose +2h (trial_qualified) or +24h (trial_engaged)
 * moment falls inside a catch-up window, CLAIM them in trial_ping_log (PK
 * insert, on-conflict-do-nothing — the correctness core: at most one ping per
 * trial per type, ever, across crashed/concurrent runs), then wake each user's
 * device with a silent Expo push. The app does the rest on-device: re-checks
 * willRenew, fires the event to the Meta SDK and Singular, and keeps its own
 * AsyncStorage ledger as the second idempotency layer.
 *
 * Triggered every 15 minutes by .github/workflows/trial-pings.yml (GitHub
 * Actions), NOT vercel.json — Hobby-plan crons are daily-only and this needs
 * sub-hour cadence. A red Actions run is the failure signal.
 *
 * Windows are deliberately WIDE (4h of catch-up): consecutive runs re-see the
 * same trials and the ledger dedupes. This tolerates scheduler lag and
 * outages up to 4h; longer outages drop pings permanently BY DESIGN — a
 * "qualified at +2h" check delivered at +9h measures something else. See
 * docs/trial-pings.md.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  sendTrialPings,
  type TrialPingTarget,
} from "@/lib/vendors/expo-push";
import {
  pickLatestTokenPerUser,
  pingWindows,
  type TokenRow,
} from "@/lib/trial-pings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const CONSUMER_URL = process.env.CONSUMER_SUPABASE_URL ?? "";
const CONSUMER_KEY = process.env.CONSUMER_SERVICE_ROLE_KEY ?? "";

interface RcTrialRow {
  original_transaction_id: string | null;
  app_user_id: string | null;
  product_id: string | null;
  price_usd: string | number | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "internal Supabase service role not configured" },
      { status: 500 },
    );
  }
  if (!CONSUMER_URL || !CONSUMER_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "consumer Supabase not configured — set CONSUMER_SUPABASE_URL and CONSUMER_SERVICE_ROLE_KEY (see docs/trial-pings.md)",
      },
      { status: 500 },
    );
  }

  const internalHeaders = {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };

  const counts = {
    candidates: 0,
    claimed: 0,
    sent_ok: 0,
    expo_errors: 0,
    no_token: 0,
  };

  for (const win of pingWindows(new Date())) {
    // 1. Candidate trials in this window (internal DB, RC webhook feed).
    const q = new URLSearchParams({
      select: "original_transaction_id,app_user_id,product_id,price_usd",
      type: "eq.INITIAL_PURCHASE",
      period_type: "eq.TRIAL",
      and: `(event_at.gt.${win.from},event_at.lte.${win.to})`,
    });
    const candRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rc_events?${q}&environment=not.eq.SANDBOX`,
      { headers: internalHeaders, cache: "no-store" },
    );
    if (!candRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `rc_events query failed: ${candRes.status} ${await candRes.text()}`,
        },
        { status: 500 },
      );
    }
    const rows = ((await candRes.json()) as RcTrialRow[]).filter(
      (r) => r.original_transaction_id && r.app_user_id,
    );
    counts.candidates += rows.length;
    if (!rows.length) continue;

    // 2. CLAIM: insert with ignore-duplicates; only rows actually inserted
    // (returned representation) are ours to send. Everything else was claimed
    // by an earlier run.
    const claimRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trial_ping_log?on_conflict=original_transaction_id,ping_type`,
      {
        method: "POST",
        headers: {
          ...internalHeaders,
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(
          rows.map((r) => ({
            original_transaction_id: r.original_transaction_id,
            ping_type: win.pingType,
            app_user_id: r.app_user_id,
            product_id: r.product_id,
            price_usd: r.price_usd,
          })),
        ),
      },
    );
    if (!claimRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `ledger claim failed: ${claimRes.status} ${await claimRes.text()}`,
        },
        { status: 500 },
      );
    }
    const claimed = (await claimRes.json()) as Array<{
      original_transaction_id: string;
      app_user_id: string;
      product_id: string | null;
      price_usd: string | number | null;
    }>;
    counts.claimed += claimed.length;
    if (!claimed.length) continue;

    // 3. Push tokens from the CONSUMER DB. RC anonymous ids ($RCAnonymousID:…)
    // can't match a user row — they resolve as no_token.
    const userIds = [
      ...new Set(claimed.map((c) => c.app_user_id).filter((u) => UUID_RE.test(u))),
    ];
    let tokenByUser = new Map<string, string>();
    if (userIds.length) {
      const tokRes = await fetch(
        `${CONSUMER_URL}/rest/v1/push_tokens?select=user_id,expo_push_token,updated_at&user_id=in.(${userIds.join(",")})&order=updated_at.desc`,
        {
          headers: {
            apikey: CONSUMER_KEY,
            Authorization: `Bearer ${CONSUMER_KEY}`,
          },
          cache: "no-store",
        },
      );
      if (!tokRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: `push_tokens query failed: ${tokRes.status} ${await tokRes.text()}`,
          },
          { status: 500 },
        );
      }
      tokenByUser = pickLatestTokenPerUser((await tokRes.json()) as TokenRow[]);
    }

    // 4. Split into sendable vs no-token; record no-token outcomes.
    const targets: TrialPingTarget[] = [];
    const targetTx: string[] = [];
    const noToken: string[] = [];
    for (const c of claimed) {
      const token = tokenByUser.get(c.app_user_id);
      if (!token) {
        noToken.push(c.original_transaction_id);
        continue;
      }
      targets.push({
        expoPushToken: token,
        pingType: win.pingType,
        originalTransactionId: c.original_transaction_id,
        productId: c.product_id ?? "",
        priceUsd: Number(c.price_usd ?? 0),
      });
      targetTx.push(c.original_transaction_id);
    }
    counts.no_token += noToken.length;

    const mark = async (txIds: string[], status: string, detail?: string) => {
      for (const tx of txIds) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/trial_ping_log?original_transaction_id=eq.${encodeURIComponent(tx)}&ping_type=eq.${win.pingType}`,
          {
            method: "PATCH",
            headers: { ...internalHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({
              expo_status: status,
              expo_detail: detail ?? null,
            }),
          },
        );
      }
    };
    await mark(noToken, "no_token");

    // 5. Send. A vendor failure 502s — claimed rows keep null expo_status,
    // which is the visible "claimed but not delivered" state.
    if (targets.length) {
      let tickets;
      try {
        tickets = await sendTrialPings(targets);
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: (e as Error).message, ...counts },
          { status: 502 },
        );
      }
      for (let i = 0; i < tickets.length; i++) {
        const t = tickets[i];
        if (t.status === "ok") {
          counts.sent_ok++;
          await mark([targetTx[i]], "ok", t.id);
        } else {
          counts.expo_errors++;
          await mark(
            [targetTx[i]],
            `error:${t.details?.error ?? "unknown"}`,
            t.message?.slice(0, 300),
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true, ...counts });
}
