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
        // Capitalized deliberately — this is what Singular actually returns
        // (observed live 2026-08-12). The mapper must normalize it, because
        // every SQL consumer filters on lowercase 'facebook' and the cased
        // value leaked through the 4th UNION arm as a phantom channel that
        // double-counted $11.3k of spend into the blended CAC.
        source: "Facebook",
        os: "iOS",
        unified_campaign_id: "120236521685380622",
        unified_campaign_name: "Comic sans scribble campaign",
        // Observed live: rows carry start_date + end_date, never `date`.
        start_date: "2026-08-05",
        end_date: "2026-08-05",
        adn_cost: "145.70",
        custom_installs: "212",
        adn_installs: "220",
        tracker_installs: "34",
        // Observed live: cohort columns are keyed by the BARE event id (no
        // `_7d` suffix), and revenue by bare `revenue`.
        [TRIAL_ID]: "18",
        [SUB_ID]: "3",
        revenue: "88.20",
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
        // Lowercased from the fixture's "Facebook" — the normalization is the
        // regression guard for the phantom-channel double count.
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

    it("also accepts period-suffixed cohort keys, preferring them over bare ids", async () => {
      // The docs' ETL schemas name cohort columns `<metric>_<period>`; the
      // live API returns bare ids. Tolerate both, suffixed first.
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const row = docShapeRow();
      delete (row as Record<string, unknown>)[TRIAL_ID];
      (row as Record<string, unknown>)[`${TRIAL_ID}_7d`] = "22";

      const out = mapSingularRows([row], {
        trialEventId: TRIAL_ID,
        subscribeEventId: SUB_ID,
        cohortPeriod: "7d",
      });
      expect(out.rows[0].trial_starts).toBe(22);
    });

    it("unwraps cohort values nested by period, the shape the live API returns", async () => {
      // A real row from 2026-11-05. Reading `{ "7d": 3 }` as a number gave NaN,
      // so trials were stored as 0 for months while Singular reported them.
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const out = mapSingularRows(
        [
          {
            start_date: "2026-11-05",
            end_date: "2026-11-05",
            app: "DreamMe",
            source: "Facebook",
            os: "iOS",
            unified_campaign_id: "120249182914140622",
            unified_campaign_name: "TESTING Campaign (iOS)",
            custom_installs: 16,
            adn_installs: null,
            tracker_installs: 16,
            adn_cost: null,
            revenue: { "7d": null },
            [TRIAL_ID]: { "7d": 3 },
            [SUB_ID]: { "7d": 2 },
          },
        ],
        { trialEventId: TRIAL_ID, subscribeEventId: SUB_ID, cohortPeriod: "7d" },
      );
      expect(out.rows[0]).toMatchObject({ tracker_installs: 16, trial_starts: 3, subscribes: 2, revenue: 0, spend: 0 });
      expect(out.unmappedKeys).toEqual([]);
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

  describe("mapSingularAdRows", () => {
    const TRIAL_ID = "fdf7c8938287480997b82032f8a5eac6";
    const SUB_ID = "3a5168a819824ac4a8fb8d278994265c";
    const row = (o: Record<string, unknown> = {}) => ({
      start_date: "2026-11-01",
      end_date: "2026-11-01",
      app: "DreamMe",
      source: "Facebook",
      os: "iOS",
      unified_campaign_id: "120249101441350622",
      unified_campaign_name: "SCALING Campaign (iOS)",
      adn_sub_campaign_id: "120249131510900622",
      adn_sub_campaign_name: "DreamMe Statics",
      adn_creative_id: "120249131690160622",
      adn_creative_name: "Newspaper Review 4.8 (iOS)",
      tracker_installs: 40,
      [TRIAL_ID]: { "7d": 9 },
      [SUB_ID]: { "7d": 9 },
      ...o,
    });

    it("maps Meta's ad set and ad ids and unwraps period-keyed cohorts", async () => {
      const { mapSingularAdRows } = await import("@/lib/vendors/singular");
      const [r] = mapSingularAdRows([row()], { trialEventId: TRIAL_ID, subscribeEventId: SUB_ID, cohortPeriod: "7d" });
      expect(r).toMatchObject({
        source: "facebook",
        campaign_id: "120249101441350622",
        adset_id: "120249131510900622",
        ad_id: "120249131690160622",
        ad_name: "Newspaper Review 4.8 (iOS)",
        date: "2026-11-01",
        installs: 40,
        trial_starts: 9,
        subscribes: 9,
      });
    });

    it("turns Singular's N/A ad into an empty id so it still has a primary key", async () => {
      const { mapSingularAdRows } = await import("@/lib/vendors/singular");
      const [r] = mapSingularAdRows([row({ adn_creative_id: "N/A", adn_creative_name: "N/A" })], { trialEventId: TRIAL_ID });
      expect(r.ad_id).toBe("");
      expect(r.ad_name).toBeNull();
    });

    it("merges rows that fan out by app and os onto one primary key", async () => {
      const { mapSingularAdRows } = await import("@/lib/vendors/singular");
      const out = mapSingularAdRows(
        [row({ app: "DreamMe", tracker_installs: 30, [TRIAL_ID]: { "7d": 6 } }), row({ app: "DreamMe iOS", tracker_installs: 10, [TRIAL_ID]: { "7d": 2 } })],
        { trialEventId: TRIAL_ID },
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ installs: 40, trial_starts: 8, os: "iOS" });
    });

    it("drops rows with no campaign or date, and gives 0 trials when no event resolved", async () => {
      const { mapSingularAdRows } = await import("@/lib/vendors/singular");
      expect(mapSingularAdRows([row({ unified_campaign_id: null })], { trialEventId: TRIAL_ID })).toEqual([]);
      const [r] = mapSingularAdRows([row()]);
      expect(r.trial_starts).toBe(0);
      expect(r.paid_conversions).toBe(0);
    });

    it("reads revenue per ad on the conversion period and on 30 days, summed across fanned rows, in cents", async () => {
      const { mapSingularAdRows } = await import("@/lib/vendors/singular");
      const out = mapSingularAdRows(
        [
          row({ app: "DreamMe", revenue: { "7d": 10, "14d": 69.99, "30d": 84.98 } }),
          row({ app: "DreamMe iOS", revenue: { "7d": 0, "14d": 14.99, "30d": 14.99 } }),
        ],
        { trialEventId: TRIAL_ID, conversionEventId: "c0ffee", cohortPeriod: "7d", conversionPeriod: "14d" },
      );
      expect(out).toHaveLength(1);
      expect(out[0].revenue).toBe(84.98);
      expect(out[0].revenue_30d).toBe(99.97);
    });

    it("gives 0 revenue when Singular sends none, and 0 for 30d when that period wasn't asked for", async () => {
      const { mapSingularAdRows } = await import("@/lib/vendors/singular");
      const [none] = mapSingularAdRows([row()], { trialEventId: TRIAL_ID });
      expect(none.revenue).toBe(0);
      expect(none.revenue_30d).toBe(0);
      const [no30] = mapSingularAdRows([row({ revenue: { "7d": 5, "14d": 39.99 } })], { trialEventId: TRIAL_ID, conversionPeriod: "14d" });
      expect(no30.revenue).toBe(39.99);
      expect(no30.revenue_30d).toBe(0);
    });

    it("reads paid conversions on their own cohort period, and trials on theirs", async () => {
      // With two periods requested, each cohort value carries both keys.
      const { mapSingularAdRows } = await import("@/lib/vendors/singular");
      const CONV_ID = "c0ffee";
      const [r] = mapSingularAdRows(
        [row({ [TRIAL_ID]: { "7d": 9, "14d": 9 }, [CONV_ID]: { "7d": 1, "14d": 4 } })],
        { trialEventId: TRIAL_ID, conversionEventId: CONV_ID, cohortPeriod: "7d", conversionPeriod: "14d" },
      );
      expect(r).toMatchObject({ trial_starts: 9, paid_conversions: 4 });
    });
  });

  describe("paid conversions", () => {
    it("prefers a 14-day conversion period, then 30, and falls back when the account lists none", async () => {
      const { pickConversionPeriod } = await import("@/lib/vendors/singular");
      expect(pickConversionPeriod(["1d", "7d", "14d", "30d"])).toBe("14d");
      expect(pickConversionPeriod(["7d", "30d", "ltv"])).toBe("30d");
      expect(pickConversionPeriod([], "7d")).toBe("7d");
    });

    it("the campaign mapper counts conversions and consumes the key", async () => {
      const { mapSingularRows } = await import("@/lib/vendors/singular");
      const CONV_ID = "c0ffee";
      const out = mapSingularRows(
        [
          {
            start_date: "2026-10-20",
            end_date: "2026-10-20",
            app: "DreamMe",
            source: "Facebook",
            os: "iOS",
            unified_campaign_id: "120249101441350622",
            unified_campaign_name: "SCALING Campaign (iOS)",
            custom_installs: 80,
            adn_installs: null,
            tracker_installs: 80,
            adn_cost: null,
            revenue: { "7d": 0, "14d": 120 },
            fdf7: { "7d": 20, "14d": 20 },
            [CONV_ID]: { "7d": 0, "14d": 6 },
          },
        ],
        { trialEventId: "fdf7", conversionEventId: CONV_ID, cohortPeriod: "7d", conversionPeriod: "14d" },
      );
      expect(out.rows[0]).toMatchObject({ trial_starts: 20, paid_conversions: 6 });
      expect(out.unmappedKeys).toEqual([]);
    });

    it("resolves RevenueCat's trial-converted event by the documented name", async () => {
      const { CONVERSION_EVENT_NAMES, resolveEventId } = await import("@/lib/vendors/singular");
      const catalog = { byName: { rc_trial_converted: "abc123" }, periods: ["7d", "14d"] };
      expect(resolveEventId(catalog, CONVERSION_EVENT_NAMES)).toBe("abc123");
      expect(resolveEventId({ byName: {}, periods: [] }, CONVERSION_EVENT_NAMES)).toBeNull();
    });
  });

  describe("summarizeSingularProbe", () => {
    const TRIAL_ID = "815782610a1ddf";

    it("sums installs and trials per group and counts distinct and blank values", async () => {
      const { summarizeSingularProbe } = await import("@/lib/vendors/singular");
      const out = summarizeSingularProbe(
        [
          { adn_sub_campaign_id: "111", adn_sub_campaign_name: "Videos", tracker_installs: 40, [TRIAL_ID]: { "7d": 9 } },
          { adn_sub_campaign_id: "111", adn_sub_campaign_name: "Videos", tracker_installs: 10, [TRIAL_ID]: { "7d": 3 } },
          { adn_sub_campaign_id: "222", adn_sub_campaign_name: "Statics", tracker_installs: 70, [TRIAL_ID]: { "7d": 20 } },
          { adn_sub_campaign_id: null, adn_sub_campaign_name: null, tracker_installs: 5, [TRIAL_ID]: { "7d": null } },
        ],
        ["adn_sub_campaign_id", "adn_sub_campaign_name"],
        { trialEventId: TRIAL_ID, cohortPeriod: "7d" },
      );
      expect(out).toMatchObject({ rows: 4, installs: 125, trials: 32 });
      expect(out.distinct).toEqual({ adn_sub_campaign_id: 2, adn_sub_campaign_name: 2 });
      expect(out.blank).toEqual({ adn_sub_campaign_id: 1, adn_sub_campaign_name: 1 });
      expect(out.top[0]).toMatchObject({ adn_sub_campaign_id: "222", installs: 70, trials: 20 });
      expect(out.top[1]).toMatchObject({ adn_sub_campaign_id: "111", installs: 50, trials: 12 });
    });

    it("reports zero trials when no trial event resolved, without throwing", async () => {
      const { summarizeSingularProbe } = await import("@/lib/vendors/singular");
      const out = summarizeSingularProbe([{ os: "iOS", tracker_installs: "8" }], ["os"]);
      expect(out).toMatchObject({ rows: 1, installs: 8, trials: 0 });
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
