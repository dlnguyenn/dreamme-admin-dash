/**
 * Ad breakdown · the pure math. Ported 1:1 from the local skill
 * (~/.claude/skills/ad-breakdown/lib/ad_breakdown.py) so the dashboard and
 * the CLI grade an ad identically. No I/O; everything here is unit-tested.
 *
 * Vocabulary (Motion's): hook rate = 3-second plays / impressions; hold rate
 * = ThruPlay / 3-second plays. Meta only exposes nine retention points
 * (plays, 3s, 15s, 30s, 25/50/75/95/100%), so "where viewers leave" is an
 * interval table, not a curve.
 */

// ── Meta insights → metrics ─────────────────────────────────────────────────

interface ActionValue {
  action_type: string;
  value: string | number;
}

/** The raw `/{ad_id}/insights` row for the fields in INSIGHT_FIELDS. */
export interface RawInsights {
  impressions?: string | number;
  reach?: string | number;
  frequency?: string | number;
  spend?: string | number;
  ctr?: string | number;
  inline_link_clicks?: string | number;
  actions?: ActionValue[];
  conversions?: ActionValue[];
  video_play_actions?: ActionValue[];
  video_15_sec_watched_actions?: ActionValue[];
  video_30_sec_watched_actions?: ActionValue[];
  video_thruplay_watched_actions?: ActionValue[];
  video_p25_watched_actions?: ActionValue[];
  video_p50_watched_actions?: ActionValue[];
  video_p75_watched_actions?: ActionValue[];
  video_p95_watched_actions?: ActionValue[];
  video_p100_watched_actions?: ActionValue[];
  video_avg_time_watched_actions?: ActionValue[];
}

export const INSIGHT_FIELDS = [
  "impressions",
  "reach",
  "frequency",
  "spend",
  "ctr",
  "inline_link_clicks",
  "actions",
  "conversions",
  "video_play_actions",
  "video_15_sec_watched_actions",
  "video_30_sec_watched_actions",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_avg_time_watched_actions",
].join(",");

export interface AdMetrics {
  impressions: number;
  reach: number;
  frequency: number;
  spend: number;
  ctr: number;
  link_clicks: number;
  plays: number;
  /** Meta's "3-second video plays": `actions[action_type=video_view]`. */
  views_3s: number;
  views_15s: number;
  views_30s: number;
  thruplay: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p100: number;
  avg_watch_s: number;
  installs: number;
  registrations: number;
  trials: number;
  subs: number;
  hook_rate: number;
  /** Of 3-second viewers, the share reaching ThruPlay (15 s or the end). */
  hold_rate: number;
  p50_rate: number;
  completion_rate: number;
  cpm: number;
  cpi: number | null;
  cpt: number | null;
}

const first = (lst?: ActionValue[]): number => (lst && lst.length ? Number(lst[0].value) || 0 : 0);
const act = (lst: ActionValue[] | undefined, type: string): number =>
  Number(lst?.find((a) => a.action_type === type)?.value ?? 0) || 0;
const n = (v: string | number | undefined): number => Number(v ?? 0) || 0;

export function parseInsights(d: RawInsights): AdMetrics {
  const impressions = n(d.impressions);
  const spend = n(d.spend);
  const views_3s = act(d.actions, "video_view");
  const thruplay = first(d.video_thruplay_watched_actions);
  const p50 = first(d.video_p50_watched_actions);
  const p100 = first(d.video_p100_watched_actions);
  const installs = act(d.actions, "omni_app_install");
  const trials = act(d.conversions, "start_trial_total");
  return {
    impressions,
    reach: n(d.reach),
    frequency: n(d.frequency),
    spend,
    ctr: n(d.ctr),
    link_clicks: n(d.inline_link_clicks),
    plays: first(d.video_play_actions),
    views_3s,
    views_15s: first(d.video_15_sec_watched_actions),
    views_30s: first(d.video_30_sec_watched_actions),
    thruplay,
    p25: first(d.video_p25_watched_actions),
    p50,
    p75: first(d.video_p75_watched_actions),
    p95: first(d.video_p95_watched_actions),
    p100,
    avg_watch_s: first(d.video_avg_time_watched_actions),
    installs,
    registrations: act(d.actions, "omni_complete_registration"),
    trials,
    subs: act(d.conversions, "subscribe_total"),
    hook_rate: impressions ? views_3s / impressions : 0,
    hold_rate: views_3s ? thruplay / views_3s : 0,
    p50_rate: impressions ? p50 / impressions : 0,
    completion_rate: impressions ? p100 / impressions : 0,
    cpm: impressions ? (spend / impressions) * 1000 : 0,
    cpi: installs ? spend / installs : null,
    cpt: trials ? spend / trials : null,
  };
}

