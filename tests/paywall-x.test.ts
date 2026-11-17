/**
 * Paywall X test readout (src/lib/paywall-x). Every id here is made up.
 */
import { describe, expect, it } from "vitest";
import {
  buildPaywallXReadout,
  diffRead,
  sampleRatio,
  type PaywallXReadout,
  type ReadoutInput,
  type SegmentRead,
} from "@/lib/paywall-x/readout";
import { EMPTY_INPUT, assignment, cancel, charge, demoInput, fakeId, tag, trial } from "@/lib/paywall-x/fixtures";
import { chipLabel, mentionsPaywallX, normalizeArm, sourceFromSalt } from "@/lib/paywall-x/shared";

const H = 3_600_000;
const DAY = 24 * H;
// 10:00 US/Eastern on Nov 14; that Eastern day ends at 05:00 UTC on Nov 15.
const T = Date.parse("2026-11-14T15:00:00Z");
const at = (offsetMs: number) => new Date(T + offsetMs).toISOString();
const NOW = new Date(T + 40 * DAY);

const input = (p: Partial<ReadoutInput>): ReadoutInput => ({ ...EMPTY_INPUT, ...p });
const seg = (r: PaywallXReadout, key = "all/all"): SegmentRead => {
  const s = r.segments.find((x) => x.key === key);
  if (!s) throw new Error(`no segment ${key}`);
  return s;
};

describe("no data (the state today)", () => {
  const r = buildPaywallXReadout(EMPTY_INPUT, NOW);
  it("says the test hasn't started instead of showing zeros as results", () => {
    expect(r.state).toBe("no_data");
    expect(r.exposed).toBe(0);
    expect(r.message).toMatch(/Nobody has been exposed yet/);
    expect(r.firstExposure).toBeNull();
    expect(r.recent).toEqual([]);
  });
  it("reads nothing: rates have no denominator, revenue is too early, diffs too few", () => {
    const s = seg(r);
    expect(s.arms.control.trial24h).toEqual({ n: 0, x: 0, rate: null, tooRecent: 0 });
    expect(s.arms.close_x.rev30.perUser).toBeNull();
    expect(s.diffs.trial7d.verdict).toBe("too_few");
    expect(s.srm.state).toBe("too_few");
    expect(r.need2pt).toBeNull();
  });
});

describe("arms, sources and platforms", () => {
  const r = buildPaywallXReadout(
    input({
      assignments: [
        assignment(1, "control", at(0), { salt: "v1", platform: "ios" }),
        assignment(2, "close_x", at(0), { salt: "v1", platform: "android" }),
        assignment(3, "control", at(0), { salt: "rc", platform: "ios" }),
        assignment(4, "close_x", at(0), { salt: "rc", platform: "ios" }),
        assignment(5, "close_x", at(0), { salt: "rc", platform: "android" }),
        assignment(6, "treatment", at(0)), // not an arm of this test
      ],
    }),
    NOW,
  );
  it("counts every exposed user in their arm, trial or not", () => {
    expect(r.exposed).toBe(5);
    expect(seg(r).arms.control.exposed).toBe(2);
    expect(seg(r).arms.close_x.exposed).toBe(3);
    expect(r.checks.unknownVariant).toBe(1);
  });
  it("splits by source (salt rc = RevenueCat) and platform", () => {
    expect(seg(r, "revenuecat/all").arms.close_x.exposed).toBe(2);
    expect(seg(r, "revenuecat/all").arms.control.exposed).toBe(1);
    expect(seg(r, "split/all").arms.control.exposed).toBe(1);
    expect(seg(r, "split/all").arms.close_x.exposed).toBe(1);
    expect(seg(r, "all/ios").arms.close_x.exposed).toBe(1);
    expect(seg(r, "all/android").arms.close_x.exposed).toBe(2);
    expect(seg(r, "revenuecat/android").arms.close_x.exposed).toBe(1);
  });
  it("users exposed but never trialing stay in the denominator", () => {
    const c = seg(r).arms.control;
    expect(c.trial7d).toEqual({ n: 2, x: 0, rate: 0, tooRecent: 0 });
    expect(c.trialists).toBe(0);
    expect(r.recent.every((u) => u.status === "no_trial")).toBe(true);
  });
  it("keeps one exposure per user (the earliest row)", () => {
    const r2 = buildPaywallXReadout(
      input({ assignments: [assignment(1, "close_x", at(DAY)), assignment(1, "control", at(0))] }),
      NOW,
    );
    expect(r2.exposed).toBe(1);
    expect(seg(r2).arms.control.exposed).toBe(1);
  });
});

