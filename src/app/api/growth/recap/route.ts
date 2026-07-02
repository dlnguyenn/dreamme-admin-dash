/**
 * One-click weekly ad retro (Runneth's "Weekly Performance Recap").
 *
 * The numbers are computed deterministically server-side (buildWeeklyStats);
 * Claude only writes the qualitative layer — WHY it worked, WHO it hit,
 * WHAT NEXT to do — via a forced structured-output tool call. The client
 * joins the returned ad_ids back to its own thumbnails/metrics.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { MODELS, isModelId } from "@/lib/models";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { buildWeeklyStats, structuredCall, GROWTH_SYSTEM_PROMPT } from "@/lib/growth-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PerformerSchema = z.object({
  ad_id: z.string(),
  why: z.string(),
  who: z.string(),
  what_next: z.string(),
});

const RecapSchema = z.object({
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

const RECAP_TOOL_SCHEMA: Record<string, unknown> = {
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

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  let model: string = MODELS.SONNET_4_6;
  try {
    const raw = (await req.json().catch(() => ({}))) as { model?: string };
    if (raw.model && isModelId(raw.model)) model = raw.model;
  } catch {
    // default model
  }

  try {
    const stats = await buildWeeklyStats();

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

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      model,
      stats,
      recap,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