// ── benchmarks (Motion) ─────────────────────────────────────────────────────

export type HookBand = "needs work" | "solid" | "strong";
export type HoldBand = "weak" | "average" | "strong";

export function hookBand(x: number): HookBand {
  return x < 0.25 ? "needs work" : x < 0.35 ? "solid" : "strong";
}

export function holdBand(x: number): HoldBand {
  return x < 0.3 ? "weak" : x < 0.6 ? "average" : "strong";
}

// ── retention ───────────────────────────────────────────────────────────────

export interface CurvePoint {
  label: string;
  t: number;
  viewers: number;
  pct_of_impressions: number;
}

export interface Interval {
  from: string;
  to: string;
  t0: number;
  t1: number;
  lost: number;
  lost_pct_of_impr: number;
  lost_pct_per_sec: number;
  share_of_total_loss: number;
  /** Filled by attachEvidence. */
  spoken?: string;
  scenes?: string[];
  frames?: number[];
}

export function milestoneTimes(dur: number): Record<string, number> {
  const ms: Record<string, number> = { "3s": 3 };
  if (dur > 15.5) ms["15s"] = 15;
  if (dur > 30.5) ms["30s"] = 30;
  for (const [name, f] of [
    ["25%", 0.25],
    ["50%", 0.5],
    ["75%", 0.75],
    ["95%", 0.95],
  ] as const) {
    ms[name] = round2(f * dur);
  }
  ms["100%"] = round2(Math.max(dur - 0.25, 0));
  return ms;
}

export function retentionCurve(m: AdMetrics, dur: number): { curve: CurvePoint[]; intervals: Interval[] } {
  const impr = m.impressions;
  if (!impr) return { curve: [], intervals: [] };
  const pts: Array<[string, number, number]> = [
    ["impression", 0, impr],
    ["3s", 3, m.views_3s],
  ];
  if (dur > 15.5) pts.push(["15s", 15, m.views_15s]);
  if (dur > 30.5) pts.push(["30s", 30, m.views_30s]);
  for (const [name, f, v] of [
    ["25%", 0.25, m.p25],
    ["50%", 0.5, m.p50],
    ["75%", 0.75, m.p75],
    ["95%", 0.95, m.p95],
    ["100%", 1, m.p100],
  ] as const) {
    pts.push([name, round2(f * dur), v]);
  }
  pts.sort((a, b) => a[1] - b[1]);
  const curve: CurvePoint[] = [];
  for (const [label, t, viewers] of pts) {
    // 3s and 25% collide on very short ads: keep the first.
    if (curve.length && Math.abs(t - curve[curve.length - 1].t) < 0.5) continue;
    curve.push({ label, t, viewers, pct_of_impressions: viewers / impr });
  }
  const totalLoss = impr - curve[curve.length - 1].viewers;
  const intervals: Interval[] = [];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    const lost = Math.max(a.viewers - b.viewers, 0);
    const span = b.t - a.t;
    intervals.push({
      from: a.label,
      to: b.label,
      t0: a.t,
      t1: b.t,
      lost,
      lost_pct_of_impr: lost / impr,
      lost_pct_per_sec: span ? lost / impr / span : 0,
      share_of_total_loss: totalLoss ? lost / totalLoss : 0,
    });
  }
  return { curve, intervals };
}

// ── Gemini result shapes ────────────────────────────────────────────────────

export interface TranscriptSegment {
  start_s: number;
  end_s: number;
  text: string;
}

export interface Scene {
  start_s: number;
  end_s: number;
  visual: string;
  on_screen_text: string;
  audio: string;
  purpose: string;
}

export interface ListenResult {
  duration_s: number;
  hook_first_3s: string;
  hook_score_1_5: number;
  hook_reasoning: string;
  has_speech: boolean;
  speech_type: string;
  speech_delivery?: string;
  music: { present: boolean; genre_mood: string; energy_1_5: number; sync_with_cuts?: string };
  captions_style?: string;
  scenes: Scene[];
  transcript: TranscriptSegment[];
  app_first_shown_s: number;
  cta: string;
  claims_or_compliance_flags: string[];
  weaknesses: string[];
  testable_improvements: string[];
}

export interface CriterionAnswer {
  anchor_2_met: boolean;
  anchor_0_met: boolean;
  evidence: string;
}

export interface PreflightResult {
  hook_tactic_primary: string;
  hook_tactic_secondary: string;
  thumbstop_type: string;
  visual_format: string;
  asset_type: string;
  awareness_stage: string;
  persona_pain: string;
  scores: Partial<Record<CriterionKey, CriterionAnswer>>;
  missing_from_formula: string[];
  predicted_hook_band: HookBand;
  predicted_hold_band: HoldBand;
  predicted_leak: string;
  prediction_reasoning: string;
  hook_alternatives: Array<{ tactic: string; on_screen_text: string; spoken: string }>;
}

