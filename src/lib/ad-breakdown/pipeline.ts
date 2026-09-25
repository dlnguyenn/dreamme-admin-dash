/**
 * Ad breakdown · the pipeline. One synchronous pass, under a minute:
 *   1. Meta ad: creative + 14-day insights + the served mp4 (or an uploaded
 *      cut from Storage for a pre-flight).
 *   2. Re-host the video in our bucket so the UI can seek it for frames.
 *   3. Gemini listen pass (scenes, transcript, music, claims).
 *   4. Gemini pre-flight pass against Motion's rubric, forced yes/no anchors.
 *   5. Derive scores, bands, pacing and the retention-interval evidence.
 *   6. Claude writes the verdict from the evidence (no video needed).
 *   7. Upsert one ad_breakdowns row.
 *
 * Frames are NOT extracted here (no ffmpeg on Vercel): the browser captures
 * them from the re-hosted video at the timestamps stored in `frames`.
 * Same idiom as video-analysis.ts: service-role writes, plain fetch.
 */
import { resolveMeta, NO_META } from "@/lib/meta-resolve";
import { uploadBytesToStorage, storageBucket } from "@/lib/storage";
import { MODELS } from "@/lib/models";
import { logAiUsageEvent } from "@/lib/vendors/ai-usage-logger";
import { fetchAdDetails, fetchAdInsights, downloadAdVideo, type AdDetails } from "./meta";
import { geminiJson, prepareVideo } from "./gemini";
import { LISTEN_SCHEMA, PREFLIGHT_SCHEMA, listenPrompt, preflightPrompt, VERDICT_SYSTEM, verdictUser } from "./prompts";
import {
  parseInsights,
  retentionCurve,
  pacingFromCuts,
  deriveScores,
  frameTimes,
  attachEvidence,
  hookBand,
  holdBand,
  type AdMetrics,
  type CurvePoint,
  type Interval,
  type ListenResult,
  type PreflightResult,
  type DerivedScores,
  type FrameTime,
} from "./rubric";
import { mp4Duration } from "./mp4";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
const ROUTE = "/api/ad-breakdown";

export interface BreakdownRow {
  id: string;
  source_kind: "meta_ad" | "upload";
  source_key: string;
  ad_id: string | null;
  name: string | null;
  status: "running" | "done" | "failed";
  error: string | null;
  video_url: string | null;
  video_bytes: number | null;
  duration_s: number | null;
  days: number | null;
  ad: AdDetails | null;
  metrics: AdMetrics | null;
  retention: { curve: CurvePoint[]; intervals: Interval[] } | null;
  listen: ListenResult | null;
  preflight: PreflightResult | null;
  scores: DerivedScores | null;
  frames: FrameTime[] | null;
  verdict: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

// ── Supabase (service role: this runs server-side only) ─────────────────────

function sbHeaders(extra: Record<string, string> = {}) {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Supabase service role not configured");
  return { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, ...extra };
}

async function sbSelect<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Supabase read failed (${path.split("?")[0]}): ${res.status}`);
  return (await res.json()) as T[];
}

async function sbUpsert(body: Record<string, unknown>): Promise<BreakdownRow> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_breakdowns?on_conflict=source_kind,source_key`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase write failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as BreakdownRow[];
  if (!rows[0]) throw new Error("ad_breakdowns upsert returned no row");
  return rows[0];
}

export async function getBreakdown(kind: "meta_ad" | "upload", key: string): Promise<BreakdownRow | null> {
  const rows = await sbSelect<BreakdownRow>(
    `ad_breakdowns?select=*&source_kind=eq.${kind}&source_key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getBreakdownById(id: string): Promise<BreakdownRow | null> {
  const rows = await sbSelect<BreakdownRow>(`ad_breakdowns?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] ?? null;
}

