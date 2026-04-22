import { NextResponse } from "next/server";
import { z } from "zod";
import { editImage, geminiConfigured } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  imageUrl: z.string().url(),
  prompt: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  if (!geminiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "GOOGLE_API_KEY not set on server" },
      { status: 500 },
    );
  }
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }

  try {
    const resp = await fetch(parsed.imageUrl);
    if (!resp.ok) {
      return NextResponse.json(
        { ok: false, error: `Reference image fetch failed: ${resp.status}` },
        { status: 400 },
      );
    }
    const rawMime = resp.headers.get("content-type") ?? "image/png";
    const mime = rawMime.includes("jpeg") || rawMime.includes("jpg")
      ? "image/jpeg"
      : "image/png";
    const imageBytes = Buffer.from(await resp.arrayBuffer());

    const out = await editImage({
      imageBytes,
      mimeType: mime,
      prompt: parsed.prompt,
    });
    return NextResponse.json({
      ok: true,
      imageBase64: out.imageBase64,
      mimeType: out.mimeType,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
