import { describe, expect, it } from "vitest";
import { addDays, easternDate, easternMidnightIso, weekStart } from "@/lib/revenue-plan/dates";
import { NET_FACTOR, sourceGroup } from "@/lib/revenue-plan/sources";
import { buildCohorts, net12Series, planOf, summarize, type Charge, type TrialStart } from "@/lib/revenue-plan/value-per-trial";

const DAY = 86_400_000;
const at = (iso: string, plusDays = 0) => new Date(Date.parse(iso) + plusDays * DAY).toISOString();

describe("dates", () => {
  it("buckets by US/Eastern day and Monday weeks", () => {
    // 03:00Z on Oct 5 is still Sunday Oct 4 in New York.
    expect(easternDate("2026-10-05T03:00:00Z")).toBe("2026-10-04");
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
  });

  it("finds Eastern midnight on both sides of the DST change (Nov 1, 2026)", () => {
    expect(easternMidnightIso("2026-10-26")).toBe("2026-10-26T04:00:00.000Z");
    expect(easternMidnightIso("2026-11-01")).toBe("2026-11-01T04:00:00.000Z");
    expect(easternMidnightIso("2026-11-02")).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("sourceGroup", () => {
  it("maps the onboarding answers to the plan's three channels", () => {
    expect(sourceGroup("facebook")).toBe("meta");
    expect(sourceGroup("Instagram ")).toBe("meta");
    expect(sourceGroup("tiktok")).toBe("tiktok");
    expect(sourceGroup("app_store")).toBe("other");
    expect(sourceGroup("youtube")).toBe("other");
    expect(sourceGroup(null)).toBe("other");
  });
});

describe("planOf", () => {
  it("reads the product id, then the billing period for Stripe ids", () => {
    expect(planOf("DreamMeLifeSubscriptionYearlySpecial")).toBe("yearly_special");
    expect(planOf("dreammelifesubscriptionyearly:yearly-plan")).toBe("yearly");
    expect(planOf("DreamMeLifeSubscriptionQuarterly")).toBe("quarterly");
    expect(planOf("dreammelifesubscriptionmonthly:monthly-plan")).toBe("monthly");
    expect(planOf("com.dreamme.pearls.550")).toBe("consumable");
    expect(planOf("prod_Uq1kdfhcdU5ICV", 365)).toBe("yearly");
    expect(planOf("prod_Uq1ksXCBPa9mYU", 30)).toBe("monthly");
    expect(planOf("prod_mystery", null)).toBe("unknown");
  });
});

// Week of Mon Sep 28: four trials. Today is far enough on that every window is mature.
const W = "2026-09-28";
const T = "2026-09-29T15:00:00Z"; // Tue Sep 29, 11am Eastern
const trials: TrialStart[] = [
  { otx: "t-meta-yearly", userId: "u1", at: T, store: "APP_STORE" },
  { otx: "t-meta-none", userId: "u2", at: T, store: "APP_STORE" },
  { otx: "t-tiktok-monthly", userId: "u3", at: T, store: "PLAY_STORE" },
  { otx: "t-anon", userId: "$RCAnonymousID:abc", at: T, store: "APP_STORE" },
];
const sources = new Map<string, string | null>([
  ["u1", "facebook"],
  ["u2", "instagram"],
  ["u3", "tiktok"],
]);
const charge = (userId: string, plusDays: number, priceUsd: number, productId: string): Charge => ({
  userId,
  otx: null,
  at: at(T, plusDays),
  priceUsd,
  productId,
  periodDays: null,
});

describe("buildCohorts", () => {
  const charges = [
    charge("u1", 7.2, 69.99, "DreamMeLifeSubscriptionYearly"), // day-7 conversion
    charge("u3", 7.0, 14.99, "DreamMeLifeSubscriptionMonthly"),
    charge("u3", 20, 4.99, "com.dreamme.pearls.550"), // in 30-day, not a payer signal
    charge("u3", 37, 14.99, "DreamMeLifeSubscriptionMonthly"), // second month: outside 30 days
  ];
  const cohorts = buildCohorts(trials, charges, sources, "2026-12-01");
  const cell = (g: string) => cohorts.find((c) => c.week === W && c.group === g)!;

  it("splits a week by source group and keeps unmatched users apart", () => {
    expect(cell("meta").trials).toBe(2);
    expect(cell("tiktok").trials).toBe(1);
    expect(cell("unmatched").trials).toBe(1);
    expect(cohorts.find((c) => c.group === "other")).toBeUndefined();
  });

  it("counts payers, yearly share and the revenue windows", () => {
    const m = cell("meta");
    expect(m.payers).toBe(1);
    expect(m.yearlyPayers).toBe(1);
    // The 7.2-day conversion lands inside the 8-day "7-day" window.
    expect(m.rev7).toBeCloseTo(69.99);
    expect(m.rev30).toBeCloseTo(69.99);
    expect(m.proj12Gross).toBeCloseTo(69.99);

    const t = cell("tiktok");
    expect(t.payers).toBe(1);
    expect(t.yearlyPayers).toBe(0);
    expect(t.rev7).toBeCloseTo(14.99);
    expect(t.rev30).toBeCloseTo(14.99 + 4.99);
    expect(t.proj12Gross).toBeCloseTo(14.99 * 3.4);
  });

  it("gives a charge to the user's latest trial only", () => {
    const twoTrials: TrialStart[] = [
      { otx: "old", userId: "u9", at: "2026-09-01T15:00:00Z", store: "APP_STORE" },
      { otx: "new", userId: "u9", at: T, store: "APP_STORE" },
    ];
    const out = buildCohorts(twoTrials, [charge("u9", 7.1, 39.99, "DreamMeLifeSubscriptionYearlySpecial")], new Map([["u9", "tiktok"]]), "2026-12-01");
    const total = out.reduce((s, c) => s + c.payers, 0);
    expect(total).toBe(1);
    expect(out.find((c) => c.week === W)!.payers).toBe(1);
  });

  it("marks a window mature only once the week's last trial has had it in full", () => {
    // Week of Sep 28 ends Sun Oct 4; 30 more days = Nov 3.
    const early = buildCohorts(trials, [], sources, "2026-11-03");
    expect(early[0].d30Mature).toBe(false);
    expect(early[0].payersMature).toBe(true);
    const late = buildCohorts(trials, [], sources, "2026-11-04");
    expect(late[0].d30Mature).toBe(true);
  });
});

describe("summarize", () => {
  const mk = (week: string, group: "meta" | "tiktok" | "other", n: number, payers: number, proj: number) =>
    Array.from({ length: n }, (_, i) => ({ week, group, i, payer: i < payers, proj }));
  // Build cohorts through the real builder: n trials, `payers` of them monthly at $10.
  function cohortsFor(rows: ReturnType<typeof mk>, today: string) {
    const ts: TrialStart[] = [];
    const cs: Charge[] = [];
    const src = new Map<string, string | null>();
    for (const r of rows) {
      const id = `${r.week}-${r.group}-${r.i}`;
      const start = `${addDays(r.week, 1)}T15:00:00Z`;
      ts.push({ otx: id, userId: id, at: start, store: "APP_STORE" });
      src.set(id, r.group === "meta" ? "facebook" : r.group === "tiktok" ? "tiktok" : "app_store");
      if (r.payer) cs.push({ userId: id, otx: id, at: at(start, 7.1), priceUsd: 10, productId: "DreamMeLifeSubscriptionMonthly", periodDays: 30 });
    }
    return buildCohorts(ts, cs, src, today);
  }

  it("reads the latest N mature weeks per metric and nets at x0.84", () => {
    const rows = [
      ...mk("2026-09-07", "meta", 10, 2, 0),
      ...mk("2026-09-14", "meta", 10, 4, 0),
      ...mk("2026-09-14", "tiktok", 10, 5, 0),
      ...mk("2026-09-14", "other", 10, 3, 0),
    ];
    const cohorts = cohortsFor(rows, "2026-12-01");
    const s = summarize(cohorts, { lastN: 1 });
    expect(s.meta.payerWeeks).toEqual(["2026-09-14"]);
    expect(s.meta.payerRate).toBeCloseTo(0.4);
    expect(s.meta.net12PerTrial).toBeCloseTo(((4 * 10 * 3.4) / 10) * NET_FACTOR);
    expect(s.nonMeta.payerTrials).toBe(20);
    expect(s.nonMeta.payerRate).toBeCloseTo(8 / 20);
    expect(s.all.payerTrials).toBe(30);

    const both = summarize(cohorts, { from: "2026-09-07", to: "2026-09-14" });
    expect(both.meta.payerRate).toBeCloseTo(6 / 20);
  });

  it("leaves immature weeks out of the weekly series", () => {
    const cohorts = cohortsFor(mk("2026-11-02", "meta", 5, 1, 0), "2026-11-10");
    expect(net12Series(cohorts, "meta")[0].value).toBeNull();
  });
});