export async function listBreakdowns(kind: "meta_ad" | "upload", limit = 30): Promise<BreakdownRow[]> {
  return sbSelect<BreakdownRow>(
    `ad_breakdowns?select=id,source_kind,source_key,ad_id,name,status,error,video_url,duration_s,scores,created_at,updated_at` +
      `&source_kind=eq.${kind}&order=created_at.desc&limit=${limit}`,
  );
}

// ── the verdict (Claude Sonnet, text only) ──────────────────────────────────

/** Sonnet list price, USD per token, for the spend dashboard. */
const SONNET_IN_USD = 3 / 1_000_000;
const SONNET_OUT_USD = 15 / 1_000_000;

async function writeVerdict(evidence: unknown): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELS.SONNET_4_6,
        max_tokens: 1000,
        system: VERDICT_SYSTEM,
        messages: [{ role: "user", content: verdictUser(evidence) }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const input = j.usage?.input_tokens ?? 0;
    const output = j.usage?.output_tokens ?? 0;
    void logAiUsageEvent({
      vendor: "anthropic",
      model: MODELS.SONNET_4_6,
      route: ROUTE,
      inputTokens: input,
      outputTokens: output,
      computedUsd: input * SONNET_IN_USD + output * SONNET_OUT_USD,
      metadata: { label: "verdict" },
    });
    const text = (j.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null; // the verdict is a convenience; the evidence is the product
  }
}

// ── entry point ─────────────────────────────────────────────────────────────

export interface BreakdownInput {
  adId?: string;
  /** Storage path of an uploaded cut, e.g. ad-breakdowns/uploads/<uuid>.mp4 */
  uploadPath?: string;
  name?: string;
  days?: number;
  force?: boolean;
}

