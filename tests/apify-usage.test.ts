import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const API_URL = "https://api.apify.com/v2/users/me/usage/monthly";

describe("fetchApifyCurrentCycle", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.APIFY_KEY;

  beforeEach(() => {
    process.env.APIFY_KEY = "test-key";
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.APIFY_KEY = originalKey;
    vi.restoreAllMocks();
  });

  function mockApifyResponse(body: unknown) {
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe(API_URL);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }

  it("sums cash-billed and credit-funded usage in daily breakdown", async () => {
    mockApifyResponse({
      data: {
        usageCycle: { startAt: "2026-04-15", endAt: "2026-05-14" },
        dailyServiceUsages: [
          { date: "2026-05-01", totalUsdBilled: 0.5, totalUsdBilledCredits: 2.5 },
          { date: "2026-05-02", totalUsdBilled: 0, totalUsdBilledCredits: 3.3 },
          { date: "2026-05-03", totalUsdBilled: 1.2, totalUsdBilledCredits: 0 },
        ],
        totalUsdBilled: 1.7,
        totalUsdBilledCredits: 5.8,
      },
    });

    const { fetchApifyCurrentCycle } = await import(
      "@/lib/vendors/apify-usage"
    );
    const cycle = await fetchApifyCurrentCycle();

    expect(cycle.cycleStart).toBe("2026-04-15");
    expect(cycle.cycleEnd).toBe("2026-05-14");
    expect(cycle.dailyBreakdown).toEqual([
      { date: "2026-05-01", usd: 3.0 },
      { date: "2026-05-02", usd: 3.3 },
      { date: "2026-05-03", usd: 1.2 },
    ]);
    expect(cycle.usdTotal).toBe(7.5);
  });

  it("falls back to summing daily breakdown when totals omitted", async () => {
    mockApifyResponse({
      data: {
        usageCycle: { startAt: "2026-04-15", endAt: "2026-05-14" },
        dailyServiceUsages: [
          { date: "2026-05-01", totalUsdBilledCredits: 1.11 },
          { date: "2026-05-02", totalUsdBilled: 2.22 },
        ],
      },
    });

    const { fetchApifyCurrentCycle } = await import(
      "@/lib/vendors/apify-usage"
    );
    const cycle = await fetchApifyCurrentCycle();

    expect(cycle.usdTotal).toBe(3.33);
  });

  it("handles credits-only billing (paid-plan users with monthly credit allotment)", async () => {
    mockApifyResponse({
      data: {
        usageCycle: { startAt: "2026-04-15", endAt: "2026-05-14" },
        dailyServiceUsages: [
          { date: "2026-05-01", totalUsdBilled: 0, totalUsdBilledCredits: 4.2 },
        ],
        totalUsdBilled: 0,
        totalUsdBilledCredits: 4.2,
      },
    });

    const { fetchApifyCurrentCycle } = await import(
      "@/lib/vendors/apify-usage"
    );
    const cycle = await fetchApifyCurrentCycle();

    expect(cycle.usdTotal).toBe(4.2);
    expect(cycle.dailyBreakdown[0]?.usd).toBe(4.2);
  });
});
