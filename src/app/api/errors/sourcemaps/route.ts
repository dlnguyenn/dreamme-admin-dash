/**
 * Source-map upload for the Errors tab (server token or admin). The upload
 * script (scripts/upload-error-sourcemaps.mjs) POSTs one map's metadata and
 * gets back a signed URL to PUT the gzipped map to: Vercel caps request
 * bodies at 4.5 MB and React Native maps are bigger.
 *
 * POST { debugId?, release?, dist?, bundle?, sizeBytes? } -> { uploadUrl, path }
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { createSourcemapUpload } from "@/lib/errors/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

export async function POST(req: Request) {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