export async function runBreakdown(input: BreakdownInput): Promise<BreakdownRow> {
  const days = input.days ?? 14;
  const kind: BreakdownRow["source_kind"] = input.adId ? "meta_ad" : "upload";
  const key = input.adId ?? input.uploadPath;
  if (!key) throw new Error("need adId or uploadPath");

  if (!input.force) {
    const cached = await getBreakdown(kind, key);
    if (cached?.status === "done") return cached;
  }

  await sbUpsert({ source_kind: kind, source_key: key, ad_id: input.adId ?? null, name: input.name ?? null, status: "running", error: null });

  try {
    // 1. source
    let det: AdDetails | null = null;
    let metrics: AdMetrics | null = null;
    let bytes: Buffer;
    let mime = "video/mp4";
    let videoUrl: string;

    if (input.adId) {
      const meta = await resolveMeta();
      if (!meta) throw new Error(NO_META);
      det = await fetchAdDetails(meta.token, input.adId);
      const raw = await fetchAdInsights(meta.token, input.adId, days);
      metrics = raw ? parseInsights(raw) : null;
      const dl = await downloadAdVideo(meta.token, det);
      bytes = dl.bytes;
      mime = dl.mime;
      // 2. re-host: fbcdn URLs are signed and expire; the UI seeks this copy for frames
      videoUrl = await uploadBytesToStorage(storageBucket(), `ad-breakdowns/meta/${input.adId}.mp4`, bytes, "video/mp4");
    } else {
      videoUrl = `${SUPABASE_URL}/storage/v1/object/public/${storageBucket()}/${input.uploadPath}`;
      const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`uploaded video not readable: HTTP ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
      mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
      if (!mime.startsWith("video/")) mime = "video/mp4";
    }

    // 3. listen pass
    const video = await prepareVideo(bytes, mime);
    const listen = await geminiJson<ListenResult>({
      video,
      prompt: listenPrompt(det, mp4Duration(bytes)),
      schema: LISTEN_SCHEMA,
      label: "listen",
      route: ROUTE,
    });
    const dur = mp4Duration(bytes) ?? listen.data.duration_s;
    const scenes = listen.data.scenes ?? [];
    const cuts = scenes.map((s) => s.start_s).filter((t) => t > 0);
    const pacing = pacingFromCuts(cuts, dur);

    // 4. pre-flight pass
    const preflight = await geminiJson<PreflightResult>({
      video,
      prompt: preflightPrompt(det, dur, pacing, listen.data.transcript ?? []),
      schema: PREFLIGHT_SCHEMA,
      label: "preflight",
      route: ROUTE,
      temperature: 0,
    });

    // 5. derive
    const scores = deriveScores(preflight.data, pacing);
    const frames = frameTimes(dur, cuts);
    let retention: BreakdownRow["retention"] = null;
    if (metrics && metrics.impressions > 0) {
      retention = retentionCurve(metrics, dur);
      attachEvidence(retention.intervals, listen.data.transcript ?? [], scenes, frames);
    }

    // 6. verdict
    const biggest = retention?.intervals.length
      ? retention.intervals.reduce((a, b) => (b.lost > a.lost ? b : a))
      : null;
    const verdict = await writeVerdict({
      mode: metrics ? "aired" : "unaired",
      ad: det && { name: det.name, campaign: det.campaign, adset: det.adset, primary_text: det.primary_text, headline: det.headline, cta_button: det.cta },
      name: input.name ?? det?.name ?? null,
      duration_s: dur,
      metrics: metrics && {
        spend: metrics.spend,
        impressions: metrics.impressions,
        ctr_pct: metrics.ctr,
        hook_rate: metrics.hook_rate,
        hook_band: hookBand(metrics.hook_rate),
        hold_rate: metrics.hold_rate,
        hold_band: holdBand(metrics.hold_rate),
        p25: metrics.p25 / metrics.impressions,
        p50: metrics.p50_rate,
        p75: metrics.p75 / metrics.impressions,
        p100: metrics.completion_rate,
        avg_watch_s: metrics.avg_watch_s,
        installs: metrics.installs,
        trials: metrics.trials,
        cpt: metrics.cpt,
      },
      retention_intervals: retention?.intervals,
      biggest_drop: biggest && { from: biggest.from, to: biggest.to, t0: biggest.t0, t1: biggest.t1, share_of_total_loss: biggest.share_of_total_loss },
      listen: {
        hook_first_3s: listen.data.hook_first_3s,
        hook_score_1_5: listen.data.hook_score_1_5,
        speech_type: listen.data.speech_type,
        speech_delivery: listen.data.speech_delivery,
        music: listen.data.music,
        captions_style: listen.data.captions_style,
        app_first_shown_s: listen.data.app_first_shown_s,
        cta: listen.data.cta,
        scenes,
        claims_or_compliance_flags: listen.data.claims_or_compliance_flags,
        weaknesses: listen.data.weaknesses,
        testable_improvements: listen.data.testable_improvements,
      },
      preflight: {
        hook_tactic: preflight.data.hook_tactic_primary,
        hook_tactic_secondary: preflight.data.hook_tactic_secondary,
        thumbstop_type: preflight.data.thumbstop_type,
        visual_format: preflight.data.visual_format,
        asset_type: preflight.data.asset_type,
        awareness_stage: preflight.data.awareness_stage,
        persona_pain: preflight.data.persona_pain,
        criteria: scores.criteria,
        formula: scores.formula,
        rule_bands: scores.bands,
        gemini_bands: scores.gemini_bands,
        predicted_leak: preflight.data.predicted_leak,
        prediction_reasoning: preflight.data.prediction_reasoning,
        missing_from_formula: preflight.data.missing_from_formula,
        hook_alternatives: preflight.data.hook_alternatives,
      },
      pacing,
    });

    // 7. save
    return await sbUpsert({
      source_kind: kind,
      source_key: key,
      ad_id: input.adId ?? null,
      name: input.name ?? det?.name ?? null,
      status: "done",
      error: null,
      video_url: videoUrl,
      video_bytes: bytes.byteLength,
      duration_s: dur,
      days,
      ad: det,
      metrics,
      retention,
      listen: listen.data,
      preflight: preflight.data,
      scores,
      frames,
      verdict,
      model: listen.model,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sbUpsert({ source_kind: kind, source_key: key, status: "failed", error: message }).catch(() => {});
    throw e;
  }
}
