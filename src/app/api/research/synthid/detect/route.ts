import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const serviceUrl = process.env.SYNTHID_SERVICE_URL;
  const serviceToken = process.env.SYNTHID_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken) {
    return NextResponse.json(
      { ok: false, error: "SYNTHID_SERVICE_URL / SYNTHID_SERVICE_TOKEN not set" },
      { status: 500 },
    );
  }

  const incoming = await req.formData();
  const image = incoming.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing image file" }, { status: 400 });
  }

  const forwarded = new FormData();
  forwarded.append("image", image, image.name);

  const upstream = await fetch(`${serviceUrl.replace(/\/$/, "")}/detect`, {
    method: "POST",
    headers: { "X-SynthID-Token": serviceToken },
    body: forwarded,
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: `service ${upstream.status}: ${text}` },
      { status: 502 },
    );
  }

  // Upstream returns JSON; parse and re-emit so the dash gets a clean payload.
  try {
    return NextResponse.json({ ok: true, scores: JSON.parse(text) });
  } catch {
    return NextResponse.json({ ok: true, raw: text });
  }
}
