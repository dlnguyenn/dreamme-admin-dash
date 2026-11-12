import { describe, expect, it } from "vitest";
import { dailyRuns, dailyScale, shortDateLabel } from "@/lib/app-analytics";
import { Report } from "@/lib/app-analytics-schema";
import {
  DAILY_VIEW_ID,
  buildDailyView,
  changeNote,
  changeShort,
  countLabel,
  eventHealth,
  median,
  recentVsBase,
  rollingMean,
  rollingRate,
  type DailyRow,
  type EventCounts,
} from "@/lib/mixpanel-daily-view";

// Made-up figures throughout: real ones live in the database.
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
const counts = (users: number, total = users * 2): EventCounts => [users, total, users, total, 0, 0];

/** `n` days from Jan 1 where every listed event has the same count each day. */
function rows(n: number, events: Record<string, number>, patch?: (i: number, r: DailyRow) => void): DailyRow[] {
  return Array.from({ length: n }, (_, i) => {
    const r: DailyRow = {
      day: day(i),
      events: Object.fromEntries(Object.entries(events).map(([k, v]) => [k, counts(v)])),
      people: { act: [100, 90, 10], seen: [120, 105, 15] },
    };
    patch?.(i, r);
    return r;
  });
}

describe("rolling figures", () => {
  it("averages the trailing week and waits for half of it", () => {
    const out = rollingMean([7, 7, 7, 7, 14, 14, 14, 14]);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(out[3]).toBe(7);
    expect(out[7]).toBe(11);
  });

  it("skips missing days", () => {
    expect(rollingMean([10, null, 20, null, 30, null, 40], 7)[6]).toBe(25);
  });

  it("takes a rate as sum over sum, in percent", () => {
    const rate = rollingRate([1, 0, 9], [10, 0, 10], 3);
    expect(rate[2]).toBe(50);
    expect(rate[1]).toBe(10);
    expect(rollingRate([1], [0])[0]).toBeNull();
  });

  it("compares the last 7 days with the 28 before", () => {
    const flat = Array.from({ length: 35 }, () => 100);
    expect(recentVsBase(flat)).toEqual({ recent: 100, base: 100, pct: 0 });
    const up = [...Array.from({ length: 28 }, () => 100), ...Array.from({ length: 7 }, () => 110)];
    expect(Math.round(recentVsBase(up).pct ?? 0)).toBe(10);
    expect(recentVsBase([5, 5, 5]).pct).toBeNull();
  });

  it("words the change plainly", () => {
    expect(changeNote(4.4)).toBe("+4% against the 4 weeks before");
    expect(changeNote(-12.6)).toBe("−13% against the 4 weeks before");
    expect(changeNote(0.2)).toBe("level with the 4 weeks before");
    expect(changeNote(null)).toBe("not enough history to compare");
    expect(changeShort(5.2)).toBe("+5%");
    expect(changeShort(-25)).toBe("−25%");
    expect(changeShort(0.3)).toBe("level");
    expect(changeShort(null)).toBe("");
  });

  it("rounds a daily count for a headline", () => {
    expect(countLabel(1234.4)).toBe("1,234");
    expect(countLabel(3.44)).toBe("3.4");
    expect(countLabel(null)).toBe("–");
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("eventHealth", () => {
  const base = Array.from({ length: 28 }, () => 100);
  const week = (v: number) => Array.from({ length: 7 }, () => v);

  it("calls a level event steady", () => {
    const h = eventHealth([...base, ...week(95)]);
    expect(h.status).toBe("Steady");
    expect(h.tone).toBe("good");
    expect(h.usual).toBe(100);
    expect(h.yesterday).toBe(95);
  });

  it("flags an event that stopped, like the app-open event did", () => {
    expect(eventHealth([...base, 100, 100, 100, 100, 0, 0, 0]).status).toBe("Stopped");
    expect(eventHealth([...base, ...week(2)]).status).toBe("Down by half or more");
    expect(eventHealth([...base, ...week(2)]).tone).toBe("bad");
  });

  it("warns on a fall of a quarter or a doubling", () => {
    expect(eventHealth([...base, ...week(70)]).status).toBe("Down");
    expect(eventHealth([...base, ...week(70)]).tone).toBe("warn");
    expect(eventHealth([...base, ...week(250)]).status).toBe("Doubled or more");
  });

  it("does not judge one bad day, a tiny event, or a new one", () => {
    expect(eventHealth([...base, 100, 100, 100, 100, 100, 100, 0]).status).toBe("Steady");
    expect(eventHealth([...Array.from({ length: 28 }, () => 2), ...week(0)]).status).toBe("Too small to judge");
    expect(eventHealth([...Array.from({ length: 28 }, () => 0), ...week(40)]).status).toBe("New");
    expect(eventHealth(week(40)).status).toBe("Too little history");
  });
});

describe("buildDailyView", () => {
  const events = { meal_logged: 50, shot_logged: 30, onboarding_started: 20, trial_started: 5, notification_sent: 200, notification_opened: 10 };

  it("returns nothing until a full day is stored", () => {
    expect(buildDailyView([], { today: day(0), windowDays: 30 }).view).toBeNull();
    expect(buildDailyView(rows(1, events), { today: day(0), windowDays: 30 }).view).toBeNull();
  });

  it("leaves out today and builds a view the report checks accept", () => {
    const all = rows(60, events);
    const built = buildDailyView(all, { today: day(59), windowDays: 30 });
    expect(built.through).toBe(day(58));
    expect(built.view?.id).toBe(DAILY_VIEW_ID);
    expect(built.attention).toBe(0);
    const parsed = Report.safeParse({ version: 1, asOf: day(58), sources: "Test.", views: [built.view] });
    expect(parsed.success).toBe(true);

    const series = built.view!.sections.flatMap((s) => s.blocks).filter((b) => b.type === "series");
    for (const b of series) {
      if (b.type !== "series") continue;
      expect(b.days).toHaveLength(30);
      expect(b.days[29]).toBe(day(58));
      for (const s of b.series) expect(s.values).toHaveLength(30);
    }
  });

  it("puts level figures in the headline stats", () => {
    const built = buildDailyView(rows(60, events), { today: day(60), windowDays: 30 });
    const stats = built.view!.sections[0].blocks[0];
    if (stats.type !== "stats") throw new Error("expected stats first");
    expect(stats.items[0].value).toBe("100");
    expect(stats.items[0].note).toBe("level with the 4 weeks before");
    expect(stats.items[1].value).toBe("50");
    expect(stats.items[3].value).toBe("0");
  });

  it("works out the trial rate as trials over onboarding starts", () => {
    const built = buildDailyView(rows(60, events), { today: day(60), windowDays: 30 });
    const all = built.view!.sections.flatMap((s) => s.blocks);
    const rate = all.flatMap((b) => (b.type === "series" ? b.series : [])).find((s) => s.label === "Trial starts per onboarding start");
    expect(rate?.headline).toBe("25%");
    expect(rate?.unit).toBe("%");
    expect(rate?.values[29]).toBe(25);
  });

  it("flags an event that went quiet and lists it first", () => {
    const all = rows(60, events, (i, r) => {
      if (i >= 50) delete r.events.shot_logged;
    });
    const built = buildDailyView(all, { today: day(60), windowDays: 30 });
    expect(built.attention).toBe(1);
    const table = built.view!.sections.find((s) => s.id === "arriving")!.blocks[0];
    if (table.type !== "table") throw new Error("expected a table");
    expect(table.rows[0][0]).toBe("`shot_logged`");
    expect(table.rows[0][4]).toEqual({ status: "Stopped", tone: "bad" });
  });

  it("does not flag an event the app stopped sending on purpose", () => {
    const all = rows(60, { ...events, app_opened: 400 }, (i, r) => {
      if (i >= 45) r.events.app_opened = [10, 20, 10, 20, 0, 0];
    });
    const built = buildDailyView(all, { today: day(60), windowDays: 30 });
    expect(built.attention).toBe(0);
    const table = built.view!.sections.find((s) => s.id === "arriving")!.blocks[0];
    if (table.type !== "table") throw new Error("expected a table");
    const row = table.rows.find((r) => r[0] === "`app_opened`");
    expect(row?.[4]).toEqual({ status: "Removed from the app", tone: "neutral" });
  });

  it("breaks the line on a day that was never pulled", () => {
    const all = rows(60, events).filter((r) => r.day !== day(50));
    const built = buildDailyView(all, { today: day(60), windowDays: 30 });
    const block = built.view!.sections.find((s) => s.id === "features")!.blocks[0];
    if (block.type !== "series") throw new Error("expected series");
    expect(block.series[0].values[block.days.indexOf(day(50))]).toBeNull();
  });

  it("only shows the session chart once the new event has data", () => {
    const labels = (r: DailyRow[]) =>
      buildDailyView(r, { today: day(60), windowDays: 30 })
        .view!.sections.find((s) => s.id === "people")!
        .blocks.flatMap((b) => (b.type === "series" ? b.series.map((s) => s.label) : []));
    expect(labels(rows(60, events))).not.toContain("Started a session");
    expect(labels(rows(60, { ...events, app_session_started: 80 }))).toContain("Started a session");
  });
});

describe("daily chart helpers", () => {
  it("starts the scale at zero unless every day sits in the top half", () => {
    expect(dailyScale({ label: "a", values: [1, null, 8], smooth: [null, 9, 2] })).toEqual({ lo: 0, hi: 9 });
    expect(dailyScale({ label: "a", values: [0, 0] })).toEqual({ lo: 0, hi: 1 });
    expect(dailyScale({ label: "a", values: [] })).toEqual({ lo: 0, hi: 1 });
    // 1,600 to 1,900: zoomed in, starting on a round hundred below the lowest day.
    expect(dailyScale({ label: "a", values: [1600, 1900, 1750] })).toEqual({ lo: 1400, hi: 1900 });
    // A dead-flat line is not zoomed (there is nothing to show).
    expect(dailyScale({ label: "a", values: [500, 500, 501] })).toEqual({ lo: 0, hi: 501 });
  });

  it("draws the line on that scale and breaks it at gaps", () => {
    expect(dailyRuns([0, 10, null, 10, 5], { lo: 0, hi: 10 })).toEqual(["0.00,100.00 25.00,0.00", "75.00,0.00 100.00,50.00"]);
    expect(dailyRuns([15, 20], { lo: 10, hi: 20 })).toEqual(["0.00,50.00 100.00,0.00"]);
    expect(dailyRuns([], { lo: 0, hi: 10 })).toEqual([]);
  });

  it("labels days without a timezone shift", () => {
    expect(shortDateLabel("2026-11-01")).toBe("Nov 1");
    expect(shortDateLabel("2026-11-01", true)).toBe("Sun, Nov 1");
  });
});
