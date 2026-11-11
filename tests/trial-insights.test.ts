import { describe, expect, it } from "vitest";
import { buildPace, buildWhy, etParts, type TrialEvent } from "@/lib/trial-insights";

// Eastern noon on 2026-11-10 (EST, UTC-5).
const NOW = new Date("2026-11-10T17:00:00Z");

/** An event at Eastern `date` + `hour`:`min` (EST in November). */
function at(date: string, hour: number, min = 0, store = "APP_STORE"): TrialEvent {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(hour + 5, min);
  return { event_at: d.toISOString(), store };
}

function day(date: string, perHour: number[], store = "APP_STORE"): TrialEvent[] {
  // Minutes 1, 8, 15...: never on the hour, so hour windows are unambiguous.
  return perHour.flatMap((n, h) => Array.from({ length: n }, (_, i) => at(date, h, ((i * 7) % 59) + 1, store)));
}

const dates = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date("2026-11-10T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (i + 1));
    return d.toISOString().slice(0, 10);
  });

// A flat day: 2 trials every hour, 48 a day.
const FLAT = Array(24).fill(2);

describe("etParts", () => {
  it("reads Eastern date and minute", () => {
    expect(etParts(NOW)).toEqual({ date: "2026-11-10", minute: 12 * 60 });
  });
});

describe("buildPace", () => {
  const history = dates(28).flatMap((d) => day(d, FLAT));

  it("projects a day on its usual pace to the usual total", () => {
    const today = day("2026-11-10", FLAT.slice(0, 12)); // 24 by noon
    const p = buildPace([...history, ...today], NOW)!;
    expect(p.soFar).toBe(24);
    expect(p.typicalDay).toBe(48);
    expect(p.projected).toBeGreaterThanOrEqual(46);
    expect(p.projected).toBeLessThanOrEqual(50);
    expect(p.early).toBe(false);
    expect(p.basisDays).toBe(28);
  });

  it("scales a slow day down and reads the last hour against the usual hour", () => {
    const today = day("2026-11-10", Array(12).fill(1)); // 12 by noon, half pace
    const p = buildPace([...history, ...today], NOW)!;
    expect(p.projected).toBeLessThan(30);
    expect(p.vsTypicalPct).toBeLessThan(-40);
    expect(p.lastHour).toBe(1);
    expect(p.typicalLastHour).toBe(2);
    expect(p.low).toBeLessThanOrEqual(p.projected);
    expect(p.high).toBeGreaterThanOrEqual(p.projected);
  });

  it("draws today's curve only up to now", () => {
    const p = buildPace([...history, ...day("2026-11-10", FLAT.slice(0, 12))], NOW)!;
    expect(p.curve).toHaveLength(24);
    expect(p.curve[11].today).not.toBeNull();
    expect(p.curve[13].today).toBeNull();
    expect(p.curve[23].typical).toBe(48);
  });

  it("needs a week of history", () => {
    expect(buildPace(dates(5).flatMap((d) => day(d, FLAT)), NOW)).toBeNull();
  });
});

describe("buildWhy", () => {
  // Yesterday (Nov 9) had 36 trials against 48 a day before it.
  const history = dates(28).flatMap((d, i) => (i === 0 ? day(d, Array(24).fill(1.5).map((x, h) => (h % 2 ? 1 : 2))) : day(d, FLAT)));

  it("splits the change into onboarding volume and trial rate, adding up to the whole", () => {
    const onboarding = new Map<string, number>();
    for (const d of dates(9)) onboarding.set(d, 600);
    onboarding.set("2026-11-09", 500);
    const w = buildWhy({ events: history, onboarding, meta: null, sources: null, changes: null }, NOW)!;
    expect(w.value).toBe(36);
    expect(w.baseline).toBe(48);
    expect(w.direction).toBe("down");
    const volume = w.reasons.find((r) => r.id === "onboarding")!.impact!;
    const rate = w.reasons.find((r) => r.id === "trial-rate")!.impact!;
    expect(volume + rate).toBeCloseTo(-12, 5);
    expect(w.reasons[0].id).toBe("onboarding");
    expect(w.headline).toMatch(/^Fewer people started onboarding/);
  });

  it("names where it landed and logged changes nearby", () => {
    const w = buildWhy(
      {
        events: history,
        onboarding: null,
        meta: null,
        sources: null,
        changes: [{ title: "Android Meta budget cut", kind: "change", start_date: "2026-11-08", end_date: null }],
      },
      NOW,
    )!;
    expect(w.reasons.some((r) => r.id === "platform-iOS" && r.impact === -12)).toBe(true);
    const change = w.reasons.find((r) => r.kind === "change")!;
    expect(change.text).toBe("Started Nov 8: Android Meta budget cut.");
    expect(w.reasons.at(-1)!.kind).toBe("change");
  });

  it("calls a day within 5% flat, with no headline", () => {
    const flat = dates(28).flatMap((d) => day(d, FLAT));
    const w = buildWhy({ events: flat, onboarding: null, meta: null, sources: null, changes: null }, NOW)!;
    expect(w.direction).toBe("flat");
    expect(w.headline).toBeNull();
  });

  it("sizes Meta and source moves", () => {
    const meta = dates(9).flatMap((d) => [
      { date: d, campaign_name: "SCALING iOS", spend: d === "2026-11-09" ? 300 : 600, installs: 100, trial_starts: d === "2026-11-09" ? 20 : 40 },
    ]);
    const sources = [{ source: "tiktok", count: 20, avgPerDay: 40 }];
    const onboarding = new Map(dates(9).map((d) => [d, 600] as [string, number]));
    const w = buildWhy({ events: history, onboarding, meta, sources, changes: null }, NOW)!;
    const meta_ = w.reasons.find((r) => r.id === "meta-iOS")!;
    expect(meta_.text).toMatch(/\$300 spent against \$600 a day/);
    expect(meta_.text).toMatch(/\$15 per Meta trial against \$15/);
    expect(meta_.clause).toBe("Meta iOS spend was cut 50%");
    expect(w.reasons.find((r) => r.id === "source-tiktok")!.impact).toBeCloseTo(-20 * (48 / 600), 5);
    // Funnel leads the headline; the strongest same-direction evidence explains it.
    expect(w.headline).toBe("A smaller share of new users started a trial, likely because Meta iOS spend was cut 50%");
  });
});
