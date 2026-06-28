/**
 * Per-call Gemini pricing. Used to convert usage events into USD so the
 * Spend dashboard reflects true Gemini cost without waiting on a Google
 * Cloud Billing export.
 *
 * Prices are USD, based on Google AI's published list rates for
 * `gemini-3.1-flash-image-preview` (the model pinned in image-generation.ts).
 * Override any of these with env vars when the published rate changes — no
 * redeploy needed beyond a config bump.
 *
 * Google's model (verified against ai.google.dev/gemini-api/docs/pricing):
 *   - Image output is billed as tokens at $60 / 1M, which works out to a
 *     per-image rate by resolution: 0.5K=$0.045, 1K=$0.067, 2K=$0.101,
 *     4K=$0.151. Our outputs run ~1.3K image tokens (≈1K tier), so we price
 *     the image with the 1K per-image rate.
 *   - Text input (incl. reference images): $0.50 / 1M.
 *   - Batch mode is a flat 50% discount (handled via `isBatch` below).
 *
 * We price the image via the flat per-image rate (not the raw output-token
 * count) because the async Batch path can't return per-item token counts —
 * it only knows imageCount. So `perOutputTokenUsd` defaults to 0: the logged
 * output tokens ARE the image and are already covered by the per-image rate,
 * so charging them again would double-count. (Bump it only if a future model
 * emits separately-billed text output.)
 *
 *   GEMINI_PRICE_PER_OUTPUT_IMAGE_USD   default 0.067   (1K image, standard)
 *   GEMINI_PRICE_PER_INPUT_TOKEN_USD    default 0.0000005  ($0.50 / 1M)
 *   GEMINI_PRICE_PER_OUTPUT_TOKEN_USD   default 0       (image already priced)
 *
 * NOTE: if image output resolution is ever raised (e.g. to 4K), bump
 * GEMINI_PRICE_PER_OUTPUT_IMAGE_USD to the matching tier (4K=$0.151).
 * If we support more Gemini models with materially different pricing,
 * branch on `model` in `priceGeminiUsage`.
 */

// Env overrides must be positive; the built-in defaults may be 0 (used for
// the output-token rate, which is intentionally zero — see above).
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const GEMINI_PRICING = {
  perOutputImageUsd: num(
    process.env.GEMINI_PRICE_PER_OUTPUT_IMAGE_USD,
    0.067,
  ),
  perInputTokenUsd: num(
    process.env.GEMINI_PRICE_PER_INPUT_TOKEN_USD,
    0.0000005,
  ),
  perOutputTokenUsd: num(
    process.env.GEMINI_PRICE_PER_OUTPUT_TOKEN_USD,
    0,
  ),
};

export interface GeminiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  /** When true, halves all per-token + per-image rates per Gemini's
   *  Batch API pricing. */
  isBatch?: boolean;
}

export function priceGeminiUsage(u: GeminiUsage): number {
  const factor = u.isBatch ? 0.5 : 1;
  const usd =
    u.imageCount * GEMINI_PRICING.perOutputImageUsd * factor +
    u.inputTokens * GEMINI_PRICING.perInputTokenUsd * factor +
    u.outputTokens * GEMINI_PRICING.perOutputTokenUsd * factor;
  // Round to 6 decimals — Gemini calls can be sub-cent and we don't want
  // sustained truncation drift over thousands of events.
  return Math.round(usd * 1_000_000) / 1_000_000;
}