// ── the rubric (Motion's 12-point formula, scored 0/1/2 with anchors) ───────

/** Asked for a 0/1/2 directly, Gemini drifts to 1 on everything; each
 *  criterion is instead two yes/no questions and the score is derived here. */
export const PREFLIGHT_CRITERIA = {
  hook_pattern_interrupt:
    "0 = opening is a static or generic shot; 1 = mild disruption (text over a normal scene); 2 = a genuine scroll-stopper in 0-3 s: unexpected visual, a person visibly expressing an emotion, a shocking or satisfying moment, or a bold problem statement",
  hook_sound_off:
    "0 = the hook needs audio to make sense; 1 = partly readable muted; 2 = on-screen text plus visuals carry the hook fully with sound off",
  hook_persona_specific:
    "0 = generic lifestyle or demographic appeal; 1 = names the category (GLP-1) but a broad pain; 2 = a specific persona x pain in conversational language (e.g. four bites and stuffed, not drinking water)",
  product_by_2s:
    "0 = DreamMe UI, name or the fish first appears after 4 s; 1 = between 2 and 4 s, or visible but small before 2 s; 2 = clearly readable within the first 2 s",
  problem_solution_arc:
    "0 = no problem framing or the body ignores the hook; 1 = arc present but loose; 2 = hook (problem) > story (solution) > CTA, and the body delivers exactly what the hook promised",
  demonstration:
    "0 = app never shown in use; 1 = shown briefly or as a static screenshot; 2 = real use shown long enough to picture yourself doing it (logging, streak, pet reaction)",
  social_proof:
    "0 = none; 1 = a personal claim or a results screen; 2 = concrete results, reactions, numbers or third-party credibility",
  emotional_appeal:
    "0 = flat; 1 = implied emotion; 2 = a clear emotional payoff shown or spoken (relief, pride, delight, humor)",
  cta_clear: "0 = no CTA; 1 = vague or buried; 2 = one clear next step on screen or spoken, held long enough to read",
  cta_tone_match: "0 = salesy CTA on a lo-fi ad, or tone mismatch; 1 = acceptable; 2 = CTA in the same voice as the ad",
  captions_quality:
    "score on-screen text when there is no speech. 0 = absent or illegible or outside safe zones; 1 = present with issues (small, off-sync, clipped); 2 = legible, in safe zones, in sync",
  authenticity: "0 = feels like an ad (stock, polished, logos); 1 = mixed; 2 = real person, real setting, native to the feed",
  x_factor: "0 = none; 1 = humor, a skit or a surprise is present (max 1)",
} as const;

export type CriterionKey = keyof typeof PREFLIGHT_CRITERIA;
export const CRITERION_KEYS = Object.keys(PREFLIGHT_CRITERIA) as CriterionKey[];

const HOOK_CRITERIA: CriterionKey[] = ["hook_pattern_interrupt", "hook_sound_off", "hook_persona_specific"];
const HOLD_CRITERIA: CriterionKey[] = [
  "problem_solution_arc",
  "demonstration",
  "social_proof",
  "emotional_appeal",
  "product_by_2s",
];

export function criterionScore(key: CriterionKey, a: CriterionAnswer | undefined): number {
  if (!a) return 0;
  const top = key === "x_factor" ? 1 : 2;
  if (a.anchor_2_met && !a.anchor_0_met) return top;
  if (a.anchor_0_met && !a.anchor_2_met) return 0;
  return key === "x_factor" ? 0 : 1;
}

export interface Pacing {
  cuts: number;
  cuts_first_3s: number;
  cuts_per_10s: number;
  median_gap_s: number;
  longest_static_s: number;
  /** 2 when frames change about every 2-3 s (Motion's formula), 1 under 6 s, else 0. */
  score: number;
  source: string;
}

/** Motion's formula wants a frame change about every 2 s; a single-take
 *  yapper is the sanctioned exception, so the UI shows numbers, not a verdict. */
