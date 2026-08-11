import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Singular Reporting API client.
 *
 * The response-shape half of this client was written against docs, not against
 * an observed response (see the PROVISIONAL note in src/lib/vendors/singular.ts).
 * These tests therefore pin the two things that ARE certain — the 30-day
 * chunking rule and the fact that unrecognised keys must be REPORTED rather
 * than silently dropped — plus the mapper's behaviour against the documented
 * shape. When the first live response lands, update the fixture here first;
 * a red test is the cheapest possible signal that the shape differs.
 */
describe("singular vendor client", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SINGULAR_REPORTING_API_KEY;

  beforeEach(() => {
    process.env.SINGULAR_REPORTING_API_KEY = "test-key";
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.SINGULAR_REPORTING_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  describe("singularConfigured", () => {
    it("is false without an API key", async () => {
      delete process.env.SINGULAR_REPORTING_API_KEY;
      vi.resetModules();
      const { singularConfigured } = await import("@/lib/vendors/singular");
      expect(singularConfigured()).toBe(false);
    });

    it("is true with an API key", async () => {
      const { singularConfigured } = await import("@/lib/vendors/singular");
      expect(singularConfigured()).toBe(true);
    });
  });

  describe("chunkDateRange", () => {
    it("keeps a short window as a single request", async () => {
      const { chunkDateRange } = await import("@/lib/vendors/singular");
      expect(chunkDateRange("2026-08-01", "2026-08-07")).toEqual([
        { start: "2026-08-01", end: "2026-08-07" },
      ]);
    });

    it("splits the default 35-day window into 30 + 5, contiguous and non-overlapping", async () => {
      const { chunkDateRange } = await import("@/lib/vendors/singular");
      const chunks = chunkDateRange("2026-07-08", "2026-08-11");

      expect(chunks).toEqual([
        { start: "2026-07-08", end: "2026-08-06" },
        { start: "2026-08-07", end: "2026-08-11" },
      ]);
      // No gap and no overlap at the seam — an off-by-one here would either
      // double-count a day's cohort or drop it entirely.
      const seamPrev = new Date("2026-08-06T00:00:00Z").getTime();
      const seamNext = new Date("2026-08-07T00:00:00Z").getTime();
      expect(seamNext - seamPrev).toBe(86_400_000);
    });

    it("never exceeds the API's 30-day span limit", async () => {
      const { chunkDateRange } = await import("@/lib/vendors/singular");
      const chunks = chunkDateRange("2026-05-01", "2026-08-11");
      for (const c of chunks) {
        const span =
          (new Date(`${c.end}T00:00:00Z`).getTime() -
            new Date(`${c.start}T00:00:00Z`).getTime()) /
            86_400_000 +
          1;
        expect(span).toBeLessThanOrEqual(30);
      }
    });

    it("returns nothing for an inverted range", async () => {
      const { chunkDateRange } = await import("@/lib/vendors/singular");
      expect(chunkDateRange("2026-08-11", "2026-08-01")).toEqual([]);
    });
  });

  describe("resolveEventId", () => {
    it("resolves by display name, case-insensitively", async () => {
      const { resolveEventId } = await import("@/lib/vendors/singular");
      const catalog = {
        byName: { "start trial": "815782610a1ddf", sng_subscribe: "aa11bb22" },
        periods: ["7d"],
      };
      expect(resolveEventId(catalog, ["sng_start_trial", "Start Trial"])).toBe(
        "815782610a1ddf",
      );
    });

    it("returns null rather than a wrong id when the event is missing", async () => {
      const { resolveEventId } = await import("@/lib/vendors/singular");
      // Hardcoding an id would mean a silent zero the day someone recreates
      // the event in the Singular UI; not-found must stay visible.
      expect(resolveEventId({ byName: {}, periods: [] }, ["sng_start_trial"])).toBeNull();
    });
  });

  describe("mapSingularRows", () => {
    const TRIAL_ID = "815782610a1ddf";
    const SUB_ID = "aa11bb22cc33";

    function docShapeRow(overrides: Record<string, unknown> = {}) {
      return {
        source: "facebook",
        os: "iOS",
        unified_campaign_id: "120236521685380622",
        unified_campaign_name: "Comic sans scribble campaign",
        date: "2026-08-05",
        adn_cost: "145.70",
        custom_installs: "212",
        adn_installs: "220",
        tracker_installs: "34",
        [`${TRIAL_ID}_7d`]: "18",
        [`${SUB_ID}_7d`]: "3",
        revenue_7d: "88.20",
        ...overrides,
      };
    }

    it("maps the documented response shape onto our schema", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const out = mapSingularRows([docShapeRow()], {
        trialEventId: TRIAL_ID,
        subscribeEventId: SUB_ID,
        cohortPeriod: "7d",
      });

      expect(out.rows).toHaveLength(1);
      expect(out.rows[0]).toMatchObject({
        source: "facebook",
        campaign_id: "120236521685380622",
        campaign_name: "Comic sans scribble campaign",
        date: "2026-08-05",
        spend: 145.7,
        installs: 212,
        adn_installs: 220,
        tracker_installs: 34,
        trial_starts: 18,
        subscribes: 3,
        revenue: 88.2,
      });
      expect(out.unmappedKeys).toEqual([]);
    });

    it("REPORTS keys it could not consume instead of silently dropping them", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      // This is the whole safety net for a shape we have never observed live.
      const out = mapSingularRows(
        [docShapeRow({ some_unexpected_metric: "9", another_one: "1" })],
        { trialEventId: TRIAL_ID, subscribeEventId: SUB_ID, cohortPeriod: "7d" },
      );

      expect(out.unmappedKeys).toEqual(["another_one", "some_unexpected_metric"]);
      expect(out.sampleRaw).not.toBeNull();
    });

    it("falls back to the bare event id when the period suffix is absent", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const row = docShapeRow();
      delete (row as Record<string, unknown>)[`${TRIAL_ID}_7d`];
      (row as Record<string, unknown>)[TRIAL_ID] = "22";

      const out = mapSingularRows([row], {
        trialEventId: TRIAL_ID,
        subscribeEventId: SUB_ID,
        cohortPeriod: "7d",
      });
      expect(out.rows[0].trial_starts).toBe(22);
    });

    it("merges rows that fan out across os/app onto the table's PK grain", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      // The report requests `app` and `os` dimensions, so one campaign/date
      // arrives as multiple rows. Left unmerged, these become duplicate
      // conflict keys in one PostgREST INSERT, which Postgres rejects
      // wholesale ("cannot affect row a second time") — the upsert 500s.
      const out = mapSingularRows(
        [
          docShapeRow({ os: "iOS", custom_installs: "150", [`${TRIAL_ID}_7d`]: "12", adn_cost: "100.00" }),
          docShapeRow({ os: "Android", custom_installs: "62", [`${TRIAL_ID}_7d`]: "6", adn_cost: "45.70" }),
        ],
        { trialEventId: TRIAL_ID, subscribeEventId: SUB_ID, cohortPeriod: "7d" },
      );

      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].installs).toBe(212);
      expect(out.rows[0].trial_starts).toBe(18);
      expect(out.rows[0].spend).toBeCloseTo(145.7);
      // os is meaningless once platforms are merged — must be null, not "iOS".
      expect(out.rows[0].os).toBeNull();
    });

    it("keeps os when every fanned row agrees on it", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const out = mapSingularRows(
        [
          docShapeRow({ app: "DreamMe", custom_installs: "100" }),
          docShapeRow({ app: "DreamMe Widget", custom_installs: "12" }),
        ],
        { trialEventId: TRIAL_ID, subscribeEventId: SUB_ID, cohortPeriod: "7d" },
      );
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].os).toBe("iOS");
      // `app` is consumed (it is a requested dimension), never unmapped noise.
      expect(out.unmappedKeys).toEqual([]);
    });

    it("drops rows with no campaign id — it is the primary key", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const out = mapSingularRows(
        [docShapeRow(), docShapeRow({ unified_campaign_id: "" })],
        { trialEventId: TRIAL_ID, cohortPeriod: "7d" },
      );
      expect(out.rows).toHaveLength(1);
    });

    it("coerces missing or non-numeric metrics to 0 rather than NaN", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const out = mapSingularRows(
        [
          {
            unified_campaign_id: "c1",
            date: "2026-08-05",
            adn_cost: "not-a-number",
          },
        ],
        { trialEventId: TRIAL_ID, cohortPeriod: "7d" },
      );
      // NaN would be rejected by the numeric columns on upsert.
      expect(out.rows[0].spend).toBe(0);
      expect(out.rows[0].trial_starts).toBe(0);
      expect(Number.isNaN(out.rows[0].spend)).toBe(false);
    });

    it("handles an empty report without throwing", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const out = mapSingularRows([], { trialEventId: TRIAL_ID });
      expect(out.rows).toEqual([]);
      expect(out.sampleRaw).toBeNull();
    });
  });

  describe("fetchCohortMetricsCatalog", () => {
    it("indexes events by display name and by raw name", async () => {
      globalThis.fetch = vi.fn(async (url) => {
        expect(String(url)).toContain("/api/cohort_metrics");
        expect(String(url)).toContain("api_key=test-key");
        return new Response(
          JSON.stringify({
            metrics: [
              { display_name: "Start Trial", name: "815782610a1ddf" },
              { display_name: "Subscribe", name: "aa11bb22" },
            ],
            periods: ["1d", "7d", "ltv"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const { fetchCohortMetricsCatalog, resolveEventId } = await import(
        "@/lib/vendors/singular"
      );
      const catalog = await fetchCohortMetricsCatalog();

      expect(resolveEventId(catalog, ["Start Trial"])).toBe("815782610a1ddf");
      expect(catalog.periods).toContain("7d");
    });
  });
});