describe("trial windows", () => {
  const r = buildPaywallXReadout(
    input({
      assignments: [1, 2, 3, 4, 5, 6, 7].map((n) => assignment(n, "control", at(0))),
      trials: [
        trial(1, at(30 * 60_000)), // 30 min later: same day, 24 h, 7 days
        trial(2, at(20 * H)), // next Eastern day, inside 24 h
        trial(3, at(3 * DAY)), // inside 7 days only
        trial(4, at(8 * DAY)), // outside 7 days: not a trialist
        trial(5, at(-2 * H)), // before the 1 h lookback: not this exposure's trial
        trial(6, at(-30 * 60_000)), // inside the lookback: counts
        // user 7 never trials
      ],
    }),
    NOW,
  );
  const c = seg(r).arms.control;
  it("same Eastern day", () => {
    expect(c.trialSameDay.x).toBe(2); // users 1 and 6
    expect(c.trialSameDay.n).toBe(7);
  });
  it("within 24 hours", () => {
    expect(c.trial24h.x).toBe(3); // 1, 2, 6
  });
  it("within 7 x 24 hours", () => {
    expect(c.trial7d.x).toBe(4); // 1, 2, 3, 6
    expect(c.trialists).toBe(4);
    expect(c.trial7d.rate).toBeCloseTo(4 / 7);
  });
  it("users too recent for a window are left out of it and counted as too recent", () => {
    const now = new Date(T + 2 * DAY);
    const r2 = buildPaywallXReadout(
      input({
        assignments: [assignment(1, "control", at(0)), assignment(2, "control", at(2 * DAY - 2 * H))],
        trials: [trial(1, at(H)), trial(2, at(2 * DAY - H))],
      }),
      now,
    );
    const c2 = seg(r2).arms.control;
    expect(c2.trial24h).toEqual({ n: 1, x: 1, rate: 1, tooRecent: 1 });
    expect(c2.trial7d).toEqual({ n: 0, x: 0, rate: null, tooRecent: 2 });
    expect(c2.trialists).toBe(2); // counted as soon as they happen
    expect(c2.trialSameDay.n).toBe(1); // user 2's Eastern day isn't over
  });
});

describe("after the trial starts", () => {
  const r = buildPaywallXReadout(
    input({
      assignments: [1, 2, 3, 4, 5].map((n) => assignment(n, "close_x", at(0))),
      trials: [1, 2, 3, 4, 5].map((n) => trial(n, at(H))),
      cancels: [
        cancel(1, at(5 * H)), // auto-renew off inside 24 h
        cancel(2, at(30 * H)), // after 24 h
        cancel(3, at(3 * H), "CUSTOMER_SUPPORT"), // a refund, not the user turning it off
        cancel(4, at(4 * H), "BILLING_ERROR"),
      ],
      charges: [charge(5, at(H + 7.2 * DAY), 59.99), charge(2, at(H + 20 * DAY), 14.99, "demo_monthly")],
      refunds: [{ ...charge(5, at(H + 9 * DAY), -59.99) }],
    }),
    NOW,
  );
  const x = seg(r).arms.close_x;
  it("auto-renew off within 24 h of the trial start", () => {
    expect(x.renewOff24h).toEqual({ n: 5, x: 1, rate: 0.2, tooRecent: 0 });
  });
  it("converted to paid = paid charge within 14 days of the trial", () => {
    expect(x.paid14.x).toBe(1); // user 5; user 2's charge is on day 20
  });
  it("counts refunds after the trial", () => {
    expect(x.refunded).toBe(1);
    expect(r.recent.find((u) => u.appUserId === fakeId(5))?.status).toBe("refunded");
    expect(r.recent.find((u) => u.appUserId === fakeId(1))?.status).toBe("auto_renew_off");
    expect(r.recent.find((u) => u.appUserId === fakeId(2))?.status).toBe("paid");
  });
  it("an UNCANCELLATION turns the status back, but the 24 h count keeps the cancel", () => {
    const r2 = buildPaywallXReadout(
      input({
        assignments: [assignment(1, "control", at(0))],
        trials: [trial(1, at(H))],
        cancels: [cancel(1, at(2 * H)), cancel(1, at(3 * H), "", "UNCANCELLATION")],
      }),
      NOW,
    );
    expect(seg(r2).arms.control.renewOff24h.x).toBe(1);
    expect(r2.recent[0].status).toBe("trial");
  });
});

