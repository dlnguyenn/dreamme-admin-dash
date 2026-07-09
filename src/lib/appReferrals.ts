/**
 * Read-only feed of the DreamMe app's creator referral codes.
 *
 * The iOS app (1.3.9+) owns the code roster + funnel in its own Supabase
 * (project afsrqxlmfexetgoccpgu) — tables referral_codes + referral_redemptions.
 * The app team exposes an authenticated read-only `creator_stats` endpoint
 * (option B — no service-key handover). We consume it server-side only.
 *
 * Env:
 *   APP_REFERRAL_STATS_URL    — the edge function URL (GET → { items: [...] })
 *   APP_REFERRAL_STATS_TOKEN  — shared bearer token
 *
 * Degrades gracefully: if unconfigured or the fetch fails, returns [] so the
 * dashboard falls back to local overlays instead of erroring.
 */
const STATS_URL = process.env.APP_REFERRAL_STATS_URL ?? "";
const STATS_TOKEN = process.env.APP_REFERRAL_STATS_TOKEN ?? "";

export interface AppCreator {
  code: string; // UPPERCASE
  creator_name: string;
  is_active: boolean;
  discount_percent: number;
  entered: number; // typed a valid code (attribution)
  purchased: number; // actually subscribed (conversion) — authoritative count
}

export function creatorStatsConfigured(): boolean {
  return !!STATS_URL && !!STATS_TOKEN;
}

interface RawCreatorStat {
  code?: string;
  creator_name?: string;
  is_active?: boolean;
  discount_percent?: number | string;
  entered?: number | string;
  purchased?: number | string;
}

function normalize(raw: RawCreatorStat): AppCreator | null {
  const code = raw.code?.trim().toUpperCase();
  if (!code) return null;
  return {
    code,
    creator_name: raw.creator_name?.trim() || code,
    is_active: raw.is_active !== false,
    discount_percent: Number(raw.discount_percent) || 0,
    entered: Number(raw.entered) || 0,
    purchased: Number(raw.purchased) || 0,
  };
}

/**
 * Fetch the current creator roster + funnel. Excludes the app's TEST10 seed.
 * Never throws — returns [] on any problem.
 */
export async function fetchCreatorStats(): Promise<AppCreator[]> {
  if (!creatorStatsConfigured()) return [];
  try {
    const res = await fetch(STATS_URL, {
      headers: { Authorization: `Bearer ${STATS_TOKEN}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: RawCreatorStat[] } | RawCreatorStat[];
    const items = Array.isArray(body) ? body : (body.items ?? []);
    return items
      .map(normalize)
      .filter((c): c is AppCreator => !!c)
      .filter((c) => c.code !== "TEST10" && !/delete me/i.test(c.creator_name));
  } catch {
    return [];
  }
}

export async function fetchCreatorStatByCode(code: string): Promise<AppCreator | null> {
  const upper = code.trim().toUpperCase();
  const all = await fetchCreatorStats();
  return all.find((c) => c.code === upper) ?? null;
}
