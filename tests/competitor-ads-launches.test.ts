import { describe, expect, it } from "vitest";
import { groupLaunches, launchRunDays, runText, runningText } from "@/lib/competitor-ads-tab/launches";
import { buildAdViews, indexRanks, type AdView, type CompetitorAdRow } from "@/lib/competitor-ads-tab/logic";

// Made-up ids and dates; no real competitor data in this repo.
const TODAY = "2026-11-22";

function view(over: Partial<AdView> & { id: string }): AdView {
  return {
    adArchiveId: over.id,
    pageId: "p1",
    brand: "Alpha",
    identity: "Alpha",
    isPartnership: false,
    startedAt: "2026-11-10T08:00:00Z",
    endedAt: null,
    runDays: null,
    mediaType: "video",
    rank: { now: null, ago7: null, ago14: null, top20: 0, top50: 0, observed: 0, best: null },
    ...over,
  } as AdView;
}

const ended = (id: string, end: string, over: Partial<AdView> = {}) => view({ id, endedAt: `${end}T08:00:00Z`, ...over });

describe("launchRunDays", () => {
  it("counts to the end date once stopped, to today while running", () => {
    expect(launchRunDays(ended("a", "2026-11-18"), TODAY)).toBe(8);
    expect(launchRunDays(view({ id: "b" }), TODAY)).toBe(12);
    expect(launchRunDays(ended("c", "2026-11-10"), TODAY)).toBe(0);
    expect(launchRunDays(view({ id: "d", startedAt: null }), TODAY)).toBeNull();
  });
});

describe("groupLaunches", () => {
  it("groups by brand and launch day, newest day first", () => {
    const days = groupLaunches(
      [
        view({ id: "a" }),
        ended("b", "2026-11-12"),
        view({ id: "c", brand: "Beta" }),
        view({ id: "d", startedAt: "2026-11-15T08:00:00Z" }),
      ],
      TODAY,
    );
    expect(days.map((d) => `${d.brand} ${d.day} ${d.total}`)).toEqual(["Alpha 2026-11-15 1", "Alpha 2026-11-10 2", "Beta 2026-11-10 1"]);
  });

  it("marks the one longest-running ad as the winner and counts the survivors", () => {
    const [d] = groupLaunches([ended("a", "2026-11-12"), view({ id: "b" }), ended("c", "2026-11-20"), ended("d", "2026-11-10")], TODAY);
    expect(d.running).toBe(1);
    expect(d.total).toBe(4);
    expect(d.winner?.ad.id).toBe("b");
    expect(d.entries.map((e) => [e.ad.id, e.days, e.winner])).toEqual([
      ["b", 12, true],
      ["c", 10, false],
      ["a", 2, false],
      ["d", 0, false],
    ]);
    expect(runningText(d)).toBe("1 of 4 still running");
  });

  it("names no winner on a tie, when everything still runs, or for a lone ad", () => {
    const tie = groupLaunches([ended("a", "2026-11-18"), ended("b", "2026-11-18"), ended("c", "2026-11-12")], TODAY)[0];
    expect(tie.winner).toBeNull();
    expect(tie.longest).toBe(8);
    expect(tie.atLongest).toBe(2);
    expect(runningText(tie)).toBe("none of 3 still running");

    const allLive = groupLaunches([view({ id: "a" }), view({ id: "b" })], TODAY)[0];
    expect(allLive.winner).toBeNull();
    expect(runningText(allLive)).toBe("all 2 still running");

    const lone = groupLaunches([view({ id: "a" })], TODAY)[0];
    expect(lone.winner).toBeNull();
    expect(runningText(lone)).toBe("1 ad, still running");
  });

  it("scales bars to the days since launch, so a stopped ad never fills its bar", () => {
    const [d] = groupLaunches([view({ id: "a" }), ended("b", "2026-11-16"), ended("c", "2026-11-10")], TODAY);
    expect(d.possible).toBe(12);
    expect(d.entries.map((e) => e.share)).toEqual([1, 0.5, 0]);
  });

  it("gives a day launched today a one-day scale", () => {
    const [d] = groupLaunches([view({ id: "a", startedAt: `${TODAY}T08:00:00Z` })], TODAY);
    expect(d.possible).toBe(1);
    expect(d.entries[0].share).toBe(0);
  });

  it("skips ads with no start date and days outside the window", () => {
    const days = groupLaunches([view({ id: "a", startedAt: null }), view({ id: "b", startedAt: "2026-08-01T08:00:00Z" }), view({ id: "c" })], TODAY, { windowDays: 60 });
    expect(days.flatMap((d) => d.entries.map((e) => e.ad.id))).toEqual(["c"]);
  });

  it("flags days launched before the brand's tracking began", () => {
    const days = groupLaunches([view({ id: "a" }), view({ id: "b", startedAt: "2026-11-21T08:00:00Z" })], TODAY, { trackedSince: { Alpha: "2026-11-15T05:53:00Z" } });
    expect(days.map((d) => [d.day, d.beforeTracking])).toEqual([
      ["2026-11-21", false],
      ["2026-11-10", true],
    ]);
  });

  it("breaks equal runs by still running, then rank, then id", () => {
    const rank = (now: number) => ({ now, ago7: null, ago14: null, top20: 0, top50: 0, observed: 0, best: null });
    const [d] = groupLaunches([view({ id: "z", rank: rank(9) }), view({ id: "y", rank: rank(2) }), view({ id: "x" })], TODAY);
    expect(d.entries.map((e) => e.ad.id)).toEqual(["y", "z", "x"]);
  });
});

describe("runText", () => {
  it("reads in plain words", () => {
    expect(runText(0)).toBe("under a day");
    expect(runText(1)).toBe("1 day");
    expect(runText(13)).toBe("13 days");
  });
});

describe("buildAdViews on a stopped ad", () => {
  it("measures days live to Meta's end date, not to now", () => {
    const row = {
      id: "r1",
      ad_archive_id: "100",
      page_id: "p1",
      page_name: "Alpha",
      is_active: false,
      started_at: "2026-11-01T08:00:00Z",
      ended_at: "2026-11-05T08:00:00Z",
    } as CompetitorAdRow;
    const [v] = buildAdViews([row], "Alpha", indexRanks([]), `${TODAY}T12:00:00Z`, false);
    expect(v.endedAt).toBe("2026-11-05T08:00:00Z");
    expect(v.runDays).toBe(4);
    const [live] = buildAdViews([{ ...row, is_active: true }], "Alpha", indexRanks([]), `${TODAY}T12:00:00Z`, false);
    expect(live.endedAt).toBeNull();
    expect(live.runDays).toBe(21);
  });
});
