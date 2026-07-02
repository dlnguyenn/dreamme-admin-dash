/**
 * Execute a user-CONFIRMED Meta action proposed by the Growth AI analyst
 * (or fired from the ad drawer). Refuses without confirm:true; every
 * attempt — success or failure — lands in growth_action_log.
 *
 * Duplications always land PAUSED so a copy can never silently spend.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { resolveMeta, NO_META } from "@/lib/meta-resolve";
import {
  updateEntityStatus,
  updateEntityDailyBudget,
  copyAdSet,
} from "@/lib/vendors/meta-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const Body = z.object({
  action: z.object({
    kind: z.enum(["pause_ad", "activate_ad", "set_adset_budget", "set_campaign_budget", "duplicate_adset"]),
    target_id: z.string().min(1),
    target_name: z.string().optional(),
    params: z
      .object({
        daily_budget_cents: z.number().int().min(100).optional(),
        target_campaign_id: z.string().optional(),
      })
      .optional(),
    reason: z.string().max(600).optional(),
  }),
  confirm: z.boolean(),
  source: z.enum(["analyst_chat", "ad_drawer"]).optional(),
});

async function logAction(row: Record<string, unknown>): Promise<string | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/growth_action_log`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) return null;
    const [inserted] = (await res.json()) as Array<{ id: string }>;
    return inserted?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }

  const { action, confirm } = body;
  if (!confirm) {
    return NextResponse.json(
      { error: "Refusing to apply: pass confirm:true. Nothing was changed." },
      { status: 400 },
    );
  }
  if (
    (action.kind === "set_adset_budget" || action.kind === "set_campaign_budget") &&
    !action.params?.daily_budget_cents
  ) {
    return NextResponse.json({ error: "daily_budget_cents required" }, { status: 400 });
  }

  const meta = await resolveMeta();
  if (!meta) {
    return NextResponse.json({ error: NO_META }, { status: 500 });
  }

  const base = {
    kind: action.kind,
    target_id: action.target_id,
    target_name: action.target_name ?? null,
    params: action.params ?? {},
    reason: action.reason ?? null,
    source: body.source ?? "analyst_chat",
  };

  try {
    let result: Record<string, unknown>;
    if (action.kind === "pause_ad" || action.kind === "activate_ad") {
      const status = action.kind === "pause_ad" ? "PAUSED" : "ACTIVE";
      await updateEntityStatus({ id: action.target_id, status, accessToken: meta.token });
      result = { applied: true, id: action.target_id, status };
    } else if (action.kind === "set_adset_budget" || action.kind === "set_campaign_budget") {
      const cents = action.params!.daily_budget_cents!;
      await updateEntityDailyBudget({
        id: action.target_id,
        dailyBudgetCents: cents,
        accessToken: meta.token,
      });
      result = { applied: true, id: action.target_id, daily_budget_usd: cents / 100 };
    } else {
      // duplicate_adset — always PAUSED so the copy never silently spends
      const res = await copyAdSet({
        adsetId: action.target_id,
        targetCampaignId: action.params?.target_campaign_id,
        deepCopy: true,
        statusOption: "PAUSED",
        renameSuffix: " - Copy",
        accessToken: meta.token,
      });
      result = {
        applied: true,
        copied_adset_id: res.copied_id,
        status: "PAUSED",
        note: "New objects validate async — check Ads Manager in 1-2 min.",
      };
    }

    const logId = await logAction({ ...base, status: "applied", result });
    return NextResponse.json({ ...result, log_id: logId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const logId = await logAction({ ...base, status: "failed", error: message.slice(0, 800) });
    return NextResponse.json({ error: message, log_id: logId }, { status: 500 });
  }
}