describe("revenue per exposed user", () => {
  it("is too early until someone is 14 / 30 days past exposure", () => {
    const r = buildPaywallXReadout(
      input({ assignments: [assignment(1, "control", at(0))], trials: [trial(1, at(H))], charges: [charge(1, at(8 * DAY), 59.99)] }),
      new Date(T + 10 * DAY),
    );
    const c = seg(r).arms.control;
    expect(c.rev14).toEqual({ n: 0, sum: 0, perUser: null, tooRecent: 1 });
    expect(c.rev30.perUser).toBeNull();
  });
  it("divides gross charges inside the window by every exposed user that old", () => {
    const r = buildPaywallXReadout(
      input({
        assignments: [assignment(1, "control", at(0)), assignment(2, "control", at(0)), assignment(3, "control", at(0))],
        trials: [trial(1, at(H)), trial(2, at(H))],
        charges: [
          charge(1, at(8 * DAY), 60), // inside 14 and 30
          charge(2, at(8 * DAY), 15, "demo_monthly"),
          charge(2, at(20 * DAY), 15, "demo_monthly"), // inside 30 only
          charge(2, at(35 * DAY), 15, "demo_monthly"), // outside both
        ],
        refunds: [{ ...charge(1, at(9 * DAY), -60) }], // gross: refunds not deducted
      }),
      NOW,
    );
    const c = seg(r).arms.control;
    expect(c.rev14.n).toBe(3);
    expect(c.rev14.perUser).toBeCloseTo(75 / 3);
    expect(c.rev30.perUser).toBeCloseTo(90 / 3);
  });
});

describe("RevenueCat's arm attribute", () => {
  const r = buildPaywallXReadout(
    input({
      assignments: [assignment(1, "close_x", at(0)), assignment(2, "control", at(0)), assignment(3, "control", at(0))],
      trials: [trial(1, at(H)), trial(2, at(H))],
      tags: [
        // user 1: not on the trial start, only on a later event
        tag(1, at(2 * DAY), "close_x"),
        // user 2: RevenueCat disagrees with the exposure row
        tag(2, at(H), "close_x"),
        // user 3: source attribute says RevenueCat but the row's salt says split
        tag(3, at(H), "control", "revenuecat"),
        // user 9: tagged in RevenueCat, no exposure row
        tag(9, at(H), "close_x"),
      ],
    }),
    NOW,
  );
  it("is read from any event, so a later event still matches", () => {
    expect(r.checks.tagged).toBe(3);
    expect(r.checks.armMismatch).toBe(1);
  });
  it("flags source disagreements and users missing an exposure row, without counting them", () => {
    expect(r.checks.sourceMismatch).toBe(1);
    expect(r.checks.tagOnly).toEqual({ control: 0, close_x: 1 });
    expect(r.exposed).toBe(3);
  });
});

