import { describe, expect, it } from "vitest";
import { MIN_TRIALS_FOR_MONEY, moneyLine, summarizeMoney, toAdMoneyRow, type MmpAdMoneyRow } from "@/lib/mmp/money";

const ad = (o: Partial<MmpAdMoneyRow> = {}): MmpAdMoneyRow => ({
  campaign_id: "c1",
  campaign_name: "SCALING Campaign (iOS)",
  adset_id: "s1",
  adset_name: "DreamMe Statics",
  ad_id: "a1",
  ad_name: "Newspaper Review 4.8 (iOS)",
  floor_date: "2026-10-30",
  conv_days: 14,
  spend_since: 0,
  trials_since: 0,
  paid_since: 0,
  revenue_since: 0,
  spend_mature: 0,
  trials_mature: 0,
  paid_mature: 0,
  revenue_mature: 0,
  spend_mature_30d: 0,
  trials_mature_30d: 0,
  revenue_mature_30d: 0,
  ...o,
});

describe("toAdMoneyRow", () => {
  it("coerces PostgREST strings and keeps the date part", () => {
    const r = toAdMoneyRow({ campaign_id: "c1", ad_id: "", floor_date: "2026-11-05T00:00:00", conv_days: "14", spend_mature: "1000.5", revenue_mature: "699.9" });
    expect(r.ad_id).toBeNull();
    expect(r.floor_date).toBe("2026-11-05");
    expect(r.conv_days).toBe(14);
    expect(r.spend_mature).toBe(1000.5);
    expect(r.revenue_mature).toBe(699.9);
    expect(r.paid_mature).toBe(0);
  });
});

describe("moneyLine", () => {
  it("computes cost per payer and return from mature numbers", () => {
    const l = moneyLine(ad({ spend_mature: 1000, trials_mature: 40, paid_mature: 16, revenue_mature: 800 }));
    expect(l.costPerPayer).toBe(62.5);
    expect(l.returnOnSpend).toBe(0.8);
    expect(l.thin).toBe(false);
  });

  it("hides rates below the trial minimum but keeps the counts", () => {
    const l = moneyLine(ad({ spend_mature: 300, trials_mature: MIN_TRIALS_FOR_MONEY - 1, paid_mature: 8, revenue_mature: 400 }));
    expect(l.costPerPayer).toBeNull();
    expect(l.returnOnSpend).toBeNull();
    expect(l.payers).toBe(8);
    expect(l.revenue).toBe(400);
    expect(l.thin).toBe(true);
  });

  it("has no cost per payer with zero payers, but a 0% return", () => {
    const l = moneyLine(ad({ spend_mature: 500, trials_mature: 25, paid_mature: 0, revenue_mature: 0 }));
    expect(l.costPerPayer).toBeNull();
    expect(l.returnOnSpend).toBe(0);
  });

  it("reads the 30-day return only from 30-day-old installs with enough trials", () => {
    expect(moneyLine(ad({ trials_mature: 30, spend_mature: 100, spend_mature_30d: 200, trials_mature_30d: 10, revenue_mature_30d: 300 })).returnOnSpend30d).toBeNull();
    expect(moneyLine(ad({ trials_mature: 30, spend_mature: 100, spend_mature_30d: 200, trials_mature_30d: 25, revenue_mature_30d: 300 })).returnOnSpend30d).toBe(1.5);
  });
});

describe("summarizeMoney", () => {
  it("adds up so-far totals from every row, mature or not", () => {
    const s = summarizeMoney([
      ad({ spend_since: 500, trials_since: 20, paid_since: 3, revenue_since: 150 }),
      ad({ ad_id: "a2", spend_since: 100, trials_since: 5, paid_since: 1, revenue_since: 69.99 }),
    ]);
    expect(s.sinceTotals).toEqual({ spend: 600, trials: 25, payers: 4, revenue: 219.99 });
    expect(s.groups).toEqual([]);
    expect(s.firstMatureDay).toBe("2026-11-13");
  });

  it("groups mature ads under their ad set, biggest spend first, and totals them", () => {
    const s = summarizeMoney([
      ad({ ad_id: "a1", spend_mature: 300, trials_mature: 10, paid_mature: 4, revenue_mature: 200 }),
      ad({ ad_id: "a2", spend_mature: 900, trials_mature: 30, paid_mature: 12, revenue_mature: 700 }),
      ad({ adset_id: "s2", adset_name: "DreamMe Videos", ad_id: "a3", spend_mature: 2000, trials_mature: 50, paid_mature: 20, revenue_mature: 1500 }),
      ad({ adset_id: "s3", ad_id: "a4", spend_since: 50, trials_since: 2 }),
    ]);
    expect(s.groups.map((g) => g.adset_id)).toEqual(["s2", "s1"]);
    expect(s.groups[1].ads.map((a) => a.ad_id)).toEqual(["a2", "a1"]);
    expect(s.groups[1]).toMatchObject({ spend_mature: 1200, trials_mature: 40, paid_mature: 16, revenue_mature: 900 });
    expect(s.matureTotals).toMatchObject({ spend_mature: 3200, trials_mature: 90, paid_mature: 36, revenue_mature: 2400 });
  });

  it("keeps an ad set's spend even when one of its ads has no mature trials", () => {
    const s = summarizeMoney([
      ad({ ad_id: "a1", spend_mature: 300, trials_mature: 10, paid_mature: 4, revenue_mature: 200 }),
      ad({ ad_id: "a2", spend_mature: 80, trials_mature: 0 }),
    ]);
    expect(s.groups[0].spend_mature).toBe(380);
    expect(s.groups[0].ads.map((a) => a.ad_id)).toEqual(["a1"]);
  });
});
