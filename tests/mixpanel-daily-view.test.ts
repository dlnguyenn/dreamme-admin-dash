import { describe, expect, it } from "vitest";
import { dailyRuns, dailyScale, shortDateLabel } from "@/lib/app-analytics";
import { Report } from "@/lib/app-analytics-schema";
import {
  COMING_BACK_VIEW_ID,
  DAILY_VIEW_ID,
  LIVE_VIEWS,
  NEW_PEOPLE_VIEW_ID,
  STEP_KEY,
  STEP_RANK_KEY,
  activeDayCounts,
  buildDailyView,
  changeNote,
  changeShort,
  countLabel,
  eventHealth,
  median,
  pointsNote,
  recentVsBase,
  rollingMean,
  rollingRate,
  weekdayIndex,
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

  it("words a change between two rates in points", () => {
    expect(pointsNote(null)).toBe("not enough history to compare");
    expect(pointsNote(0.04)).toBe("level with the 4 weeks before");
    expect(pointsNote(1)).toBe("+1 point against the 4 weeks before");
    expect(pointsNote(-2.46)).toBe("\u22122.5 points against the 4 weeks before");
  });

  it("takes a plain ratio when asked, such as views per person", () => {
    expect(rollingRate([10, 30], [5, 5], 7, 1)).toEqual([2, 4]);
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
    const all = built.views.flatMap((v) => v.sections).flatMap((s) => s.blocks);
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

describe("the two views built from breakdowns and cohorts", () => {
  const events = { onboarding_started: 20, sign_up_completed: 16, trial_started: 5, meal_logged: 50 };
  const N = 130;
  /** Every day gets the same made-up screens, answers and cohorts, counted through the last complete day. */
  const detailed = (patch?: (i: number, r: DailyRow) => void) =>
    rows(N, events, (i, r) => {
      r.breakdowns = {
        [STEP_KEY]: { welcome: [20, 20], medication: [18, 18], frequency: [10, 10], goal: [16, 16], save_progress: [12, 12] },
        // people, then the sum of the position each person met the screen at
        [STEP_RANK_KEY]: { welcome: [20, 20], medication: [18, 36], frequency: [10, 30], goal: [16, 64], save_progress: [12, 60] },
        "onboarding_referral_source_selected|source": { facebook: [10, 10], tiktok: [6, 6], friend_family: [4, 4] },
        "trial_started|referral_source": { facebook: [3, 3], tiktok: [2, 2] },
        "trial_started|paywall_source": { onboarding: [4, 4], exploding_offer: [1, 1] },
        "trial_started|plan_type": { yearly: [3, 3], monthly: [2, 2] },
      };
      r.cohorts = {
        through: day(N - 1),
        signup: { n: 20, f: [4, 3, 2, 1, 1] },
        trial: { n: 10, f: [5, 4, 3, 2, 1], h: [0, 4, 2, 1, 1, 1, 0, 1] },
      };
      patch?.(i, r);
    });
  const build = (r: DailyRow[]) => buildDailyView(r, { today: day(N), windowDays: 30 });
  const viewOf = (r: DailyRow[], id: string) => build(r).views.find((v) => v.id === id);
  const seriesOf = (v: ReturnType<typeof viewOf>, label: string) =>
    v?.sections.flatMap((s) => s.blocks).flatMap((b) => (b.type === "series" ? b.series : [])).find((s) => s.label === label);

  it("leaves out Coming back until cohorts are stored", () => {
    const built = buildDailyView(rows(60, events), { today: day(60), windowDays: 30 });
    expect(built.views.map((v) => v.id)).toEqual([DAILY_VIEW_ID, NEW_PEOPLE_VIEW_ID]);
    expect(built.views[1].sections.map((s) => s.id)).toEqual(["start"]);
  });

  it("builds three views the report checks accept", () => {
    const built = build(detailed());
    expect(built.views.map((v) => v.id)).toEqual(LIVE_VIEWS.map((v) => v.id));
    const parsed = Report.safeParse({ version: 1, asOf: day(N - 1), sources: "Test.", views: built.views });
    expect(parsed.success ? null : parsed.error.issues[0]).toBeNull();
  });

  it("lists onboarding screens in the order people meet them and reads a skipped screen as skipped", () => {
    const table = viewOf(detailed(), NEW_PEOPLE_VIEW_ID)!.sections.find((s) => s.id === "screens")!.blocks[0];
    if (table.type !== "table") throw new Error("expected a table");
    expect(table.rows).toEqual([
      ["Welcome", 140, 100, null, 0],
      ["Medication", 126, 90, -10, 0],
      // Fewer people than the screen after it: shown to some, so no loss is read into it.
      ["Frequency (not shown to everyone)", 70, 50, null, 0],
      ["Goal", 112, 80, -10, 0],
      ["Save progress", 84, 60, -20, 0],
      ["Started a trial (after the paywall)", 35, 25, -35, 0],
    ]);
  });

  it("says where a screen got worse against the 4 weeks before", () => {
    const worse = detailed((i, r) => {
      if (i >= N - 7) r.breakdowns![STEP_KEY].goal = [12, 12];
    });
    const table = viewOf(worse, NEW_PEOPLE_VIEW_ID)!.sections.find((s) => s.id === "screens")!.blocks[0];
    if (table.type !== "table") throw new Error("expected a table");
    expect(table.rows.find((r) => r[0] === "Goal")).toEqual(["Goal", 84, 60, -30, -20]);
  });

  it("shares out the where-did-you-hear answers and counts trials per answer", () => {
    const view = viewOf(detailed(), NEW_PEOPLE_VIEW_ID);
    expect(seriesOf(view, "Facebook")?.headline).toBe("50%");
    expect(seriesOf(view, "TikTok")?.headline).toBe("30%");
    expect(seriesOf(view, "A friend or family")?.values.at(-1)).toBe(20);
    const table = view!.sections.find((s) => s.id === "source")!.blocks[1];
    if (table.type !== "table") throw new Error("expected a table");
    expect(table.rows[0]).toEqual(["Facebook", 10, 50, 3, 30]);
    expect(table.rows[2]).toEqual(["A friend or family", 4, 20, 0, 0]);
  });

  it("leaves a gap, not a zero, on a day whose breakdowns were never pulled", () => {
    const view = viewOf(
      detailed((i, r) => {
        if (i === N - 3) r.breakdowns = {};
      }),
      NEW_PEOPLE_VIEW_ID,
    );
    expect(seriesOf(view, "Trials started from the exploding offer")?.values.slice(-3)).toEqual([null, 1, 1]);
    expect(seriesOf(view, "Share of trials on the yearly plan")?.headline).toBe("60%");
  });

  it("compares the phones only when both have people", () => {
    expect(viewOf(detailed(), NEW_PEOPLE_VIEW_ID)!.sections.some((s) => s.id === "phones")).toBe(false);
    const both = detailed((_, r) => {
      r.events.onboarding_started = [20, 20, 15, 15, 5, 5];
      r.events.trial_started = [5, 5, 4, 4, 1, 1];
    });
    const phones = viewOf(both, NEW_PEOPLE_VIEW_ID)!.sections.find((s) => s.id === "phones")!;
    const trial = phones.blocks[1];
    if (trial.type !== "series") throw new Error("expected series");
    expect(trial.half).toBe(true);
    expect(trial.series.map((s) => [s.label, s.headline])).toEqual([
      ["iPhone", "26.7%"],
      ["Android", "20%"],
    ]);
  });

  it("gives a cohort a figure only once its wait has fully passed", () => {
    const view = viewOf(detailed(), COMING_BACK_VIEW_ID)!;
    const block = view.sections.find((s) => s.id === "signups")!.blocks[0];
    if (block.type !== "series") throw new Error("expected series");
    // The cohort charts run to at least 90 days whatever window is picked.
    expect(block.days).toHaveLength(90);
    const [next, , , , eight] = block.series;
    expect(next.label).toBe("Came back the next day");
    expect(next.values.slice(-2)).toEqual([20, null]);
    expect(next.headline).toBe("20%");
    // 8 weeks later needs 62 days: the newest 62 days of sign-ups have no figure yet.
    expect(eight.values.slice(-63)).toEqual([5, ...new Array(62).fill(null)]);
    expect(eight.smooth?.slice(-62).every((v) => v === null)).toBe(true);
    expect(eight.headline).toBe("5%");
    expect(eight.note).toBe("newest 7 measurable days, level with the 4 weeks before");
  });

  it("sums up the first week of a trial", () => {
    expect(activeDayCounts([0, 4, 2, 1, 1, 1, 0, 1])).toEqual({ days: 27, fourPlus: 3, firstOnly: 4 });
    expect(activeDayCounts(undefined)).toEqual({ days: 0, fourPlus: 0, firstOnly: 0 });

    const view = viewOf(detailed(), COMING_BACK_VIEW_ID)!;
    expect(seriesOf(view, "Average active days in the first 7")?.headline).toBe("2.7");
    expect(seriesOf(view, "Active on 4 or more of the 7 days")?.headline).toBe("30%");
    expect(seriesOf(view, "Active on the first day only")?.headline).toBe("40%");
    const spread = view.sections.find((s) => s.id === "trial-week")!.blocks[1];
    if (spread.type !== "columns") throw new Error("expected columns");
    expect(spread.series).toHaveLength(2);
    expect(spread.series[0].values).toEqual([40, 20, 10, 10, 10, 0, 10]);

    const stats = view.sections[0].blocks[0];
    if (stats.type !== "stats") throw new Error("expected stats first");
    expect(stats.items.map((s) => s.value)).toEqual(["20%", "15%", "2.7", "20%"]);
  });
});

describe("weekday pattern", () => {
  // Jan 1 2026 is a Thursday.
  const days56 = Array.from({ length: 56 }, (_, i) => day(i));
  const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

  it("is 100 across the week for a level count", () => {
    expect(weekdayIndex(days56, days56.map(() => 40))).toEqual([100, 100, 100, 100, 100, 100, 100]);
  });

  it("lifts the weekday that runs high, Monday first", () => {
    const index = weekdayIndex(days56, days56.map((d) => (weekday(d) === 5 ? 80 : 40)))!;
    expect(index[4]).toBe(175);
    expect(index[0]).toBe(88);
  });

  it("needs four weeks and every weekday", () => {
    expect(weekdayIndex(days56.slice(0, 20), new Array(20).fill(40))).toBeNull();
    expect(weekdayIndex(days56, days56.map((d) => (weekday(d) === 0 ? null : 40)))).toBeNull();
    expect(weekdayIndex(days56, days56.map(() => 0))).toBeNull();
  });
});
