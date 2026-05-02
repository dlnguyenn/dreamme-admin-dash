import { NextResponse } from "next/server";
import { anthropicConfigured } from "@/lib/anthropic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const HAIKU = "claude-haiku-4-5-20251001";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SpyRow {
  id: string;
  first_slide_text: string | null;
  caption: string | null;
  view_count: number;
  category: string | null;
  source_hashtag: string;
  why_it_hit: string | null;
}

/**
 * Lazy-compute a 1–2 sentence "why this hit" summary for a spy video.
 * Cached on the row after first compute.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ videoId: string }> },
): Promise<Response> {
  if (!anthropicConfigured() || !SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "service not configured" },
      { status: 500 },
    );
  }
  const { videoId } = await ctx.params;
  if (!videoId) {
    return NextResponse.json({ ok: false, error: "videoId required" }, { status: 400 });
  }

  const fetchRow = await fetch(
    `${SUPABASE_URL}/rest/v1/spy_videos?id=eq.${videoId}&select=id,first_slide_text,caption,view_count,category,source_hashtag,why_it_hit`,
    {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      cache: "no-store",
    },
  );
  if (!fetchRow.ok) {
    return NextResponse.json(
      { ok: false, error: `spy_videos read: ${fetchRow.status}` },
      { status: 500 },
    );
  }
  const rows = (await fetchRow.json()) as SpyRow[];
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: "video not found" }, { status: 404 });
  }
  if (row.why_it_hit) {
    return NextResponse.json({ ok: true, whyItHit: row.why_it_hit, cached: true });
  }

  const prompt = `Analyze this viral GLP-1 / weight-loss TikTok and explain in 1-2 sentences why it hit. Be specific and useful for someone trying to learn from it — name the exact mechanism (curiosity gap, identity hook, contrarian framing, vulnerable confession, stat anchor, etc.) and tie it to the hook's specific words. Don't be generic.

Hook (first slide text): ${JSON.stringify(row.first_slide_text || "(no hook)")}
Caption: ${JSON.stringify(row.caption || "(no caption)")}
Views: ${row.view_count.toLocaleString()}
Hashtag context: #${row.source_hashtag}
Category: ${row.category ?? "uncategorized"}

Output JUST the 1-2 sentence explanation, no preamble.`;

  const claudeRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 200,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });
  if (!claudeRes.ok) {
    return NextResponse.json(
      { ok: false, error: `claude: ${claudeRes.status} ${await claudeRes.text()}` },
      { status: 500 },
    );
  }
  const claudeData = (await claudeRes.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const why = (claudeData.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => (b.text ?? "").trim())
    .join("\n")
    .trim();

  if (!why) {
    return NextResponse.json({ ok: false, error: "empty claude response" }, { status: 500 });
  }

  // Persist on the row
  await fetch(`${SUPABASE_URL}/rest/v1/spy_videos?id=eq.${videoId}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ why_it_hit: why }),
  });

  return NextResponse.json({ ok: true, whyItHit: why, cached: false });
}
