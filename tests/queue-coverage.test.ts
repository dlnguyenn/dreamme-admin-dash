import { describe, expect, it } from "vitest";
import {
  buildQueueCoverage,
  easternDayOf,
  type FleetAccount,
  type FleetPost,
} from "@/lib/queueCoverage";

const TODAY = "2026-08-05";

const acct = (
  id: string,
  username: string,
  account_type: string,
  gender: string | null = null,
  status = "good",
): FleetAccount => ({ id, username, account_type, gender, status });

/** The real shape of the fleet as of 2026-08-05: 56 accounts. */
const FLEET: FleetAccount[] = [
  ...Array.from({ length: 9 }, (_, i) => acct(`tt${i}`, `tt${i}`, "tiktok", "female")),
  ...Array.from({ length: 2 }, (_, i) => acct(`ttm${i}`, `ttm${i}`, "tiktok", "male")),
  ...Array.from({ length: 4 }, (_, i) => acct(`fbf${i}`, `fbf${i}`, "facebook", "faceless")),
  ...Array.from({ length: 4 }, (_, i) => acct(`igf${i}`, `igf${i}`, "instagram", "faceless")),
  ...Array.from({ length: 4 }, (_, i) => acct(`ytf${i}`, `ytf${i}`, "youtube", "faceless")),
  ...Array.from({ length: 8 }, (_, i) => acct(`igw${i}`, `igw${i}`, "instagram", "female")),
  ...Array.from({ length: 3 }, (_, i) => acct(`igm${i}`, `igm${i}`, "instagram", "male")),
  ...Array.from({ length: 11 }, (_, i) => acct(`fb${i}`, `fb${i}`, "facebook", null)),
  ...Array.from({ length: 11 }, (_, i) => acct(`yt${i}`, `yt${i}`, "youtube", null)),
];

const post = (
  username: string,
  status: string,
  post_time: string,
  account_type = "tiktok",
): FleetPost => ({ status, post_time, account: { username, account_type } });

describe("easternDayOf", () => {
  it("uses the Eastern calendar day, not UTC", () => {
    // 03:05Z on Aug 5 is still Aug 4 in New York.
    expect(easternDayOf("2026-08-05T03:05:00Z")).toBe("2026-08-04");
    expect(easternDayOf("2026-08-05T16:00:00Z")).toBe("2026-08-05");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(easternDayOf("not a date")).toBe(null);
  });
});

describe("buildQueueCoverage grouping", () => {
  it("partitions all 56 accounts exactly once", () => {
    const c = buildQueueCoverage(FLEET, [], TODAY);
    expect(c.totalAccounts).toBe(56);
    expect(c.groups.reduce((s, g) => s + g.total, 0)).toBe(56);
    const handles = c.groups.flatMap((g) => g.accounts.map((a) => a.handle));
    expect(new Set(handles).size).toBe(56);
  });

  it("matches the real fleet counts per group", () => {
    const c = buildQueueCoverage(FLEET, [], TODAY);
    const by = Object.fromEntries(c.groups.map((g) => [g.key, g.total]));
    expect(by).toEqual({
      "tiktok-personas": 11,
      faceless: 12,
      "instagram-personas": 11,
      facebook: 11,
      youtube: 11,
    });
  });

  it("puts a faceless account in Faceless, not in its platform bucket", () => {
    // Order matters: faceless is matched before the platform groups, so a
    // faceless Facebook account must not be counted as a plain Facebook one.
    const c = buildQueueCoverage(FLEET, [], TODAY);
    const faceless = c.groups.find((g) => g.key === "faceless")!;
    expect(faceless.accounts.map((a) => a.handle)).toContain("fbf0");
    const fb = c.groups.find((g) => g.key === "facebook")!;
    expect(fb.accounts.map((a) => a.handle)).not.toContain("fbf0");
  });

  it("excludes burned accounts — they are not a gap to fill", () => {
    const withBurned = [...FLEET, acct("burn", "burned1", "tiktok", "female", "burned")];
    const c = buildQueueCoverage(withBurned, [], TODAY);
    expect(c.totalAccounts).toBe(56);
    const handles = c.groups.flatMap((g) => g.accounts.map((a) => a.handle));
    expect(handles).not.toContain("burned1");
  });
});

describe("buildQueueCoverage coverage", () => {
  it("counts scheduled and already-posted as covered", () => {
    const posts = [
      post("tt0", "scheduled", `${TODAY}T18:00:00Z`),
      post("tt1", "posted", `${TODAY}T14:00:00Z`),
    ];
    const c = buildQueueCoverage(FLEET, posts, TODAY);
    const tt = c.groups.find((g) => g.key === "tiktok-personas")!;
    expect(tt.covered).toBe(2);
    expect(c.totalCovered).toBe(2);
  });

  it("does not count a post from another day", () => {
    const posts = [post("tt0", "scheduled", "2026-08-04T18:00:00Z")];
    expect(buildQueueCoverage(FLEET, posts, TODAY).totalCovered).toBe(0);
  });

  it("does not count a draft or failed post as covered", () => {
    // A draft is exactly the thing that still needs queueing.
    const posts = [
      post("tt0", "draft", `${TODAY}T18:00:00Z`),
      post("tt1", "failed", `${TODAY}T18:00:00Z`),
    ];
    expect(buildQueueCoverage(FLEET, posts, TODAY).totalCovered).toBe(0);
  });

  it("lists uncovered accounts first so the gap is what you read", () => {
    const posts = FLEET.filter((a) => a.account_type === "tiktok")
      .slice(0, 10)
      .map((a) => post(a.username, "scheduled", `${TODAY}T18:00:00Z`));
    const c = buildQueueCoverage(FLEET, posts, TODAY);
    const tt = c.groups.find((g) => g.key === "tiktok-personas")!;
    expect(tt.covered).toBe(10);
    expect(tt.accounts[0].covered).toBe(false);
  });

  it("ignores posts for accounts that aren't in the fleet", () => {
    const posts = [post("ghost", "scheduled", `${TODAY}T18:00:00Z`)];
    expect(buildQueueCoverage(FLEET, posts, TODAY).totalCovered).toBe(0);
  });
});
