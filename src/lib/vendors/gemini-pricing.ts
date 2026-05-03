/**
 * Per-call Gemini pricing. Used to convert usage events into USD so the
 * Spend dashboard reflects true Gemini cost without waiting on a Google
 * Cloud Billing export.
 *
 * Prices are USD and based on Google AI's published list rates for the
 * Gemini image-generation models (image-out + per-token). Override any of
 * these with env vars when the published rate changes — no redeploy
 * needed beyond a config bump.
 *
 *   GEMINI_PRICE_PER_OUTPUT_IMAGE_USD   default 0.039  (Gemini 2.5 Flash Image)
 *   GEMINI_PRICE_PER_INPUT_TOKEN_USD    default 0.00000010
 *   GEMINI_PRICE_PER_OUTPUT_TOKEN_USD   default 0.00000040
 *
 * If we ever support more Gemini models with materially different
 * pricing, branch on `model` in `priceGeminiUsage`.
 */

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const GEMINI_PRICING = {
  perOutputImageUsd: num(
    process.env.GEMINI_PRICE_PER_OUTPUT_IMAGE_USD,
    0.039,
  ),
  perInputTokenUsd: num(
    process.env.GEMINI_PRICE_PER_INPUT_TOKEN_USD,
    0.0000001,
  ),
  perOutputTokenUsd: num(
    process.env.GEMINI_PRICE_PER_OUTPUT_TOKEN_USD,
    0.0000004,
  ),
};

export interface GeminiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
}

export function priceGeminiUsage(u: GeminiUsage): number {
  const usd =
    u.imageCount * GEMINI_PRICING.perOutputImageUsd +
    u.inputTokens * GEMINI_PRICING.perInputTokenUsd +
    u.outputTokens * GEMINI_PRICING.perOutputTokenUsd;
  // Round to 6 decimals — Gemini calls can be sub-cent and we don't want
  // sustained truncation drift over thousands of events.
  return Math.round(usd * 1_000_000) / 1_000_000;
}
