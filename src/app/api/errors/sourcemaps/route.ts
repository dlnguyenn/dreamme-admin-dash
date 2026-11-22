/**
 * Source-map upload for the Errors tab. The upload
 * script (scripts/upload-error-sourcemaps.mjs) POSTs one map's metadata and
 * gets back a signed URL to PUT the gzipped map to: Vercel caps request
 * bodies at 4.5 MB and React Native maps are bigger.
 *
 * POST { debugId?, release?, dist?, bundle?, sizeBytes? } -> { uploadUrl, path }
 *
 * Auth: the x-errors-upload-token header matching ERRORS_UPLOAD_TOKEN (its own
 * token, so the app's build never holds the DAD's master secret), or an admin.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { createSourcemapUpload } from "@/lib/errors/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uploadTokenOk(req: Request): boolean {
  const want = process.env.ERRORS_UPLOAD_TOKEN?.trim() ?? "";
  const got = req.headers.get("x-errors-upload-token")?.trim() ?? "";
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const s = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

export async function POST(req: Request) {
  if (!uploadTokenOk(req) && !checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const debugId = s(b.debugId, 64);
  if (debugId && !/^[0-9a-f-]{32,36}$/i.test(debugId)) return NextResponse.json({ ok: false, error: "bad debugId" }, { status: 400 });
  const release = s(b.release);
  if (!debugId && !release) return NextResponse.json({ ok: false, error: "need debugId or release" }, { status: 400 });
  try {
    const out = await createSourcemapUpload({
      debugId,
      release,
      dist: s(b.dist, 100),
      bundle: s(b.bundle, 120),
      sizeBytes: typeof b.sizeBytes === "number" ? b.sizeBytes : null,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
