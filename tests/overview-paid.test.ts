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
