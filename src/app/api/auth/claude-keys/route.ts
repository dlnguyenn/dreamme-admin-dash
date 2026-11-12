/**
 * Claude's sign-in keys: list, create, revoke. Needs the ingest token (the
 * vault script `dad-signin.js setup` uses it) or an admin sign-in. A Claude
 * session itself can't manage keys.
 *
 *   GET                       -> { keys: [{ id, label, created_at, last_used_at, revoked_at }] }
 *   POST   { label }          -> { key, id }  (the key is shown this once)
 *   DELETE ?id=<uuid>         -> revokes that key at once
 */
import { NextResponse } from "next/server";
import { checkServerToken, requestAccount } from "@/lib/auth-ingest";
import { createClaudeKey, listClaudeKeys, revokeClaudeKey } from "@/lib/dad-claude-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowed(req: Request): boolean {
  if (checkServerToken(req)) return true;
  const a = requestAccount(req);
  return !!a && a.kind !== "claude" && a.role === "admin";
}

const deny = () => NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  if (!allowed(req)) return deny();
  try {
    return NextResponse.json({ ok: true, keys: await listClaudeKeys() }, noStore);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (!allowed(req)) return deny();
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ ok: false, error: "label required" }, { status: 400 });
  try {
    const { key, row } = await createClaudeKey(label);
    return NextResponse.json({ ok: true, id: row.id, label: row.label, key }, noStore);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  if (!allowed(req)) return deny();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    const row = await revokeClaudeKey(id);
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, key: row }, noStore);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
