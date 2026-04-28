import type { PersonaId } from "@/lib/personas";
import { PERSONA_IDS } from "@/lib/personas";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const COLD_START_MIN_SAMPLES = 20;
const WINDOW_DAYS = 30;
const FRESH_POST_HOURS = 24;
const FLOP_RATIO = 0.25;
const HIT_RATIO = 2.0;
const GLOBAL_KEY = "_global";

export type PerformanceClass = "flop" | "mid" | "hit";

export interface PersonaBaseline {
  persona: string;
  rolling_median_views: number;
  rolling_p25_views: number;
  rolling_p75_views: number;
  sample_size: number;
  window_start: string;
}

export interface BaselineRow {
  persona: PersonaId;
  view_count: number | null;
  posted_at: string | null;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next === undefined) return sorted[base];
  return Math.round(sorted[base] + rest * (next - sorted[base]));
}

export function summarize(
  views: number[],
  windowStart: string,
): Omit<PersonaBaseline, "persona"> {
  const sorted = [...views].sort((a, b) => a - b);
  return {
    rolling_median_views: quantile(sorted, 0.5),
    rolling_p25_views: quantile(sorted, 0.25),
    rolling_p75_views: quantile(sorted, 0.75),
    sample_size: sorted.length,
    window_start: windowStart,
  };
}

export function computeFromRows(rows: BaselineRow[]): PersonaBaseline[] {
  const now = Date.now();
  const windowStartMs = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const freshCutoffMs = now - FRESH_POST_HOURS * 60 * 60 * 1000;
  const windowStart = new Date(windowStartMs).toISOString();

  const eligible = rows.filter((r) => {
    if (r.view_count == null || r.view_count <= 0) return false;
    if (!r.posted_at) return false;
    const t = Date.parse(r.posted_at);
    if (isNaN(t)) return false;
    if (t < windowStartMs) return false;
    if (t > freshCutoffMs) return false;
    return true;
  });

  const byPersona = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of eligible) {
    const arr = byPersona.get(r.persona) ?? [];
    arr.push(Number(r.view_count));
    byPersona.set(r.persona, arr);
    all.push(Number(r.view_count));
  }

  const out: PersonaBaseline[] = [];
  for (const id of PERSONA_IDS) {
    const views = byPersona.get(id) ?? [];
    out.push({ persona: id, ...summarize(views, windowStart) });
  }
  out.push({ persona: GLOBAL_KEY, ...summarize(all, windowStart) });
  return out;
}

export type BaselineMap = Map<string, PersonaBaseline>;

export function classifyPerformance(
  views: number,
  persona: PersonaId,
  baselines: BaselineMap,
): { ratio: number; class: PerformanceClass } {
  const own = baselines.get(persona);
  const global = baselines.get(GLOBAL_KEY);
  const useGlobal = !own || own.sample_size < COLD_START_MIN_SAMPLES;
  const median =
    useGlobal && global ? global.rolling_median_views : own?.rolling_median_views ?? 0;
  if (!median || median <= 0) return { ratio: 0, class: "mid" };
  const ratio = views / median;
  let cls: PerformanceClass = "mid";
  if (ratio < FLOP_RATIO) cls = "flop";
  else if (ratio > HIT_RATIO) cls = "hit";
  return { ratio, class: cls };
}

function sbHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

export async function fetchBaselineRows(): Promise<BaselineRow[]> {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("Supabase not configured");
  }
  const cutoff = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/tiktok_posts?select=persona,view_count,posted_at&posted_at=gte.${cutoff}&limit=5000`;
  const res = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
  if (!res.ok)
    throw new Error(
      `tiktok_posts read failed: ${res.status} ${await res.text()}`,
    );
  return (await res.json()) as BaselineRow[];
}

export async function writePersonaBaselines(
  rows: PersonaBaseline[],
): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/persona_baselines?on_conflict=persona`,
    {
      method: "POST",
      headers: {
        ...sbHeaders(),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(rows.map((r) => ({ ...r, computed_at: new Date().toISOString() }))),
    },
  );
  if (!res.ok)
    throw new Error(
      `persona_baselines upsert failed: ${res.status} ${await res.text()}`,
    );
}

export async function loadBaselines(): Promise<BaselineMap> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return new Map();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/persona_baselines?select=*`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok) return new Map();
  const rows = (await res.json()) as PersonaBaseline[];
  const map: BaselineMap = new Map();
  for (const r of rows) map.set(r.persona, r);
  return map;
}

export async function recomputeAndPersistBaselines(): Promise<{
  computed: number;
  globalMedian: number;
}> {
  const rows = await fetchBaselineRows();
  const baselines = computeFromRows(rows);
  await writePersonaBaselines(baselines);
  const global = baselines.find((b) => b.persona === GLOBAL_KEY);
  return { computed: baselines.length, globalMedian: global?.rolling_median_views ?? 0 };
}
