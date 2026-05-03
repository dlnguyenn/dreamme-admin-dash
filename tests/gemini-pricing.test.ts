import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("priceGeminiUsage", () => {
  const originals = {
    image: process.env.GEMINI_PRICE_PER_OUTPUT_IMAGE_USD,
    inT: process.env.GEMINI_PRICE_PER_INPUT_TOKEN_USD,
    outT: process.env.GEMINI_PRICE_PER_OUTPUT_TOKEN_USD,
  };

  beforeEach(() => {
    delete process.env.GEMINI_PRICE_PER_OUTPUT_IMAGE_USD;
    delete process.env.GEMINI_PRICE_PER_INPUT_TOKEN_USD;
    delete process.env.GEMINI_PRICE_PER_OUTPUT_TOKEN_USD;
    vi.resetModules();
  });

  afterEach(() => {
    if (originals.image !== undefined)
      process.env.GEMINI_PRICE_PER_OUTPUT_IMAGE_USD = originals.image;
    if (originals.inT !== undefined)
      process.env.GEMINI_PRICE_PER_INPUT_TOKEN_USD = originals.inT;
    if (originals.outT !== undefined)
      process.env.GEMINI_PRICE_PER_OUTPUT_TOKEN_USD = originals.outT;
  });

  it("prices a typical single-image edit at the per-image rate plus token cost", async () => {
    const { priceGeminiUsage } = await import(
      "@/lib/vendors/gemini-pricing"
    );
    const usd = priceGeminiUsage({
      model: "gemini-3.1-flash-image-preview",
      inputTokens: 1000,
      outputTokens: 500,
      imageCount: 1,
    });
    // 1 * 0.039 + 1000 * 1e-7 + 500 * 4e-7 = 0.039 + 0.0001 + 0.0002 = 0.0393
    expect(usd).toBeCloseTo(0.0393, 6);
  });

  it("prices image-only output (no token info) at per-image rate", async () => {
    const { priceGeminiUsage } = await import(
      "@/lib/vendors/gemini-pricing"
    );
    const usd = priceGeminiUsage({
      model: "gemini-3.1-flash-image-preview",
      inputTokens: 0,
      outputTokens: 0,
      imageCount: 1,
    });
    expect(usd).toBeCloseTo(0.039, 6);
  });

  it("respects env overrides for per-image price", async () => {
    process.env.GEMINI_PRICE_PER_OUTPUT_IMAGE_USD = "0.05";
    const { priceGeminiUsage } = await import(
      "@/lib/vendors/gemini-pricing"
    );
    const usd = priceGeminiUsage({
      model: "gemini-3.1-flash-image-preview",
      inputTokens: 0,
      outputTokens: 0,
      imageCount: 2,
    });
    expect(usd).toBeCloseTo(0.1, 6);
  });

  it("rejects nonsense env values and falls back to default", async () => {
    process.env.GEMINI_PRICE_PER_OUTPUT_IMAGE_USD = "not-a-number";
    const { priceGeminiUsage } = await import(
      "@/lib/vendors/gemini-pricing"
    );
    const usd = priceGeminiUsage({
      model: "gemini-3.1-flash-image-preview",
      inputTokens: 0,
      outputTokens: 0,
      imageCount: 1,
    });
    expect(usd).toBeCloseTo(0.039, 6);
  });
});
