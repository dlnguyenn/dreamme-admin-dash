/**
 * Background Studio library: GET lists saved backgrounds, POST saves a
 * generated one, DELETE ?id= removes it from the library (the image itself
 * stays in the bucket, like every other image_generations output).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { deleteBackground, insertBackground, listBackgrounds } from "@/lib/background-studio";
import { slugify } from "@/lib/accessory-studio-shared";
import { SUPABASE_URL } from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Save = z.object({
  name: z.string().trim().min(1).max(80),
  theme: z.string().trim().min(1).max(800),
  imageUrl: z.string().url(),
  model: z.string().max(80).nullable(),
});

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  try {
    return NextResponse.json({ ok: true, items: await listBackgrounds() });
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
  // Only images our own generator produced (they live in our Supabase).
  if (!SUPABASE_URL || !body.imageUrl.startsWith(SUPABASE_URL)) {
    return NextResponse.json({ ok: false, error: "imageUrl must be one of our generated images" }, { status: 400 });
  }
  try {
    const row = await insertBackground({
      slug: slugify(body.name) || "background",
      name: body.name,
      theme: body.theme,
      image_url: body.imageUrl,
      model: body.model,
      source: "generated",
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
    await deleteBackground(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
