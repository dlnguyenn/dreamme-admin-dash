/**
 * Errors tab, one issue (admin).
 * GET   ?event=<id> — the issue, 30 days of daily counts by release, its
 *       stored samples, and one sample (newest by default) with its frames
 *       resolved through an uploaded source map when there is one.
 * PATCH { status: "unresolved" | "resolved" | "ignored" }
 */
import { NextResponse } from "next/server";
import { checkAdminAuth, requestAccount } from "@/lib/auth-ingest";
import { getEvent, getIssue, setIssueStatus, symbolicatedFor } from "@/lib/errors/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdminAuth(req)) return bad("unauthorized", 401);
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return bad("bad id");
  try {
    const { issue, daily, samples } = await getIssue(id);
    if (!issue) return bad("not found", 404);
    const want = new URL(req.url).searchParams.get("event") ?? samples[0]?.event_id ?? null;
    const event = want ? await getEvent(want) : null;
    let symbolicated = null;
    let symbolicateError: string | null = null;
    if (event && event.issue_id === id) {
      try {
        symbolicated = await symbolicatedFor(event);
      } catch (e) {
        symbolicateError = e instanceof Error ? e.message : String(e);
      }
    }
    return NextResponse.json({
      ok: true,
      issue,
      daily,
      samples,
      event: event && event.issue_id === id ? { ...event, symbolicated: undefined } : null,
      symbolicated,
      symbolicateError,
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdminAuth(req)) return bad("unauthorized", 401);
  const id = Number((await ctx.params).id);
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (!Number.isInteger(id) || id <= 0) return bad("bad id");
  if (body.status !== "unresolved" && body.status !== "resolved" && body.status !== "ignored") return bad("bad status");
  try {
    const issue = await setIssueStatus(id, body.status, requestAccount(req)?.name ?? "script");
    return issue ? NextResponse.json({ ok: true, issue }) : bad("not found", 404);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}
