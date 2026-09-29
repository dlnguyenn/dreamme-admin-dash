/**
 * Accessory Studio library: GET lists saved accessories, POST saves a
 * finished (normalized) SVG, DELETE ?id= removes one.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { deleteAccessory, getAccessory, insertAccessory, listAccessories } from "@/lib/accessory-studio";
import { ACCESSORY_SLOTS, slugify } from "@/lib/accessory-studio-shared";
import { BUCKET, randomId } from "@/lib/image-generation";
import { extractStoragePath, storageDelete, uploadBytesToStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Save = z.object({
  item: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(600),
  slot: z.enum(ACCESSORY_SLOTS),
  mode: z.enum(["fish", "match"]),
  model: z.string().max(80).nullable(),
  onfishUrl: z.string().url().nullable(),
  soloUrl: z.string().url().nullable(),
  svg: z.string().min(20).max(2_000_000),
});

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  try {
    return NextResponse.json({ ok: true, items: await listAccessories() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  let body: z.infer<typeof Save>;
  try {
    body = Save.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
  if (!body.svg.trimStart().startsWith("<?xml") && !body.svg.trimStart().startsWith("<svg")) {
    return NextResponse.json({ ok: false, error: "not an SVG" }, { status: 400 });
  }
  try {
    const slug = slugify(body.item) || "accessory";
    const path = `accessories/${slug}-${randomId().slice(0, 8)}.svg`;
    const svgUrl = await uploadBytesToStorage(BUCKET, path, new TextEncoder().encode(body.svg), "image/svg+xml");
    const row = await insertAccessory({
      slug,
      item: body.item,
      subject: body.subject,
      slot: body.slot,
      mode: body.mode,
      model: body.model,
      onfish_url: body.onfishUrl,
      solo_url: body.soloUrl,
      svg_url: svgUrl,
    });
    return NextResponse.json({ ok: true, item: row });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  try {
    const row = await getAccessory(id);
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    await deleteAccessory(id);
    // Only the SVG is owned by this row; the raster stages are also
    // image_generations rows and stay in Image Studio's gallery.
    const path = extractStoragePath(row.svg_url, BUCKET);
    if (path) await storageDelete(path, BUCKET);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
