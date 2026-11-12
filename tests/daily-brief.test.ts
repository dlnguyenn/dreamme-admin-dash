import { describe, expect, it } from "vitest";
import { buildDailyBrief, cleanParam, experimentItems, type DailyBriefInput } from "@/lib/daily-brief";
import type { ExperimentEntry } from "@/lib/experiment-log";
import type { PaidDaily, PaidDay } from "@/lib/overview-paid";
import type { MrrSection } from "@/lib/overview-mrr";

const TODAY = "2026-11-12"; // a Thursday; the brief is for Wed Nov 11

const day = (date: string, p: Partial<PaidDay> = {}): PaidDay => ({
  date,
  spend: null,
  installs: null,
  metaTrials: null,
  trials: null,
  revenue: null,
  costPerTrial: null,
  metaCostPerTrial: null,
  cpi: null,
  ...p,
});

const daily: PaidDaily = {
  today: day("2026-11-12"),
  yesterday: day("2026-11-11", { trials: 64, revenue: 1240.4, spend: 410.2, metaCostPerTrial: 9.3 }),
  weekAgo: day("2026-11-04", { trials: 71 }),
  last7: day("2026-11-04..2026-11-10", { trials: 480, revenue: 8260, spend: 2765 }),
  campaigns: [],
  metaSource: "live",
  metaError: null,
  revenueError: null,
  fetchedAt: "2026-11-12T12:00:00Z",
};

const mrr = {
  mrr: 38_240,
  lastDay: { date: "2026-11-11", change: 120, pct: 0.3 },
  d30: { days: 30, change: 1500, pct: 4.08, perDay: 50, priorChange: null, priorPct: null },
} as unknown as MrrSection;

const overview = (o: Partial<DailyBriefInput["overview"]> = {}): DailyBriefInput["overview"] => ({
  northStar: {
    date: "2026-11-11",
    trialStartsYesterday: 64,
    trialStartsToday: 9,
    onboardingStartsToday: null,
    trialStartRatePct: null,
    last7d: 480,
    avg7d: 68.6,
    deltaPct: null,
    spark: [],
    stale: false,
  },
  paid: { daily } as DailyBriefInput["overview"]["paid"],
  mrr,
  urgent: [],
  ...o,
});

const entry = (p: Partial<ExperimentEntry>): ExperimentEntry => ({
  id: "x",
  title: "Test",
  kind: "experiment",
  area: "pricing",
  status: "running",
  hypothesis: "",
  what_changed: "",
  has_control: true,
  start_date: null,
  end_date: null,
  primary_metric: "",
  result: "",
  decision: "",
  rc_experiment_id: null,
  vault_page: null,
  links: "",
  handoff_id: null,
  owner: null,
  created_at: "",
  updated_at: "",
  ...p,
});

describe("buildDailyBrief", () => {
  it("reports yesterday against the 7-day average and last week", () => {
    const b = buildDailyBrief({ overview: overview(), experiments: [], today: TODAY });
    expect(b.dayLabel).toBe("Wed Nov 11");
    expect(b.trials).toBe("64 · 7d avg 69 (-7%)");
    expect(b.revenue).toBe("$1,240 · 7d avg $1,180");
    expect(b.spend).toBe("$410 · $9.30 per Meta trial · 7d avg $395");
    expect(b.mrr).toBe("$38.2k · +$120 yesterday · +4.1% in 30d");
    expect(b.needsYou).toBe("nothing urgent");
    expect(b.params).toHaveLength(7);
    expect(b.text).toContain("Trials: 64 · 7d avg 69");
  });

  it("says a source failed instead of showing zero", () => {
    const b = buildDailyBrief({
      overview: overview({ paid: null, mrr: null, urgent: null, northStar: null }),
      experiments: null,
      today: TODAY,
    });
    expect(b.trials).toBe("couldn't read RevenueCat");
    expect(b.revenue).toBe("couldn't read revenue");
    expect(b.spend).toBe("couldn't read Meta");
    expect(b.mrr).toBe("couldn't read MRR");
    expect(b.needsYou).toMatch(/couldn't check alerts/);
    expect(b.experiments).toBe("couldn't read the experiment log");
  });

  it("puts critical alerts first with a marker and caps the list", () => {
    const urgent = ["a", "b", "c", "d", "e", "f"].map((t, n) => ({
      id: t,
      fingerprint: t,
      level: (n === 0 ? "critical" : "warning") as "critical" | "warning",
      title: `Alert ${t}`,
      detail: "",
    }));
    const b = buildDailyBrief({ overview: overview({ urgent }), experiments: [], today: TODAY });
    expect(b.needsYou).toBe("🔴 Alert a · Alert b · Alert c · Alert d · +2 more");
  });

  it("never sends a value WhatsApp would reject", () => {
    expect(cleanParam("line one\nline two\t  x")).toBe("line one line two x");
    expect(cleanParam("   ")).toBe("-");
    expect(cleanParam("x".repeat(400))).toHaveLength(300);
  });
});

describe("experimentItems", () => {
  it("lists undecided stops, running tests, upcoming starts and fresh changes", () => {
    const items = experimentItems(
      [
        entry({ title: "Monthly $19.99 vs $14.99 (iOS, US)", status: "running", start_date: "2026-11-11" }),
        entry({ title: "Step-down", status: "stopped", start_date: "2026-10-14", decision: "" }),
        entry({ title: "Old decided", status: "stopped", decision: "kept" }),
        entry({ title: "Switchback", status: "planned", start_date: "2026-11-14" }),
        entry({ title: "Far future", status: "planned", start_date: "2026-12-01" }),
        entry({ title: "In-app cancel offer screen: new title and subtitle (English, German)", kind: "change", status: "running", start_date: "2026-11-11" }),
        entry({ title: "Sad-fish image", kind: "change", status: "running", start_date: "2026-11-12" }),
        entry({ title: "Old change", kind: "change", status: "running", start_date: "2026-10-01" }),
      ],
      TODAY,
    );
    expect(items).toEqual([
      "Step-down stopped, needs a decision",
      "Monthly $19.99 vs $14.99 day 2",
      "Switchback starts Sat Nov 14",
      "2 new changes live: In-app cancel offer screen; Sad-fish image",
    ]);
  });
});
