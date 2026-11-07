import { describe, expect, it } from "vitest";
import { buildUrgentAlerts, easternHour, type UrgentInputs } from "@/lib/overview-alerts";
import type { PaidDaily, PaidDay } from "@/lib/overview-paid";

const NOW = new Date("2026-11-07T17:00:00Z"); // noon Eastern

const day = (date: string, spend: number | null): PaidDay => ({
  date,
  spend,
  installs: 0,
  metaTrials: 0,
  trials: 0,
  revenue: 0,
  costPerTrial: null,
  metaCostPerTrial: null,
  cpi: null,
});

const paid = (todaySpend: number | null, last7Spend = 5000, source: PaidDaily["metaSource"] = "live"): PaidDaily => ({
  today: day("2026-11-07", todaySpend),
  yesterday: day("2026-11-06", 700),
  weekAgo: day("2026-10-31", 700),
  last7: day("range", last7Spend),
  campaigns: [],
  metaSource: source,
  metaError: source === "live" ? null : "Meta 400: token invalid",
  revenueError: null,
  fetchedAt: NOW.toISOString(),
});

const clean: UrgentInputs = {
  now: NOW,
  easternHour: 12,
  ops: [{ key: "ads", label: "Meta ad insights", lastAt: "2026-11-07T07:00:00Z", ageHours: 10, expectHours: 30, state: "ok" }],
  sectionErrors: [],
  northStar: { trialStartsToday: 30, avg7d: 70, stale: false },
  paid: paid(300),
  metaAccount: { status: 1, disableReason: 0 },
  metaAccountError: null,
  rejectedAds: [],
  rejectedAdsError: null,
  adAccountId: "act_1",
  metaTokenExpiresAt: null,
  marketingAlerts: [],
  urgentSupportUnread: 0,
  urgentReviews: [],
};

const ids = (i: Partial<UrgentInputs>) => buildUrgentAlerts({ ...clean, ...i }).map((a) => a.id);

describe("buildUrgentAlerts", () => {
  it("is empty when everything is normal", () => {
    expect(buildUrgentAlerts(clean)).toEqual([]);
  });

  it("flags late and missing pipelines, worse ones as critical", () => {
    const out = buildUrgentAlerts({
      ...clean,
      ops: [
        { key: "rc", label: "RevenueCat sync", lastAt: "x", ageHours: 40, expectHours: 30, state: "late" },
        { key: "tiktok", label: "TikTok profile scrape", lastAt: "y", ageHours: 4000, expectHours: 30, state: "late" },
      ],
    });
    expect(out.map((a) => [a.id, a.level])).toEqual([
      ["ops:tiktok", "critical"],
      ["ops:rc", "warning"],
    ]);
  });

  it("flags zero trials only once enough of the day has passed", () => {
    expect(ids({ northStar: { trialStartsToday: 0, avg7d: 70, stale: false } })).toContain("trials:zero-today");
    expect(ids({ easternHour: 1, northStar: { trialStartsToday: 0, avg7d: 70, stale: false } })).not.toContain("trials:zero-today");
  });

  it("flags $0 Meta spend mid-day on a normally spending account, not at dawn", () => {
    expect(ids({ paid: paid(0) })).toContain("meta:no-spend");
    expect(ids({ paid: paid(0), easternHour: 6 })).not.toContain("meta:no-spend");
    expect(ids({ paid: paid(0, 100) })).not.toContain("meta:no-spend");
  });

  it("flags a broken Meta connection, account status and expiring token", () => {
    expect(ids({ metaAccountError: "Meta 190: token expired" })).toContain("meta:read");
    expect(ids({ paid: paid(null, 5000, "synced") })).toContain("meta:live-insights");
    expect(ids({ metaAccount: { status: 3, disableReason: 0 } })).toContain("meta:account");
    expect(ids({ metaTokenExpiresAt: "2026-11-09T00:00:00Z" })).toContain("meta:token");
    expect(ids({ metaTokenExpiresAt: "2026-12-30T00:00:00Z" })).not.toContain("meta:token");
  });

  it("groups rejected ads into one item that changes when the set changes", () => {
    const a = buildUrgentAlerts({ ...clean, rejectedAds: [{ id: "1", name: "10r", status: "DISAPPROVED", adsetName: "T", reason: "Unacceptable business practices" }] });
    expect(a).toHaveLength(1);
    expect(a[0].detail).toContain("Unacceptable business practices");
    const b = buildUrgentAlerts({ ...clean, rejectedAds: [{ id: "1", name: "10r", status: "DISAPPROVED", adsetName: "T", reason: null }, { id: "2", name: "06r", status: "DISAPPROVED", adsetName: "T", reason: null }] });
    expect(b[0].fingerprint).not.toBe(a[0].fingerprint);
  });

  it("keeps only recent, critical, bad-direction marketing alerts", () => {
    const base = { campaign_name: "SCALING", created_at: "2026-11-07T08:00:00Z" };
    const out = ids({
      marketingAlerts: [
        { ...base, id: "a", severity: "critical", metric: "cpi", message: "CPI drop — $2.48 vs $3.94" },
        { ...base, id: "b", severity: "critical", metric: "cpi", message: "CPI spike — $6.51 vs $4.52" },
        { ...base, id: "c", severity: "warn", metric: "cpm", message: "CPM spike" },
        { ...base, id: "d", severity: "critical", metric: "spend", message: "Spend drop — $64 vs $858" },
        { ...base, id: "e", severity: "critical", metric: "ctr", message: "CTR drop", created_at: "2026-11-04T08:00:00Z" },
      ],
    });
    expect(out).toEqual(["marketing:d", "marketing:b"]);
  });

  it("surfaces people waiting: urgent support and broken/billing reviews", () => {
    expect(ids({ urgentSupportUnread: 2 })).toContain("support:urgent");
    const r = buildUrgentAlerts({ ...clean, urgentReviews: [{ store: "app_store", rating: 1, reasons: ["broken"], reviewedAt: "2026-11-06" }] });
    expect(r[0].title).toBe("1 new store review about the app breaking");
  });

  it("puts critical items first", () => {
    const out = buildUrgentAlerts({ ...clean, urgentSupportUnread: 1, metaAccountError: "boom" });
    expect(out[0].level).toBe("critical");
  });
});

describe("easternHour", () => {
  it("reads the Eastern wall clock", () => {
    expect(easternHour(new Date("2026-11-07T17:30:00Z"))).toBe(12.5);
    expect(easternHour(new Date("2026-11-07T04:00:00Z"))).toBe(23);
  });
});
