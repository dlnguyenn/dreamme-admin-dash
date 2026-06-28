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
    // 1 * 0.067 + 1000 * 5e-7 + 500 * 0 = 0.067 + 0.0005 = 0.0675
    // (image output is priced via the per-image rate, so output tokens are 0-rated)
    expect(usd).toBeCloseTo(0.0675, 6);
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
    expect(usd).toBeCloseTo(0.067, 6);
  });

  it("applies the 50% batch discount to the per-image rate", async () => {
    const { priceGeminiUsage } = await import(
      "@/lib/vendors/gemini-pricing"
    );
    const usd = priceGeminiUsage({
      model: "gemini-3.1-flash-image-preview",
      inputTokens: 0,
      outputTokens: 0,
      imageCount: 4,
      isBatch: true,
    });
    // 4 * 0.067 * 0.5 = 0.134
    expect(usd).toBeCloseTo(0.134, 6);
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
    expect(usd).toBeCloseTo(0.067, 6);
  });
});
