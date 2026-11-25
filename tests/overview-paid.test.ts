import { describe, expect, it } from "vitest";
import { buildPaidDaily, revenueByEasternDay, type MetaDayRow } from "@/lib/overview-paid";

const TODAY = "2026-11-07";
const days = ["2026-11-07", "2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02", "2026-11-01", "2026-10-31"];

function row(date: string, campaignId: string, spend: number, metaTrials: number, installs = 0): MetaDayRow {
  return { date, campaignId, campaignName: `Campaign ${campaignId}`, spend, metaTrials, installs };
}

const base = {
  todayDate: TODAY,
  metaSource: "live" as const,
  metaError: null,
  revenueError: null,
  now: new Date("2026-11-07T18:00:00Z"),
};

describe("buildPaidDaily", () => {
  const meta = [
    row("2026-11-07", "ios", 100, 10, 40),
    row("2026-11-06", "ios", 600, 50, 200),
    row("2026-11-06", "android", 190, 20, 100),
    row("2026-10-31", "ios", 500, 25, 150),
    row("2026-11-02", "android", 200, 10, 90),
  ];
  const trials = new Map([
    ["2026-11-07", 40],
    ["2026-11-06", 120],
    ["2026-10-31", 100],
    ["2026-11-02", 90],
  ]);
  const revenue = new Map([
    ["2026-11-06", 1500],
    ["2026-10-31", 1200],
  ]);
  const out = buildPaidDaily({ ...base, meta, metaDates: new Set(days), trialsByDay: trials, revenueByDay: revenue });

  it("splits today, yesterday and the same day last week", () => {
    expect(out.today).toMatchObject({ date: "2026-11-07", spend: 100, metaTrials: 10, trials: 40 });
    expect(out.yesterday).toMatchObject({ date: "2026-11-06", spend: 790, metaTrials: 70, trials: 120, revenue: 1500 });
    expect(out.weekAgo).toMatchObject({ date: "2026-10-31", spend: 500, trials: 100, revenue: 1200 });
  });

  it("computes cost per trial both ways", () => {
    expect(out.yesterday.costPerTrial).toBeCloseTo(790 / 120);
    expect(out.yesterday.metaCostPerTrial).toBeCloseTo(790 / 70);
    expect(out.yesterday.cpi).toBeCloseTo(790 / 300);
  });

  it("last 7 days covers yesterday back to 7 days ago and excludes today", () => {
    expect(out.last7.spend).toBe(790 + 500 + 200);
    expect(out.last7.trials).toBe(120 + 100 + 90);
    expect(out.last7.revenue).toBe(2700);
  });

  it("lists campaigns by 7-day spend with their own splits", () => {
    expect(out.campaigns.map((c) => c.id)).toEqual(["ios", "android"]);
    expect(out.campaigns[0].today.spend).toBe(100);
    expect(out.campaigns[0].yesterday.metaTrials).toBe(50);
    expect(out.campaigns[1].last7.spend).toBe(390);
  });

  it("shows unknown, not zero, for days Meta didn't cover", () => {
    const synced = buildPaidDaily({
      ...base,
      metaSource: "synced",
      meta: meta.filter((r) => r.date !== TODAY),
      metaDates: new Set(days.slice(1)),
      trialsByDay: trials,
      revenueByDay: revenue,
    });
    expect(synced.today.spend).toBeNull();
    expect(synced.today.costPerTrial).toBeNull();
    expect(synced.today.trials).toBe(40);
    expect(synced.yesterday.spend).toBe(790);
  });

  it("shows unknown when a source failed outright", () => {
    const failed = buildPaidDaily({ ...base, metaSource: null, meta: null, metaDates: null, trialsByDay: null, revenueByDay: null });
    expect(failed.yesterday.spend).toBeNull();
    expect(failed.yesterday.trials).toBeNull();
    expect(failed.yesterday.revenue).toBeNull();
    expect(failed.campaigns).toEqual([]);
  });
});

describe("revenueByEasternDay", () => {
  it("buckets by the Eastern day, not the UTC day", () => {
    const m = revenueByEasternDay([
      { at: "2026-11-07T03:00:00Z", priceUsd: 50 }, // 10pm ET on Nov 6
      { at: "2026-11-07T15:00:00Z", priceUsd: 30 },
      { at: "2026-11-07T16:00:00Z", priceUsd: -10 }, // refund
    ]);
    expect(m.get("2026-11-06")).toBe(50);
    expect(m.get("2026-11-07")).toBe(20);
  });
});

