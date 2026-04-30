import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { editImage, geminiConfigured } from "@/lib/gemini";
import {
  buildBeforePhotoPrompt,
  pickNScenarios,
  pickTwoScenarios,
  SCENARIO_LABELS,
  type BeforeScenario,
} from "@/lib/prompts/beforePhoto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Gemini image generation can take 20-40s for two images in parallel.
export const maxDuration = 60;

const Body = z.object({
  persona: z.enum([
    "andrea",
    "emma",
    "olivia",
    "mia",
    "abby",
    "diane",
    "sydney",
    "maddy",
    "hannah",
  ]),
  referenceImageUrl: z.string().url(),
  count: z.number().int().min(1).max(4).optional(),
});

function randomTargetLb(): number {
  // Integer in [180, 210] inclusive.
  return 180 + Math.floor(Math.random() * 31);
}

function normalizeMime(rawMime: string | null): string {
  const m = (rawMime ?? "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  if (m.includes("webp")) return "image/webp";
  if (m.includes("gif")) return "image/gif";
  return "image/png";
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!geminiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "GOOGLE_API_KEY not set on server" },
      { status: 500 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { referenceImageUrl, count = 2 } = parsed.data;

  try {
    // Fetch reference image once, reuse bytes for all parallel calls.
    const refRes = await fetch(referenceImageUrl);
    if (!refRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Reference image fetch failed: ${refRes.status}`,
        },
        { status: 400 },
      );
    }
    const mime = normalizeMime(refRes.headers.get("content-type"));
    const imageBytes = Buffer.from(await refRes.arrayBuffer());

    // Pick scenarios up front. The default path (count === 2) guarantees
    // two distinct scenarios so creators see variety side-by-side; for any
    // other count we allow repeats (rare: admin-only test cases).
    const scenarios: BeforeScenario[] =
      count === 2
        ? Array.from(pickTwoScenarios())
        : pickNScenarios(count);

    // Budget math: Vercel Hobby caps this function at 60s (see maxDuration
    // above). Two image edits run in parallel; each gets a tight per-attempt
    // timeout and a single retry so a single stalled Gemini request can't
    // hang the whole batch. Worst case per image: 22s + ~500ms backoff +
    // 22s = ~44.5s. Two in parallel = same. Plus reference-fetch (~1-2s) +
    // response serialization, we finish with headroom.
    const calls = scenarios.map((scenario) => {
      const lb = randomTargetLb();
      return editImage({
        imageBytes,
        mimeType: mime,
        prompt: buildBeforePhotoPrompt(scenario, lb),
        timeoutMs: 22_000,
        maxRetries: 1,
      }).then((r) => ({ ...r, targetLb: lb, scenario }));
    });

    // Use allSettled so one failure doesn't kill the whole batch.
    const settled = await Promise.allSettled(calls);
    const images: {
      imageBase64: string;
      mimeType: string;
      targetLb: number;
      scenario: BeforeScenario;
    }[] = [];
    const errors: string[] = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === "fulfilled") images.push(r.value);
      else {
        const label = SCENARIO_LABELS[scenarios[i]];
        errors.push(`${label}: ${(r.reason as Error).message}`);
      }
    }

    if (images.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: errors[0] ?? "Gemini returned no images",
          errors,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      images,
      partialErrors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
