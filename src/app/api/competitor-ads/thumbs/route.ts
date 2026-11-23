/**
 * POST /api/competitor-ads/thumbs { ids: string[] }
 * Makes the small stored copy of each ad's frame (see lib/competitor-ads-tab/thumbs.ts)
 * for ads whose card found it missing. Admin only. Paths come from the ad's own
 * row in competitor_ads, never from the caller.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { spGet, supportDbConfigured } from "@/lib/support/db";
import { storageBucket, uploadBytesToStorage } from "@/lib/storage";
import { renderUrl, thumbPath } from "@/lib/competitor-ads-tab/thumbs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ ids: z.array(z.string().regex(/^\d{5,25}$/)).min(1).max(60) });
const YEAR = "public, max-age=31536000, immutable";

export async function POST(req: Request) {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "ids must be 1-60 ad archive ids" }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];
  const rows = await spGet<{ ad_archive_id: string; thumbnail_url: string | null }[]>(
    `competitor_ads?select=ad_archive_id,thumbnail_url&ad_archive_id=in.(${ids.join(",")})`,
  );
  const jobs = rows.flatMap((r) => {
    const t = r.thumbnail_url ? thumbPath(r.thumbnail_url) : null;
    return t && t.bucket === storageBucket() ? [{ id: r.ad_archive_id, src: renderUrl(r.thumbnail_url!), path: t.path }] : [];
  });
  const made: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const queue = [...jobs];
  const makeOne = async (job: (typeof jobs)[number]) => {
    const res = await fetch(job.src, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`resize ${res.status}`);
    await uploadBytesToStorage(storageBucket(), job.path, await res.arrayBuffer(), "image/jpeg", { cacheControl: YEAR });
  };
  // Four at a time: Supabase storage answers 429 above that.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          await makeOne(job).catch(async (e) => {
            if (!/429/.test(String(e))) throw e;
            await new Promise((r) => setTimeout(r, 1500));
            await makeOne(job);
          });
          made.push(job.id);
        } catch (e) {
          failed.push({ id: job.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }),
  );
  return NextResponse.json({ ok: true, made: made.length, skipped: ids.length - jobs.length, failed });
}
