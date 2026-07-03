/**
 * Weekly recap generation + persistence + email delivery.
 *
 * Numbers are deterministic (buildWeeklyStats); Claude writes only the
 * qualitative layer via forced structured output. Recaps persist to
 * growth_recaps (service role) and optionally go out through an n8n
 * webhook (N8N_GROWTH_RECAP_WEBHOOK_URL) that emails Dan — the repo has
 * no first-party email vendor, and n8n is already part of the stack.
 */
import { z } from "zod";
import { MODELS } from "@/lib/models";
import {
  buildWeeklyStats,
  structuredCall,
  GROWTH_SYSTEM_PROMPT,
  type WeeklyStats,
} from "@/lib/growth-tools";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

// --- schema ------------------------------------------------------------------

const PerformerSchema = z.object({
  ad_id: z.string(),
  why: z.string(),
  who: z.string(),
  what_next: z.string(),
});

export const RecapSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  top_performers: z.array(PerformerSchema).max(3),
  bottom_performers: z.array(PerformerSchema).max(3),
  patterns: z
    .array(z.object({ dimension: z.string(), finding: z.string() }))
    .max(5),
  actions: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        urgency: z.enum(["now", "this_week", "watch"]),
      }),
    )
    .max(6),
});

export type WeeklyRecap = z.infer<typeof RecapSchema>;

export const RECAP_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "One punchy sentence for the week, with the single most important number. e.g. \"Spend up 12% to $3.2K while cost per trial jumped 42% — the new batch isn't carrying its weight yet.\"",
    },
    summary: {
      type: "string",
      description: "2-4 sentences: what happened this week and the one thing that matters most. Plain text.",
    },
    top_performers: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          ad_id: { type: "string", description: "Must be an ad_id from ads_this_week" },
          why: { type: "string", description: "WHY it worked — creative + audience mechanics, cite numbers" },
          who: { type: "string", description: "WHO it's hitting — the buyer/persona insight" },
          what_next: { type: "string", description: "WHAT NEXT — one specific action (scale $X, cut N hook variants, iterate)" },
        },
        required: ["ad_id", "why", "who", "what_next"],
      },
    },
    bottom_performers: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          ad_id: { type: "string", description: "Must be an ad_id from ads_this_week" },
          why: { type: "string", description: "WHY NOT — what's failing, cite numbers" },
          who: { type: "string", description: "WHO it's (mis)targeting" },
          what_next: { type: "string", description: "WHAT NEXT — fix, pause, or reposition (specific)" },
        },
        required: ["ad_id", "why", "who", "what_next"],
      },
    },
    patterns: {
      type: "array",
      maxItems: 5,
      description: "Cross-creative patterns: format (video vs static), persona, hook/angle, spend concentration.",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string", description: "Short label, e.g. 'Format mix', 'Persona', 'Hook strategy'" },
          finding: { type: "string", description: "The takeaway with numbers, e.g. 'UGC video is the only format under $20/trial — scale it.'" },
        },
        required: ["dimension", "finding"],
      },
    },
    actions: {
      type: "array",
      maxItems: 6,
      description: "Prioritized action list for the coming week.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          urgency: { type: "string", enum: ["now", "this_week", "watch"] },
        },
        required: ["title", "detail", "urgency"],
      },
    },
  },
  required: ["headline", "summary", "top_performers", "bottom_performers", "patterns", "actions"],
};

// --- generation --------------------------------------------------------------

/** Deterministic "From the app world" item (viral_app_posts, no AI). */
export interface AppWorldItem {
  app_name: string | null;
  platform: string;
  views: number;
  hook_text: string | null;
  why_it_hit: string | null;
  format: string | null;
  url: string;
}

/** Recap stats carry an optional app-world section alongside the ad stats. */
export type RecapStats = WeeklyStats & { app_world?: AppWorldItem[] };

export interface RecapRow {
  id?: string;
  week_start: string;
  generated_at?: string;
  model: string;
  stats: RecapStats;
  recap: WeeklyRecap;
  source?: "manual" | "cron";
  sent_at?: string | null;
}

/**
 * Top fresh viral app posts for the recap: prefers posts that surfaced in
 * the last 7 days; falls back to the all-time top when the week was quiet.
 */