describe("buildPaidDaily: Singular cost per trial", () => {
  // TODAY is 2026-11-07. A sync at noon Eastern on Nov 7 has finished Nov 6 and earlier.
  const meta = [
    row("2026-11-07", "ios", 100, 10, 40),
    row("2026-11-06", "ios", 600, 50, 200),
    row("2026-11-06", "android", 190, 20, 100),
    row("2026-11-05", "ios", 400, 30, 150),
    row("2026-10-31", "ios", 500, 25, 150),
  ];
  const sng = (date: string, campaignId: string, trials: number, syncedAt: string) => ({ date, campaignId, trials, syncedAt });
  const NOON_NOV7 = "2026-11-07T17:00:00Z";
  const NOON_NOV6 = "2026-11-06T17:00:00Z";
  const make = (singular: ReturnType<typeof sng>[] | null) =>
    buildPaidDaily({ ...base, meta, metaDates: new Set(days), trialsByDay: null, revenueByDay: null, singular });

  it("divides Meta spend by Singular trials on the same days", () => {
    const out = make([
      sng("2026-11-07", "ios", 1, NOON_NOV7), // partial today: never used
      sng("2026-11-06", "ios", 20, NOON_NOV7),
      sng("2026-11-05", "ios", 10, NOON_NOV7),
      sng("2026-10-31", "ios", 25, NOON_NOV7),
    ]);
    expect(out.today.singular).toBeNull();
    // Yesterday: all Meta spend (ios 600 + android 190) over Singular's 20,
    // shown but marked early (one day old).
    expect(out.yesterday.singular).toMatchObject({ trials: 20, spend: 790, days: 1, of: 1, early: true });
    expect(out.yesterday.singular!.costPerTrial).toBeCloseTo(790 / 20);
    expect(out.weekAgo.singular).toMatchObject({ early: false });
    expect(out.weekAgo.singular!.costPerTrial).toBeCloseTo(500 / 25);
    // The 7-day window keeps settled days only (Nov 4 and older): Nov 5 and 6
    // drop out on both sides of the division.
    expect(out.last7.singular).toMatchObject({ trials: 25, spend: 500, days: 5, of: 7, early: false });
  });

  it("leaves out a day Singular has not finished, on both sides", () => {
    // Synced at noon on Nov 6: Nov 6's row is a half day, so it must not count.
    const out = make([
      sng("2026-11-06", "ios", 2, NOON_NOV6),
      sng("2026-11-05", "ios", 10, NOON_NOV6),
      sng("2026-10-31", "ios", 25, NOON_NOV6),
    ]);
    expect(out.yesterday.singular).toBeNull();
    expect(out.singularSyncedAt).toBe(NOON_NOV6);
    // A stale sync (noon Nov 3) narrows the window further: only Oct 31 to Nov 2.
    const stale = make([sng("2026-11-02", "ios", 9, "2026-11-03T17:00:00Z"), sng("2026-10-31", "ios", 25, "2026-11-03T17:00:00Z")]);
    expect(stale.last7.singular).toMatchObject({ trials: 34, spend: 500, days: 3, of: 7 });
    expect(stale.weekAgo.singular).toMatchObject({ trials: 25 });
  });

  it("joins campaigns on the Meta campaign id, and shows no price at zero trials", () => {
    const out = make([
      sng("2026-11-06", "ios", 20, NOON_NOV7),
      sng("2026-11-05", "ios", 10, NOON_NOV7),
      sng("2026-10-31", "ios", 25, NOON_NOV7),
    ]);
    const ios = out.campaigns.find((c) => c.id === "ios")!;
    const android = out.campaigns.find((c) => c.id === "android")!;
    expect(ios.singular7).toMatchObject({ trials: 25, spend: 500, days: 5, of: 7 });
    expect(ios.singular7!.costPerTrial).toBeCloseTo(500 / 25);
    // Android only spent on Nov 6, which is too fresh to count.
    expect(android.singular7).toMatchObject({ trials: 0, spend: 0, costPerTrial: null });
  });

  it("blanks its cells when the Singular read failed or was not asked for", () => {
    expect(make(null).last7.singular).toBeNull();
    expect(make([]).last7.singular).toBeNull();
  });
});
