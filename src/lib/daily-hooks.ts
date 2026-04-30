// Daily hook assignment: pick one hook per persona per day from
// generated_hooks and persist into daily_hook_assignments. Read by
// /api/hooks/daily so the external N8N workflow can claim it.

import { PERSONA_IDS, type PersonaId } from "./personas";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

// Date used for "today" in assignments. We anchor on America/New_York so
// the cron firing at 00:05 ET maps cleanly to the calendar date the
// editorial team thinks of as "today" — even when the Vercel host clock
// is UTC. Returns YYYY-MM-DD.
export function todayInET(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

interface GeneratedHookRow {
  id: string;
  persona: PersonaId;
  hook_text: string;
  category: string | null;
  rationale: string | null;
  inspired_by_post_ids: string[] | null;
  strategy: "exploit" | "explore" | null;
  created_at: string;
  used: boolean;
}

async function fetchTodaysGeneratedHooks(date: string): Promise<GeneratedHookRow[]> {
  // created_at is timestamptz; the cron runs ~5 min after midnight ET,
  // so anything created in the last 6 hours is "today's batch". Looser
  // window survives clock skew + cron retries.
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  void date; // currently unused — kept for future per-date partitioning
  const url =
    `${SUPABASE_URL}/rest/v1/generated_hooks` +
    `?select=id,persona,hook_text,category,rationale,inspired_by_post_ids,strategy,created_at,used` +
    `&created_at=gte.${cutoff}` +
    `&order=created_at.desc` +
    `&limit=500`;
  const res = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `generated_hooks read failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as GeneratedHookRow[];
}

function pickHookForPersona(
  hooks: GeneratedHookRow[],
  persona: PersonaId,
): GeneratedHookRow | null {
  const own = hooks.filter((h) => h.persona === persona);
  if (!own.length) return null;
  // Priority: exploit (highest expected hit rate) > explore > any.
  const exploit = own.find((h) => h.strategy === "exploit");
  if (exploit) return exploit;
  const explore = own.find((h) => h.strategy === "explore");
  if (explore) return explore;
  return own[0];
}

/**
 * Picks one hook per persona from today's generated batch and inserts
 * into daily_hook_assignments. Idempotent — the unique constraint on
 * (persona, assigned_date) means re-running the cron is a no-op.
 *
 * Returns the assignments that were either created or already present.
 */
export async function assignDailyHooks(date: string = todayInET()): Promise<{
  assigned: number;
  skipped: number;
  rows: Array<{ persona: PersonaId; hook_id: string }>;
}> {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("Supabase service-role not configured");
  }

  const hooks = await fetchTodaysGeneratedHooks(date);

  const candidates: Array<{ persona: PersonaId; hook_id: string }> = [];
  for (const persona of PERSONA_IDS) {
    const pick = pickHookForPersona(hooks, persona);
    if (pick) candidates.push({ persona, hook_id: pick.id });
  }

  if (!candidates.length) {
    return { assigned: 0, skipped: 0, rows: [] };
  }

  const payload = candidates.map((c) => ({
    persona: c.persona,
    assigned_date: date,
    hook_id: c.hook_id,
  }));

  // resolution=ignore-duplicates makes the unique (persona, assigned_date)
  // collision a silent no-op — perfect idempotency for cron retries.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_hook_assignments`, {
    method: "POST",
    headers: {
      ...sbHeaders(),
      Prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      `daily_hook_assignments insert failed: ${res.status} ${await res.text()}`,
    );
  }
  const inserted = (await res.json()) as Array<{ persona: PersonaId; hook_id: string }>;
  return {
    assigned: inserted.length,
    skipped: candidates.length - inserted.length,
    rows: candidates,
  };
}
