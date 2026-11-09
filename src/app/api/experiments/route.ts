/**
 * Experiments tab (src/lib/experiment-log.ts).
 *
 * GET  — every entry, newest first, plus live RevenueCat status for entries
 *        with an rc_experiment_id (`rc`, keyed by id). An RC failure is
 *        reported in `rcError` and never fails the list.
 * POST — add an entry. Claude sessions call this with the ingest token:
 *        curl -X POST $DAD/api/experiments -H "x-dreamme-secret: $INGEST_TOKEN"
 *          -H "content-type: application/json" -d '{"title":"…","kind":"change",…}'
 *
 * Same access check as /api/roadmap. Table is service-role only.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spGet, spPost, supportDbConfigured } from "@/lib/support/db";
import { fetchExperiments, revenueCatConfigured } from "@/lib/vendors/revenuecat";
import {
  dateRangeError,
  sortEntries,
  type ExperimentEntry,
  type RcExperimentState,
} from "@/lib/experiment-log";
import { CreateEntry, cleanEntry } from "@/lib/experiment-log-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  return null;
}

const fail = (e: unknown) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });

async function rcStates(
  entries: ExperimentEntry[],
): Promise<{ rc: Record<string, RcExperimentState>; rcError: string | null }> {
  const wanted = new Set(entries.map((e) => e.rc_experiment_id).filter((x): x is string => !!x));
  if (wanted.size === 0) return { rc: {}, rcError: null };
  if (!revenueCatConfigured()) return { rc: {}, rcError: "RevenueCat key not configured" };
  try {
    const all = await fetchExperiments();
    const rc: Record<string, RcExperimentState> = {};
    for (const x of all) {
      if (!wanted.has(x.id)) continue;
      rc[x.id] = {
        id: x.id,
        status: x.status,
        started_at: x.started_at ?? null,
        stopped_at: x.stopped_at ?? null,
        enrollment_percentage: x.enrollment_percentage ?? null,
      };
    }
    return { rc, rcError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      rc: {},
      rcError: /experiments:read/.test(msg)
        ? "The RevenueCat API key can't read experiments (needs the experiments:read permission)"
        : msg.slice(0, 200),
    };
  }
}

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const entries = sortEntries(await spGet<ExperimentEntry[]>("experiment_log?select=*&limit=1000"));
    const { rc, rcError } = await rcStates(entries);
    return NextResponse.json({ ok: true, entries, rc, rcError });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  let body: ReturnType<typeof cleanEntry<Record<string, unknown>>>;
  try {
    const parsed = CreateEntry.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    body = cleanEntry(parsed.data as Record<string, unknown>);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const rangeError = dateRangeError(body.start_date as string | null, body.end_date as string | null);
  if (rangeError) return NextResponse.json({ ok: false, error: rangeError }, { status: 400 });

  // An experiment has a control group unless told otherwise; a change never does.
  if (body.has_control === undefined) body.has_control = (body.kind ?? "experiment") === "experiment";
  if (body.kind === "change") body.has_control = false;

  try {
    const [entry] = await spPost<ExperimentEntry>("experiment_log", [body]);
    return NextResponse.json({ ok: true, entry });
  } catch (e) {
    return fail(e);
  }
}