async function fetchAppWorld(limit = 5): Promise<AppWorldItem[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return [];
  const select = "select=app_name,platform,view_count,hook_text,why_it_hit,format,post_url";
  const get = async (extra: string): Promise<AppWorldItem[]> => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/viral_app_posts?${select}&${extra}&order=view_count.desc&limit=${limit}`,
        {
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
          cache: "no-store",
        },
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      return rows.map((p) => ({
        app_name: (p.app_name as string) ?? null,
        platform: String(p.platform ?? ""),
        views: Number(p.view_count) || 0,
        hook_text: (p.hook_text as string) ?? null,
        why_it_hit: (p.why_it_hit as string) ?? null,
        format: (p.format as string) ?? null,
        url: String(p.post_url ?? ""),
      }));
    } catch {
      return [];
    }
  };
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const fresh = await get(`first_seen_at=gte.${encodeURIComponent(weekAgo)}`);
  if (fresh.length >= 3) return fresh;
  return get("is_confirmed_app=eq.true");
}

export async function generateWeeklyRecap(model: string = MODELS.SONNET_4_6): Promise<RecapRow> {
  const [baseStats, appWorld] = await Promise.all([buildWeeklyStats(), fetchAppWorld()]);
  const stats: RecapStats = { ...baseStats, app_world: appWorld };
  const { value: recap } = await structuredCall({
    model,
    system:
      GROWTH_SYSTEM_PROMPT +
      `\n\nYou are writing the WEEKLY PERFORMANCE RECAP. You get one JSON payload of pre-computed stats — do not invent numbers beyond it. Rank top/bottom performers primarily by cost_per_trial among ads with meaningful spend (>$50 this week); use spend + hook/hold/CTR as supporting evidence. If fewer than 3 ads qualify, return fewer. Trial counts are small-sample — hedge accordingly in wording, not in decisiveness of the action.`,
    user:
      `Here are this week's stats (window ${stats.window.since} → ${stats.window.until}, vs prior week):\n\n` +
      JSON.stringify(stats) +
      `\n\nWrite the weekly recap now via the emit_recap tool.`,
    toolName: "emit_recap",
    toolDescription: "Emit the structured weekly performance recap.",
    schema: RECAP_TOOL_SCHEMA,
    validate: (v) => RecapSchema.parse(v),
    maxTokens: 4000,
  });
  return { week_start: stats.window.since, model, stats, recap };
}

// --- persistence -------------------------------------------------------------

export async function persistRecap(
  row: RecapRow,
  source: "manual" | "cron",
): Promise<RecapRow> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return { ...row, source };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/growth_recaps`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      week_start: row.week_start,
      model: row.model,
      stats: row.stats,
      recap: row.recap,
      source,
    }),
  });
  if (!res.ok) throw new Error(`recap persist failed: ${res.status} ${await res.text()}`);
  const [inserted] = (await res.json()) as RecapRow[];
  return inserted ?? { ...row, source };
}

export async function listRecaps(limit = 12): Promise<RecapRow[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return [];
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/growth_recaps?select=*&order=generated_at.desc&limit=${limit}`,
    {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`recap list failed: ${res.status}`);
  return (await res.json()) as RecapRow[];
}

async function markSent(id: string): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/growth_recaps?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ sent_at: new Date().toISOString() }),
    });
  } catch {
    // delivery already happened; a missing sent_at stamp is cosmetic
  }
}

// --- email (via n8n webhook) ---------------------------------------------------

