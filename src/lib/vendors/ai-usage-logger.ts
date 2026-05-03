/**
 * Fire-and-forget logger for per-call AI usage. Writes to
 * ai_usage_events via Supabase REST so generation routes don't have to
 * import the JS client. Never throws — a failed log must never break
 * the user-facing call.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export interface AiUsageEvent {
  vendor: "google" | "anthropic" | "apify";
  model: string;
  route?: string;
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  computedUsd: number;
  metadata?: Record<string, unknown>;
}

export async function logAiUsageEvent(evt: AiUsageEvent): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage_events`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        vendor: evt.vendor,
        model: evt.model,
        route: evt.route ?? null,
        input_tokens: evt.inputTokens ?? 0,
        output_tokens: evt.outputTokens ?? 0,
        image_count: evt.imageCount ?? 0,
        computed_usd: evt.computedUsd,
        metadata: evt.metadata ?? null,
      }),
    });
  } catch {
    // Swallow. Spend tracking is observability, not a hard dependency.
  }
}
