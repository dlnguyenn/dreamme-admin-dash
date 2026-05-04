import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";

function publicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function uploadBytes(
  bytes: ArrayBuffer,
  path: string,
  contentType: string,
): Promise<string> {
  const upload = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (!upload.ok) {
    throw new Error(`storage upload failed: ${upload.status} ${await upload.text()}`);
  }
  return publicUrl(path);
}

async function insertRun(row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/synthid_research_runs`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`db insert failed: ${res.status} ${await res.text()}`);
  }
}

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
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }

  const incoming = await req.formData();
  const image = incoming.get("image");
  const version = String(incoming.get("version") ?? "v3");
  const strength = String(incoming.get("strength") ?? "final");
  // V4-only: which Gemini model produced the image. The codebook stores
  // separate per-model carrier profiles; the right hint produces a much
  // stronger bypass. Ignored by V3.
  const model = String(incoming.get("model") ?? "gemini-3.1-flash-image-preview");
  if (!(image instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing image file" }, { status: 400 });
  }
  if (version !== "v3" && version !== "v4") {
    return NextResponse.json({ ok: false, error: "version must be v3 or v4" }, { status: 400 });
  }

  const inputBytes = await image.arrayBuffer();
  const inputType = image.type || "image/png";

  // Forward to the Python service.
  const fwd = new FormData();
  fwd.append("image", new Blob([inputBytes], { type: inputType }), image.name);
  fwd.append("version", version);
  fwd.append("strength", strength);
  fwd.append("model", model);

  const upstream = await fetch(`${serviceUrl.replace(/\/$/, "")}/bypass`, {
    method: "POST",
    headers: { "X-SynthID-Token": serviceToken },
    body: fwd,
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: `service ${upstream.status}: ${await upstream.text()}` },
      { status: 502 },
    );
  }
  const outputBytes = await upstream.arrayBuffer();

  // Persist input + output under research/synthid/{runId}/ so we have an
  // auditable trail of every bypass attempt.
  const runId = crypto.randomUUID();
  const inputExt = inputType.includes("png") ? "png" : inputType.includes("jpeg") ? "jpg" : "bin";
  const inputPath = `research/synthid/${runId}/input.${inputExt}`;
  const outputPath = `research/synthid/${runId}/output.png`;

  try {
    const [inputUrl, outputUrl] = await Promise.all([
      uploadBytes(inputBytes, inputPath, inputType),
      uploadBytes(outputBytes, outputPath, "image/png"),
    ]);

    await insertRun({
      id: runId,
      input_path: inputPath,
      output_path: outputPath,
      version,
      strength,
      // V4 only — captured in notes since the schema doesn't have a
      // model column yet.
      notes: version === "v4" ? `model=${model}` : null,
    });

    return NextResponse.json({
      ok: true,
      runId,
      version,
      strength,
      inputUrl,
      outputUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