function fmtUsd(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 });
}

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${Math.round(Number(n))}%`;
}

/** Minimal, email-client-safe HTML rendering of a recap. */
export function recapEmailHtml(row: RecapRow): string {
  const t = row.stats.totals;
  const adName = (id: string) =>
    row.stats.ads_this_week.find((a) => a.ad_id === id)?.ad_name ?? id;
  const performer = (p: WeeklyRecap["top_performers"][number]) =>
    `<div style="margin:0 0 14px;padding:10px 12px;border-left:3px solid #ccc;background:#faf8f4;">
      <div style="font-weight:600;margin-bottom:4px;">${esc(adName(p.ad_id))}</div>
      <div><b>Why:</b> ${esc(p.why)}</div>
      <div><b>Who:</b> ${esc(p.who)}</div>
      <div><b>Next:</b> ${esc(p.what_next)}</div>
    </div>`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1816;">
    <h2 style="font-weight:600;">${esc(row.recap.headline)}</h2>
    <p style="color:#555;">Week of ${row.week_start} · generated by Growth AI</p>
    <table style="width:100%;border-collapse:collapse;margin:14px 0;" cellpadding="8">
      <tr style="background:#f4efe6;font-size:12px;text-transform:uppercase;color:#777;">
        <td>Spend</td><td>Cost/trial</td><td>RC trials</td><td>Revenue</td><td>Launched</td>
      </tr>
      <tr style="font-size:16px;font-weight:600;">
        <td>${fmtUsd(t.spend)} <span style="font-size:11px;color:#999;">${pct(t.spend_delta_pct)}</span></td>
        <td>${t.cost_per_trial != null ? fmtUsd(t.cost_per_trial) : "—"}</td>
        <td>${t.rc_trials}</td>
        <td>${fmtUsd(t.rc_revenue)}</td>
        <td>${t.creatives_launched}</td>
      </tr>
    </table>
    <p>${esc(row.recap.summary)}</p>
    <h3 style="color:#2e6e4e;">▲ Top performers</h3>
    ${row.recap.top_performers.map(performer).join("")}
    <h3 style="color:#b3502f;">▼ Bottom performers</h3>
    ${row.recap.bottom_performers.map(performer).join("")}
    <h3>Patterns</h3>
    <ul>${row.recap.patterns.map((p) => `<li><b>${esc(p.dimension)}:</b> ${esc(p.finding)}</li>`).join("")}</ul>
    <h3>Next actions</h3>
    <ul>${row.recap.actions.map((a) => `<li><b>[${a.urgency.replace("_", " ")}]</b> <b>${esc(a.title)}</b> — ${esc(a.detail)}</li>`).join("")}</ul>
    ${
      row.stats.app_world?.length
        ? `<h3>📱 From the app world</h3>
    <p style="color:#777;font-size:12px;margin-top:-6px;">What other apps' organic content went viral this week (Inspo tab has the full feed).</p>
    ${row.stats.app_world
      .map(
        (p) => `<div style="margin:0 0 10px;padding:8px 12px;border-left:3px solid #d8c9a8;background:#faf8f4;">
      <div><b>${esc(p.app_name ?? "Unknown app")}</b> · ${p.platform === "tiktok" ? "TikTok" : "Instagram"} · ${(p.views / 1_000_000) >= 1 ? `${(p.views / 1_000_000).toFixed(1)}M` : `${Math.round(p.views / 1000)}K`} views${p.hook_text ? ` — <i>“${esc(p.hook_text)}”</i>` : ""}</div>
      ${p.why_it_hit ? `<div style="color:#555;font-size:13px;">${esc(p.why_it_hit)}</div>` : ""}
      <a href="${esc(p.url)}" style="font-size:12px;">watch →</a>
    </div>`,
      )
      .join("")}`
        : ""
    }
    <p style="color:#999;font-size:12px;">Open the Growth AI tab in the DreamMe admin dash for the interactive version.</p>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * POST the recap to the n8n delivery webhook. Skips (with a note) when the
 * env isn't configured — the recap still persists either way.
 */
export async function sendRecapEmail(row: RecapRow): Promise<{ sent: boolean; note?: string }> {
  const url = process.env.N8N_GROWTH_RECAP_WEBHOOK_URL ?? "";
  if (!url) return { sent: false, note: "N8N_GROWTH_RECAP_WEBHOOK_URL not set — skipped email" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dreamme-secret": process.env.INGEST_TOKEN ?? "",
      },
      body: JSON.stringify({
        subject: `Growth AI weekly recap · ${row.week_start} · ${row.recap.headline.slice(0, 80)}`,
        week_start: row.week_start,
        headline: row.recap.headline,
        summary: row.recap.summary,
        html: recapEmailHtml(row),
      }),
    });
    if (!res.ok) return { sent: false, note: `webhook ${res.status}` };
    if (row.id) await markSent(row.id);
    return { sent: true };
  } catch (e) {
    return { sent: false, note: e instanceof Error ? e.message : String(e) };
  }
}
