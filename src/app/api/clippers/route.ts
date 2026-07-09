/**
 * Clippers admin API — called by the ClipperAdmin screen (same-origin).
 *
 * GET  → all clippers with computed totals (earnings, views), videos, payouts.
 * POST → { action, ... } mutations:
 *   create_clipper { name, code, facebook_page_url?, revshare_pct?, notes? }
 *   update_clipper { id, ...patch }
 *   delete_clipper { id }               (soft: active=false)
 *   add_video      { clipper_id, url, platform?, title? }
 *   update_video   { id, ...patch }     (manual_views, title, active, ...)
 *   delete_video   { id }
 *   record_payout  { clipper_id, amount_usd, paid_at?, method?, note? }
 *   delete_payout  { id }
 *
 * Auth: checkIngestAuth (repo's blessed pattern for UI-called routes — the
 * dashboard sits behind the shared-password Gate).
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  clippersDbConfigured,
  loadClipperBundle,
  sbGet,
  sbPost,
  sbPatch,
  sbDelete,
  type ClipperRow,
} from "@/lib/clippers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!clippersDbConfigured()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }
  try {
    const clippers = await sbGet<ClipperRow[]>("clippers?order=created_at.asc&limit=200");
    const bundles = await Promise.all(clippers.map((c) => loadClipperBundle(c)));
    return NextResponse.json({
      clippers: bundles.map((b) => ({
        ...b.clipper,
        totals: {
          videos: b.videos.length,
          views: b.totalViews,
          conversions: b.earnings.conversions,
          netUsd: b.earnings.netUsd,
          pendingUsd: b.earnings.pendingUsd,
          payableUsd: b.earnings.payableUsd,
          paidUsd: b.earnings.paidUsd,
          balanceUsd: b.earnings.balanceUsd,
        },
        videos: b.videos,
        payouts: b.payouts,
        recentTxns: b.earnings.txns.slice(0, 50),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

type Action =
  | "create_clipper"
  | "update_clipper"
  | "delete_clipper"
  | "add_video"
  | "update_video"
  | "delete_video"
  | "record_payout"
  | "delete_payout";

interface PostBody {
  action?: Action;
  id?: string;
  clipper_id?: string;
  name?: string;
  code?: string;
  facebook_page_url?: string | null;
  revshare_pct?: number;
  notes?: string | null;
  active?: boolean;
  url?: string;
  platform?: string;
  title?: string | null;
  manual_views?: number | null;
  amount_usd?: number;
  paid_at?: string;
  method?: string | null;
  note?: string | null;
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!clippersDbConfigured()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "create_clipper": {
        if (!body.name?.trim() || !body.code?.trim()) {
          return NextResponse.json({ error: "name and code required" }, { status: 400 });
        }
        const rows = await sbPost<ClipperRow>("clippers", [
          {
            name: body.name.trim(),
            code: body.code.trim().toUpperCase(),
            facebook_page_url: body.facebook_page_url?.trim() || null,
            revshare_pct: Number(body.revshare_pct) || 20,
            notes: body.notes ?? null,
          },
        ]);
        return NextResponse.json({ ok: true, clipper: rows[0] });
      }
      case "update_clipper": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) patch.name = body.name.trim();
        if (body.code !== undefined) patch.code = body.code.trim().toUpperCase();
        if (body.facebook_page_url !== undefined) {
          patch.facebook_page_url = body.facebook_page_url?.trim() || null;
        }
        if (body.revshare_pct !== undefined) patch.revshare_pct = Number(body.revshare_pct) || 20;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.active !== undefined) patch.active = body.active;
        const rows = await sbPatch<ClipperRow>(`clippers?id=eq.${body.id}`, patch);
        return NextResponse.json({ ok: true, clipper: rows[0] });
      }
      case "delete_clipper": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await sbPatch(`clippers?id=eq.${body.id}`, { active: false });
        return NextResponse.json({ ok: true });
      }
      case "add_video": {
        if (!body.clipper_id || !body.url?.trim()) {
          return NextResponse.json({ error: "clipper_id and url required" }, { status: 400 });
        }
        const rows = await sbPost(
          "clipper_videos",
          [
            {
              clipper_id: body.clipper_id,
              url: body.url.trim(),
              platform: body.platform ?? "facebook",
              title: body.title ?? null,
              source: "admin",
            },
          ],
          { onConflict: "url" },
        );
        return NextResponse.json({ ok: true, video: rows[0] });
      }
      case "update_video": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const patch: Record<string, unknown> = {};
        if (body.title !== undefined) patch.title = body.title;
        if (body.manual_views !== undefined) patch.manual_views = body.manual_views;
        if (body.active !== undefined) patch.active = body.active;
        const rows = await sbPatch(`clipper_videos?id=eq.${body.id}`, patch);
        return NextResponse.json({ ok: true, video: rows[0] });
      }
      case "delete_video": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await sbPatch(`clipper_videos?id=eq.${body.id}`, { active: false });
        return NextResponse.json({ ok: true });
      }
      case "record_payout": {
        if (!body.clipper_id || !Number.isFinite(Number(body.amount_usd))) {
          return NextResponse.json(
            { error: "clipper_id and amount_usd required" },
            { status: 400 },
          );
        }
        const rows = await sbPost("clipper_payouts", [
          {
            clipper_id: body.clipper_id,
            amount_usd: Number(body.amount_usd),
            ...(body.paid_at ? { paid_at: body.paid_at } : {}),
            method: body.method ?? null,
            note: body.note ?? null,
          },
        ]);
        return NextResponse.json({ ok: true, payout: rows[0] });
      }
      case "delete_payout": {
        if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
        await sbDelete(`clipper_payouts?id=eq.${body.id}`);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