describe("sample ratio", () => {
  it("too few to check under 100 users", () => {
    expect(sampleRatio(40, 20).state).toBe("too_few");
  });
  it("even when the gap is chance-sized", () => {
    expect(sampleRatio(248, 252).state).toBe("even");
    expect(sampleRatio(480, 520).state).toBe("even");
  });
  it("uneven past p < 0.001", () => {
    const s = sampleRatio(300, 200);
    expect(s.state).toBe("uneven");
    expect(s.p!).toBeLessThan(0.001);
    expect(s.text).toMatch(/Uneven split/);
  });
  it("an uneven readout leads with the warning", () => {
    const r = buildPaywallXReadout(demoInput({ now: NOW, users: 800, closeXShare: 0.62 }), NOW);
    expect(seg(r).srm.state).toBe("uneven");
    expect(r.message).toMatch(/^Uneven split/);
  });
  it("the made-up even fixture is not flagged", () => {
    const r = buildPaywallXReadout(demoInput({ now: NOW }), NOW);
    expect(seg(r).srm.state).toBe("even");
  });
});

describe("differences", () => {
  it("needs 30 per arm before it reads", () => {
    const d = diffRead("trial24h", { n: 29, x: 10, rate: 10 / 29, tooRecent: 0 }, { n: 100, x: 20, rate: 0.2, tooRecent: 0 });
    expect(d.verdict).toBe("too_few");
    expect(d.ci).toBeNull();
  });
  it("calls a range that crosses zero no clear difference", () => {
    const d = diffRead("trial24h", { n: 100, x: 22, rate: 0.22, tooRecent: 0 }, { n: 100, x: 20, rate: 0.2, tooRecent: 0 });
    expect(d.verdict).toBe("unclear");
    expect(d.ci!.low).toBeLessThan(0);
    expect(d.ci!.high).toBeGreaterThan(0);
  });
  it("calls a range above zero higher", () => {
    const d = diffRead("trial7d", { n: 2000, x: 600, rate: 0.3, tooRecent: 0 }, { n: 2000, x: 400, rate: 0.2, tooRecent: 0 });
    expect(d.verdict).toBe("higher");
    expect(d.ci!.diff).toBeCloseTo(0.1);
  });
});

describe("a month of made-up data", () => {
  const r = buildPaywallXReadout(demoInput({ now: NOW }), NOW);
  it("reads, with every segment adding up", () => {
    expect(r.state).toBe("reading");
    const all = seg(r);
    const bySource = seg(r, "revenuecat/all").arms.close_x.exposed + seg(r, "split/all").arms.close_x.exposed;
    expect(bySource).toBe(all.arms.close_x.exposed);
    const byPlatform = seg(r, "all/ios").arms.control.exposed + seg(r, "all/android").arms.control.exposed;
    expect(byPlatform).toBe(all.arms.control.exposed);
    expect(all.arms.control.exposed + all.arms.close_x.exposed).toBe(r.exposed);
    expect(r.recent.length).toBe(50);
    expect(r.need2pt).toBeGreaterThan(100);
  });
  it("never reads a rate on users too new for it", () => {
    for (const s of r.segments) {
      for (const a of [s.arms.control, s.arms.close_x]) {
        expect(a.trial7d.n + a.trial7d.tooRecent).toBe(a.exposed);
        expect(a.rev30.n + a.rev30.tooRecent).toBe(a.exposed);
        expect(a.paid14.n + a.paid14.tooRecent).toBe(a.trialists);
      }
    }
  });
});

describe("shared helpers", () => {
  it("normalizes arms and sources", () => {
    expect(normalizeArm("close_x")).toBe("close_x");
    expect(normalizeArm(" Control ")).toBe("control");
    expect(normalizeArm("x")).toBeNull();
    expect(sourceFromSalt("rc")).toBe("revenuecat");
    expect(sourceFromSalt("v1")).toBe("split");
    expect(sourceFromSalt(null)).toBe("split");
  });
  it("finds the test key in an Experiments-log entry", () => {
    expect(mentionsPaywallX({ title: "Paywall X test", links: "experiment key: paywall_close_x" })).toBe(true);
    expect(mentionsPaywallX({ what_changed: "paywall_close_x_v2" })).toBe(false);
    expect(mentionsPaywallX({ title: "Paywall X test" })).toBe(false);
  });
  it("labels the chip", () => {
    expect(chipLabel({ arm: "close_x", source: "split", platform: "ios", exposedAt: null, from: "assignment" })).toBe("X test: close_x");
  });
});
