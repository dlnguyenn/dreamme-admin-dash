import { describe, expect, it } from "vitest";
import {
  assessCursor,
  describeStall,
  REALERT_AFTER_MINUTES,
  STALE_AFTER_MINUTES,
} from "@/lib/support/health";

/**
 * The 2026-08-06 stall was invisible for eleven hours because every surface
 * looked fine: the poller ran, the sent leg advanced, and the inbox was just
 * "quiet". The only reliable signal is the email cursor not moving — so these
 * tests pin exactly when that fires, and just as importantly when it doesn't.
 */
const NOW = Date.parse("2026-08-06T17:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("assessCursor", () => {
  it("stays quiet while the cursor is moving", () => {
    const v = assessCursor({ updatedAt: minsAgo(19), alertedAt: null, now: NOW });
    expect(v.stale).toBe(false);
    expect(v.shouldAlert).toBe(false);
    expect(v.minutesSinceAdvance).toBe(19);
  });

  it("fires once the cursor has been still past the threshold", () => {
    const v = assessCursor({
      updatedAt: minsAgo(STALE_AFTER_MINUTES),
      alertedAt: null,
      now: NOW,
    });
    expect(v.stale).toBe(true);
    expect(v.shouldAlert).toBe(true);
  });

  it("would have caught the real incident", () => {
    // Cursor froze at 05:34, checked at 17:00 — eleven and a half hours.
    const v = assessCursor({
      updatedAt: "2026-08-06T05:34:41Z",
      alertedAt: null,
      now: NOW,
    });
    expect(v.stale).toBe(true);
    expect(v.minutesSinceAdvance).toBeGreaterThan(680);
    expect(describeStall(v.minutesSinceAdvance!, "gmail-api-inbox")).toContain("11h");
  });

  it("does not repeat the same warning on every 20-minute poll", () => {
    const v = assessCursor({
      updatedAt: minsAgo(300),
      alertedAt: minsAgo(20), // warned one poll ago
      now: NOW,
    });
    expect(v.stale).toBe(true);
    expect(v.shouldAlert).toBe(false);
  });

  it("warns again after the re-alert window while still stuck", () => {
    const v = assessCursor({
      updatedAt: minsAgo(600),
      alertedAt: minsAgo(REALERT_AFTER_MINUTES + 1),
      now: NOW,
    });
    expect(v.shouldAlert).toBe(true);
  });

  it("treats a recovery followed by a fresh stall as a new incident", () => {
    // Alerted at 09:00, cursor recovered and advanced at 10:00, stuck since.
    // Suppressing on "we already warned today" would hide the second outage.
    const v = assessCursor({
      updatedAt: minsAgo(120),
      alertedAt: minsAgo(480),
      now: NOW,
    });
    expect(v.stale).toBe(true);
    expect(v.shouldAlert).toBe(true);
  });

  it("says nothing on a cold start with no cursor yet", () => {
    // Crying wolf on first run is how an alert gets trained into noise.
    const v = assessCursor({ updatedAt: null, alertedAt: null, now: NOW });
    expect(v.stale).toBe(false);
    expect(v.shouldAlert).toBe(false);
    expect(v.minutesSinceAdvance).toBeNull();
  });

  it("ignores an unparseable timestamp rather than alerting on it", () => {
    const v = assessCursor({ updatedAt: "not-a-date", alertedAt: null, now: NOW });
    expect(v.stale).toBe(false);
  });
});

describe("describeStall", () => {
  it("reads in hours and minutes, and names the cursor", () => {
    expect(describeStall(75, "gmail-api-inbox")).toBe(
      'Support email ingestion has not advanced in 1h 15m (cursor "gmail-api-inbox"). Mail may be arriving and not reaching the Support Inbox.',
    );
    expect(describeStall(45, "gmail-inbox")).toContain("45m");
  });
});