export function pacingFromCuts(cutTimes: number[], dur: number, source = "gemini scene boundaries"): Pacing {
  const inner = cutTimes.filter((t) => t > 0 && t < dur).sort((a, b) => a - b);
  const pts = [0, ...inner, dur];
  const gaps = pts.slice(1).map((t, i) => t - pts[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : dur;
  return {
    cuts: inner.length,
    cuts_first_3s: inner.filter((t) => t < 3).length,
    cuts_per_10s: dur ? round1((inner.length / dur) * 10) : 0,
    median_gap_s: round2(median),
    longest_static_s: round2(gaps.length ? Math.max(...gaps) : dur),
    score: median <= 3 ? 2 : median <= 6 ? 1 : 0,
    source,
  };
}

export const FORMULA_MAX = 2 * (CRITERION_KEYS.length - 1) + 1 + 2; // 27

export interface DerivedScores {
  criteria: Record<CriterionKey, { score: number; evidence: string }>;
  formula: { score: number; max: number };
  bands: { hook: HookBand; hold: HoldBand; hook_points: number; hold_points: number };
  gemini_bands: { hook: HookBand; hold: HoldBand };
  pacing: Pacing;
}

/** Deterministic bands from the rubric sub-scores. The thresholds are
 *  documented in the rubric's "Band rule" section; `calibrate` tunes them.
 *  Gemini's own guess is kept alongside as a second opinion only. */
export function deriveScores(pf: PreflightResult, pacing: Pacing): DerivedScores {
  const criteria = {} as DerivedScores["criteria"];
  let total = 0;
  for (const k of CRITERION_KEYS) {
    const score = criterionScore(k, pf.scores[k]);
    criteria[k] = { score, evidence: pf.scores[k]?.evidence ?? "" };
    total += score;
  }
  const hook_points = HOOK_CRITERIA.reduce((s, k) => s + criteria[k].score, 0); // 0-6
  const hold_points = HOLD_CRITERIA.reduce((s, k) => s + criteria[k].score, 0) + pacing.score; // 0-12
  return {
    criteria,
    formula: { score: total + pacing.score, max: FORMULA_MAX },
    bands: {
      hook: hook_points >= 4 ? "strong" : hook_points >= 2 ? "solid" : "needs work",
      hold: hold_points >= 10 ? "strong" : hold_points >= 5 ? "average" : "weak",
      hook_points,
      hold_points,
    },
    gemini_bands: { hook: pf.predicted_hook_band, hold: pf.predicted_hold_band },
    pacing,
  };
}

// ── frames + evidence ───────────────────────────────────────────────────────

export interface FrameTime {
  t: number;
  kind: string;
}

/** Which moments the UI captures from the video: 3 fps over the first 3 s,
 *  one per cut after that (capped at 20), one at every retention milestone,
 *  and a midpoint wherever an interval would otherwise have no frame. */
export function frameTimes(dur: number, cuts: number[]): FrameTime[] {
  const out: FrameTime[] = [];
  for (let i = 0; i < 9; i++) {
    const t = round2(i / 3);
    if (t < dur) out.push({ t, kind: "hook" });
  }
  const body = cuts.filter((t) => t >= 3 && t < dur - 0.1).sort((a, b) => a - b);
  const maxBody = 20;
  const thinned =
    body.length > maxBody
      ? Array.from({ length: maxBody }, (_, i) => body[Math.floor((i * body.length) / maxBody)])
      : body;
  for (const t of thinned) out.push({ t: round2(t), kind: "scene" });
  if (body.length < 5 && dur > 5) {
    const step = Math.max(2, (dur - 3) / 8);
    for (let t = 3 + step; t < dur - 0.5; t += step) out.push({ t: round2(t), kind: "uniform" });
  }
  const ms = milestoneTimes(dur);
  for (const [name, t] of Object.entries(ms)) out.push({ t, kind: `@${name}` });
  const bounds = [...new Set([3, ...Object.values(ms)])].sort((a, b) => a - b);
  for (let i = 1; i < bounds.length; i++) {
    const t0 = bounds[i - 1];
    const t1 = bounds[i];
    if (t1 - t0 > 1.5 && !out.some((f) => f.t > t0 + 0.3 && f.t < t1 - 0.3)) {
      out.push({ t: round2((t0 + t1) / 2), kind: "mid" });
    }
  }
  out.sort((a, b) => a.t - b.t);
  // Two markers within 50 ms are the same frame; keep the more specific label.
  return out.filter((f, i) => i === 0 || f.t - out[i - 1].t > 0.05 || f.kind.startsWith("@"));
}

export function attachEvidence(
  intervals: Interval[],
  transcript: TranscriptSegment[],
  scenes: Scene[],
  frames: FrameTime[],
): void {
  for (const iv of intervals) {
    iv.spoken = transcript
      .filter((s) => s.end_s > iv.t0 && s.start_s < iv.t1)
      .map((s) => s.text.trim())
      .join(" ");
    iv.scenes = scenes
      .filter((s) => s.end_s > iv.t0 && s.start_s < iv.t1)
      .map((s) => `${fmtT(s.start_s)}-${fmtT(s.end_s)}s ${s.visual}`);
    iv.frames = frames.filter((f) => f.t >= iv.t0 && f.t < iv.t1).map((f) => f.t);
  }
}

// ── small helpers ───────────────────────────────────────────────────────────

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function fmtT(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
