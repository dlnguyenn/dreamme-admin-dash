import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { isPersonaId, type PersonaId } from "@/lib/personas";
import { todayInET } from "@/lib/daily-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

interface AssignmentJoinRow {
  id: string;
  persona: PersonaId;
  assigned_date: string;
  hook_id: string;
  claimed_at: string | null;
  generated_hooks: {
    hook_text: string;
    category: string | null;
    rationale: string | null;
    inspired_by_post_ids: string[] | null;
    strategy: "exploit" | "explore" | null;
  } | null;
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const personaParam = url.searchParams.get("persona");
  const dateParam = url.searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : todayInET();

  if (personaParam && !isPersonaId(personaParam)) {
    return NextResponse.json(
      { ok: false, error: "invalid persona" },
      { status: 400 },
    );
  }

  let q =
    `${SUPABASE_URL}/rest/v1/daily_hook_assignments` +
    `?select=id,persona,assigned_date,hook_id,claimed_at,generated_hooks(hook_text,category,rationale,inspired_by_post_ids,strategy)` +
    `&assigned_date=eq.${date}`;
  if (personaParam) q += `&persona=eq.${personaParam}`;

  const res = await fetch(q, { headers: sbHeaders(), cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `read failed: ${res.status}`, details: await res.text() },
      { status: 500 },
    );
  }
  const rows = (await res.json()) as AssignmentJoinRow[];

  // Stamp claimed_at on first read per assignment. Fire-and-forget — if
  // the PATCH fails the read still succeeds, and the next call just
  // tries again.
  const unclaimed = rows.filter((r) => !r.claimed_at).map((r) => r.id);
  if (unclaimed.length) {
    const filter = `id=in.(${unclaimed.join(",")})`;
    void fetch(
      `${SUPABASE_URL}/rest/v1/daily_hook_assignments?${filter}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({ claimed_at: new Date().toISOString() }),
      },
    ).catch((e) => console.warn("[hooks/daily] claim stamp failed", e));
  }

  const items = rows.map((r) => ({
    persona: r.persona,
    hook_id: r.hook_id,
    hook_text: r.generated_hooks?.hook_text ?? "",
    category: r.generated_hooks?.category ?? null,
    strategy: r.generated_hooks?.strategy ?? null,
    rationale: r.generated_hooks?.rationale ?? null,
    inspired_by_post_ids: r.generated_hooks?.inspired_by_post_ids ?? [],
    claimed_at: r.claimed_at,
  }));

  return NextResponse.json({ ok: true, date, items });
}
