/**
 * Morning-posts section logic: the per-set collapse (FB and IG are the same
 * creative), coverage/partial detection, the worst-state precedence that stops
 * a collapse from hiding a single-platform failure, and the
 * pills-never-contradict-the-tiles invariant.
 */
import { describe, expect, it } from "vitest";
import {
  EXPECTED_MORNING,
  MORNING_ACCOUNTS,
  STATUS_LABEL,
  buildMorningSection,
  coverageFlag,
  expectedForDate,
  isDueOn,
  missingMeta,
  tileAction,
  toMorningState,
  worstState,
  type MorningPostRow,
} from "../src/lib/morningPosts";
import { mergeMorningRows } from "../src/lib/morningDiscovery";

const DATE = "2026-08-08";

function row(over: Partial<MorningPostRow>): MorningPostRow {
  return {
    batch_date: DATE,
    routine: "wall-of-text",
    set_key: "hannah",
    platform: "facebook",
    username: "hannahhglp1",
    doublespeed_post_id: "id-1",
    post_kind: "video",
    caption: "caption",
    sound: "Snatched",
    thumb_url: "https://x/thumb.jpg",
    video_url: "https://x/video.mp4",
    created_status: "draft",
    post_status: null,
    posted_at: null,
    public_post_url: null,
    ...over,
  };
}

/** The sets due on DATE, both surfaces. Not the whole roster: a rotating set
 *  on someone else's day is not part of that morning's obligation. */
const DUE = expectedForDate(DATE);

function fullDay(): MorningPostRow[] {
  return DUE.flatMap((e) =>
    (["facebook", "instagram"] as const).map((platform) =>
      row({ set_key: e.setKey, routine: e.routine, platform }),
    ),
  );
}

const tileFor = (s: ReturnType<typeof buildMorningSection>, setKey: string) =>
  s.tiles.find((t) => t.setKey === setKey)!;

/**
 * A wrong username here fails SILENTLY and daily: the account matches nothing,
 * so the tile reports the post missing and the queue button skips the draft as
 * off-roster — indistinguishable from the routine never having run. That is
 * exactly what "oliviaglp1" on Facebook did, for as long as the roster existed;
 * the post was on oliviaaglp1 the whole time.
 *
 * Every one of these was read back off a LIVE post on that account, not
 * inferred. The Facebook handle doubles a letter that Instagram's does not,
 * and there is no rule to it — check the account, don't derive it.
 */
describe("account roster", () => {
  const FACEBOOK: Record<string, string> = {
    hannah: "hannahhglp1",
    olivia: "oliviaaglp1",
    mikayla: "mikaylaaglp1",
    chris: "chrissglp1",
    mike: "mikeeglp1",
    jimmy: "jimmyglp1", // no doubling on this one
  };

  it.each(Object.entries(FACEBOOK))(
    "%s posts to Facebook as %s",
    (setKey, username) => {
      const fb = MORNING_ACCOUNTS.find(
        (a) => a.setKey === setKey && a.platform === "facebook",
      );
      expect(fb?.username).toBe(username);
    },
  );

  it("gives every set exactly one Facebook and one Instagram account", () => {
    const seen = new Map<string, Set<string>>();
    for (const a of MORNING_ACCOUNTS) {
      const platforms = seen.get(a.setKey) ?? new Set();
      expect(platforms.has(a.platform)).toBe(false); // no set posts twice to one platform
      platforms.add(a.platform);
      seen.set(a.setKey, platforms);
    }
    for (const [setKey, platforms] of seen) {
      expect(
        { setKey, platforms: [...platforms].sort() },
      ).toEqual({ setKey, platforms: ["facebook", "instagram"] });
    }
  });

  it("never maps one (username, platform) pair to two sets", () => {
    const pairs = MORNING_ACCOUNTS.map((a) => `${a.username}|${a.platform}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("carries Brittany's trailing-underscore Instagram handle", () => {
    const ig = MORNING_ACCOUNTS.find(
      (a) => a.setKey === "brittany" && a.platform === "instagram",
    );
    expect(ig?.username).toBe("brittanyglp1_");
  });

  it("gives every expected set a pair of accounts", () => {
    for (const set of EXPECTED_MORNING) {
      const mine = MORNING_ACCOUNTS.filter((a) => a.setKey === set.setKey);
      expect({ set: set.setKey, n: mine.length }).toEqual({
        set: set.setKey,
        n: 2,
      });
    }
  });
});

/**
 * The two-beat lane posts ONE persona per morning, not all three: beat B cuts
 * to a real app screenshot and only one screen exists, so a daily three-up
 * would show the same screen three times. If the dash expected all three it
 * would report two false "NOT CREATED" alerts every single day — the exact
 * failure the oliviaaglp1 typo caused.
 */
describe("two-beat rotation", () => {
  const twoBeat = EXPECTED_MORNING.filter((s) => s.routine === "two-beat");
  const dueOn = (date: string) =>
    expectedForDate(date)
      .filter((s) => s.routine === "two-beat")
      .map((s) => s.setKey);

  it("has all three personas on the roster", () => {
    expect(twoBeat.map((s) => s.setKey).sort()).toEqual([
      "angela",
      "brittany",
      "mia",
    ]);
  });

  it("expects exactly one two-beat set on any given day", () => {
    // A fortnight, so a bad modulus can't hide behind a lucky sample.
    for (let i = 0; i < 14; i++) {
      const date = new Date(Date.UTC(2026, 7, 14 + i)).toISOString().slice(0, 10);
      expect({ date, due: dueOn(date).length }).toEqual({ date, due: 1 });
    }
  });

  it("runs mia -> angela -> brittany from the anchor", () => {
    expect(dueOn("2026-08-14")).toEqual(["mia"]);
    expect(dueOn("2026-08-15")).toEqual(["angela"]);
    expect(dueOn("2026-08-16")).toEqual(["brittany"]);
    expect(dueOn("2026-08-17")).toEqual(["mia"]); // wraps
  });

  it("renders a tile for ALL THREE personas every day", () => {
    // Dan's ask: whenever a two-beat set is drafted he wants to see it here,
    // without having to remember whose turn it was. So the lane is always
    // fully visible; only the counts narrow to today.
    const s = buildMorningSection([], EXPECTED_MORNING, "2026-08-14");
    const keys = s.tiles.filter((t) => t.routine === "two-beat").map((t) => t.setKey);
    expect(keys.sort()).toEqual(["angela", "brittany", "mia"]);
  });

  it("counts only the persona whose turn it is", () => {
    const s = buildMorningSection([], EXPECTED_MORNING, "2026-08-14");
    const daily = EXPECTED_MORNING.filter((e) => !e.rotation).length;
    expect(s.expected).toBe(daily + 1); // not daily + 3
    const twoBeat = s.tiles.filter((t) => t.routine === "two-beat");
    expect(twoBeat.filter((t) => t.due).map((t) => t.setKey)).toEqual(["mia"]);
  });

  it("an off-rotation persona is silent — no alert, no action, no MISSING", () => {
    const s = buildMorningSection([], EXPECTED_MORNING, "2026-08-14");
    for (const t of s.tiles.filter((x) => x.routine === "two-beat" && !x.due)) {
      expect(t.state).toBe("missing"); // nothing was built, truthfully
      expect(t.severity).toBe("none"); // but nobody is being asked for anything
      expect(t.action).toBeNull();
      expect(t.statusLabel).toBe("NOT TODAY");
    }
    // Mia IS due and absent, so exactly one two-beat set counts as missing.
    expect(
      s.tiles.filter((t) => t.routine === "two-beat" && t.state === "missing").length,
    ).toBe(3);
    expect(s.missing).toBe(s.expected); // nothing at all was built
  });

  it("shows a real state when an off-rotation persona IS drafted", () => {
    // The whole point of keeping the tile: an early or extra build is visible
    // rather than silently absent.
    const rows = (["facebook", "instagram"] as const).map((platform) =>
      row({
        routine: "two-beat",
        set_key: "brittany",
        platform,
        post_status: "draft",
      }),
    );
    const s = buildMorningSection(rows, EXPECTED_MORNING, "2026-08-14");
    const brittany = s.tiles.find((t) => t.setKey === "brittany")!;
    expect(brittany.due).toBe(false);
    expect(brittany.state).toBe("draft");
    expect(brittany.statusLabel).toBe("DRAFT");
  });

  it("expects nothing before the lane went live", () => {
    // The lane shipped on the 13th, after that morning's run. Expecting it the
    // same day would put a red NOT CREATED on the Overview for a routine that
    // was never scheduled to have run — the false alarm this panel exists to
    // avoid.
    expect(dueOn("2026-08-13")).toEqual([]);
    expect(dueOn("2026-07-01")).toEqual([]);
  });

  it("handles dates before the anchor without a signed-modulus bug", () => {
    // JS % is signed: a naive n % cycle returns -1 here and matches nothing.
    // Guarded directly, since `from` now hides it on the real roster.
    const set = {
      setKey: "x",
      label: "X",
      routine: "two-beat" as const,
      kind: "video" as const,
      rotation: { anchor: "2026-08-14", cycle: 3, slot: 2 },
    };
    expect(isDueOn(set, "2026-08-13")).toBe(true); // -1 mod 3 === 2
    expect(isDueOn(set, "2026-08-12")).toBe(false);
  });

  it("still expects every non-rotating set daily", () => {
    const daily = EXPECTED_MORNING.filter((s) => !s.rotation).length;
    for (const date of ["2026-08-14", "2026-08-15", "2026-08-16"]) {
      expect(expectedForDate(date).length).toBe(daily + 1);
    }
  });

  it("treats a missing two-beat post as an alert, not a pending nudge", () => {
    // It runs unattended in the 05:30 task, so absent means the routine broke.
    expect(missingMeta("two-beat").severity).toBe("alert");
  });
});

describe("toMorningState", () => {
  it("trusts synced state for terminal transitions", () => {
    expect(toMorningState(row({ post_status: "posted" }))).toBe("posted");
    expect(toMorningState(row({ post_status: "succeeded" }))).toBe("posted");
    expect(toMorningState(row({ post_status: "failed" }))).toBe("failed");
    expect(toMorningState(row({ post_status: "error" }))).toBe("failed");
  });

  it("trusts the DERIVED synced state over created_status", () => {
    // post_status is now worked out from which Doublespeed filter returns the
    // post, so it beats the routine's creation-time record — that is what
    // makes promoting a draft in the Doublespeed UI show up here.
    expect(
      toMorningState(row({ post_status: "scheduled", created_status: "draft" })),
    ).toBe("scheduled");
    expect(
      toMorningState(row({ post_status: "draft", created_status: "scheduled" })),
    ).toBe("draft");
  });

  it("falls back to created_status when never synced", () => {
    expect(toMorningState(row({ post_status: null, created_status: "draft" }))).toBe(
      "draft",
    );
    expect(
      toMorningState(row({ post_status: null, created_status: "scheduled" })),
    ).toBe("scheduled");
  });

  it("reads unknown when both signals are junk", () => {
    expect(
      toMorningState(row({ post_status: "weird", created_status: "weird" })),
    ).toBe("unknown");
  });
});

describe("worstState", () => {
  it("a failure on one platform outranks success on the other", () => {
    // The load-bearing case for the whole collapse.
    expect(worstState(["posted", "failed"])).toBe("failed");
    expect(worstState(["failed", "posted"])).toBe("failed");
  });

  it("orders the in-progress states below anything needing a person", () => {
    expect(worstState(["posted", "draft"])).toBe("draft");
    expect(worstState(["scheduled", "posted"])).toBe("scheduled");
    expect(worstState(["draft", "unknown"])).toBe("unknown");
    expect(worstState(["unknown", "missing"])).toBe("missing");
  });

  it("agrees with itself when every platform matches", () => {
    expect(worstState(["posted", "posted"])).toBe("posted");
    expect(worstState(["draft", "draft"])).toBe("draft");
  });

  it("treats no platforms as missing", () => {
    expect(worstState([])).toBe("missing");
  });
});

describe("status labels and action", () => {
  it("every state has a human label, so no tile is ever unlabelled", () => {
    for (const s of ["posted", "scheduled", "draft", "failed", "missing", "unknown"] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
    }
    // The distinction Dan asked for has to be visible in the words themselves.
    expect(STATUS_LABEL.draft).toBe("DRAFT");
    expect(STATUS_LABEL.scheduled).toBe("QUEUED");
  });

  it("only queued and posted resolve themselves; everything else needs a person", () => {
    expect(tileAction("scheduled", "both").action).toBeNull();
    expect(tileAction("posted", "both").action).toBeNull();
    expect(tileAction("draft", "both").action).toMatch(/promote/i);
    expect(tileAction("missing", "both").action).toBeTruthy();
    expect(tileAction("failed", "both").action).toBeTruthy();
    expect(tileAction("unknown", "both").action).toBeTruthy();
  });

  it("a one-surface set needs action even when that surface is healthy", () => {
    expect(tileAction("posted", "facebook").action).toMatch(/Instagram/i);
    expect(tileAction("scheduled", "instagram").action).toMatch(/Facebook/i);
    // A hard problem still wins the message.
    expect(tileAction("failed", "instagram").action).toMatch(/failed/i);
  });

  it("an empty set reads differently per routine", () => {
    // The wall-of-text lane runs itself, so nothing there is a broken cron.
    const wot = tileAction("missing", "none", "wall-of-text");
    expect(wot.severity).toBe("alert");
    expect(missingMeta("wall-of-text").label).toBe("NOT CREATED");

    // Queueing decks is a manual step; unqueued at 9am is normal, not broken.
    const deck = tileAction("missing", "none", "text-card-decks");
    expect(deck.severity).toBe("pending");
    expect(deck.action).toMatch(/not queued/i);
    expect(missingMeta("text-card-decks").label).toBe("NOT QUEUED");

    // An unrecognised routine must not silently become neutral.
    expect(tileAction("missing", "none", "nonsense").severity).toBe("alert");
  });

  it("coverageFlag marks partials only", () => {
    expect(coverageFlag("facebook")).toBe("FB ONLY");
    expect(coverageFlag("instagram")).toBe("IG ONLY");
    expect(coverageFlag("both")).toBeNull();
  });
});

describe("buildMorningSection — one tile per set", () => {
  it("collapses FB+IG into a single tile per set", () => {
    const s = buildMorningSection(fullDay(), EXPECTED_MORNING, DATE);
    expect(s.tiles).toHaveLength(EXPECTED_MORNING.length);
    expect(s.expected).toBe(DUE.length);
    expect(s.created).toBe(s.expected);
    expect(s.missing).toBe(0);
    expect(s.partial).toBe(0);
    for (const t of s.tiles.filter((x) => x.due)) {
      expect(t.coverage).toBe("both");
      expect(t.platforms.map((p) => p.platform)).toEqual(["facebook", "instagram"]);
    }
  });

  it("keeps each platform's own sound and link behind the tile", () => {
    const rows = [
      row({ platform: "facebook", sound: "Snatched", public_post_url: "https://fb/1" }),
      row({ platform: "instagram", sound: "Bloom", public_post_url: null }),
    ];
    const t = tileFor(buildMorningSection(rows, EXPECTED_MORNING, DATE), "hannah");
    expect(t.platforms.map((p) => p.sound)).toEqual(["Snatched", "Bloom"]);
    expect(t.platforms[0].publicPostUrl).toBe("https://fb/1");
    expect(t.platforms[1].publicPostUrl).toBeNull();
  });

  it("a set with neither surface is a missing tile, not an absent one", () => {
    const rows = fullDay().filter((r) => r.set_key !== "julie_glp1");
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.tiles).toHaveLength(EXPECTED_MORNING.length);
    const t = tileFor(s, "julie_glp1");
    expect(t.coverage).toBe("none");
    expect(t.state).toBe("missing");
    expect(t.platforms).toHaveLength(0);
    expect(s.missing).toBe(1);
    expect(s.created).toBe(s.expected - 1);
  });

  it("a set with only one surface is partial, and still counts as created", () => {
    const rows = fullDay().filter(
      (r) => !(r.set_key === "hannah" && r.platform === "instagram"),
    );
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const t = tileFor(s, "hannah");
    expect(t.coverage).toBe("facebook");
    expect(t.platforms).toHaveLength(1);
    expect(s.partial).toBe(1);
    expect(s.missing).toBe(0);
    expect(s.created).toBe(s.expected);
  });

  it("a whole routine failing shows as missing tiles across its sets", () => {
    const rows = fullDay().filter((r) => r.routine !== "text-card-decks");
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const deckSets = EXPECTED_MORNING.filter(
      (e) => e.routine === "text-card-decks",
    ).length;
    expect(s.missing).toBe(deckSets);
    expect(s.tiles).toHaveLength(EXPECTED_MORNING.length);
  });

  it("one platform failing cannot make the tile read as posted", () => {
    const rows = [
      row({ platform: "facebook", post_status: "posted" }),
      row({ platform: "instagram", post_status: "failed" }),
    ];
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const t = tileFor(s, "hannah");
    expect(t.state).toBe("failed");
    expect(s.failed).toBe(1);
    expect(s.posted).toBe(0);
  });

  it("YouTube rows are never displayed or counted", () => {
    const rows = [...fullDay(), row({ platform: "youtube", post_status: "failed" })];
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.tiles).toHaveLength(EXPECTED_MORNING.length);
    expect(s.failed).toBe(0);
    for (const t of s.tiles) {
      expect(t.platforms.every((p) => p.platform !== ("youtube" as never))).toBe(true);
    }
    // A YouTube-only set must not conjure a tile at all.
    const ytOnly = buildMorningSection(
      [row({ set_key: "emma", platform: "youtube" })],
      EXPECTED_MORNING,
      DATE,
    );
    expect(ytOnly.tiles.some((t) => t.setKey === "emma")).toBe(false);
  });

  it("an unexpected set still shows up, appended after the roster", () => {
    const rows = [...fullDay(), row({ set_key: "emma", platform: "facebook" })];
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const last = s.tiles[s.tiles.length - 1];
    expect(last.setKey).toBe("emma");
    expect(last.coverage).toBe("facebook");
    // The denominator stays what was due; an extra set can't push created past it.
    expect(s.expected).toBe(DUE.length);
    expect(s.created).toBe(s.expected + 1);
  });

  it("takes the thumbnail from whichever surface has one", () => {
    const rows = [
      row({ platform: "facebook", thumb_url: null }),
      row({ platform: "instagram", thumb_url: "https://x/ig.jpg" }),
    ];
    const t = tileFor(buildMorningSection(rows, EXPECTED_MORNING, DATE), "hannah");
    expect(t.thumbUrl).toBe("https://x/ig.jpg");
  });
});

describe("pills agree with tiles", () => {
  it("summary counts always equal the tile-state counts", () => {
    const rows = [
      ...fullDay().filter((r) => !["glp1hacks", "julie_glp1"].includes(r.set_key)),
      row({ set_key: "glp1hacks", platform: "facebook", post_status: "posted" }),
      row({ set_key: "glp1hacks", platform: "instagram", post_status: "posted" }),
      row({ set_key: "julie_glp1", platform: "instagram", post_status: "failed" }),
    ];
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const n = (st: string) => s.tiles.filter((t) => t.state === st).length;
    expect(s.posted).toBe(n("posted"));
    expect(s.queued).toBe(n("scheduled"));
    expect(s.failed).toBe(n("failed"));
    expect(s.drafts).toBe(n("draft"));
    // MISSING is a due-only count now: an off-rotation tile is "missing" in
    // state but is not something the morning owed.
    expect(s.missing).toBe(
      s.tiles.filter((t) => t.state === "missing" && t.due).length,
    );
    expect(s.created).toBe(s.tiles.filter((t) => t.coverage !== "none").length);
    expect(s.partial).toBe(
      s.tiles.filter((t) => t.coverage === "facebook" || t.coverage === "instagram")
        .length,
    );
    expect(s.actionNeeded).toBe(s.tiles.filter((t) => t.action !== null).length);
  });

  it("a fully queued morning reports nothing to do", () => {
    const rows = fullDay().map((r) => ({ ...r, post_status: "scheduled" }));
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.queued).toBe(DUE.length);
    expect(s.actionNeeded).toBe(0);
    expect(s.tiles.every((t) => t.action === null)).toBe(true);
  });

  it("a fully drafted morning reports every set as needing action", () => {
    const rows = fullDay().map((r) => ({ ...r, post_status: "draft" }));
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.drafts).toBe(DUE.length);
    expect(s.actionNeeded).toBe(DUE.length);
  });

  it("manual lanes are pending, not part of the red headline", () => {
    // Split by what an ABSENT post means for that lane, not by routine name.
    // "everything except wall-of-text is manual" was true until the two-beat
    // lane landed, which is automated and so must alert when it doesn't run.
    const isManual = (e: { routine: string }) =>
      missingMeta(e.routine).severity === "pending";
    const queued = DUE.filter((e) => !isManual(e));
    const manual = DUE.filter(isManual);
    const rows = fullDay()
      .filter((r) => !isManual(r))
      .map((r) => ({ ...r, post_status: "scheduled" }));
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.queued).toBe(queued.length);
    expect(s.pending).toBe(manual.length);
    expect(s.actionNeeded).toBe(0); // nothing is BROKEN
    for (const t of s.tiles.filter(isManual)) {
      expect(t.severity).toBe("pending");
    }
  });

  it("an automated lane that did not run DOES hit the red headline", () => {
    // The counterpart to the test above, and the reason the split matters:
    // two-beat absent is a broken cron, not a chore Dan hasn't done yet.
    // Dated on Mia's day, since only the persona on rotation is owed.
    const MIAS_DAY = "2026-08-14";
    const rows = expectedForDate(MIAS_DAY)
      .filter((e) => e.routine !== "two-beat")
      .flatMap((e) =>
        (["facebook", "instagram"] as const).map((platform) =>
          row({
            set_key: e.setKey,
            routine: e.routine,
            platform,
            post_status: "scheduled",
          }),
        ),
      );
    const s = buildMorningSection(rows, EXPECTED_MORNING, MIAS_DAY);
    const owed = s.tiles.filter((t) => t.routine === "two-beat" && t.due);
    expect(owed.map((t) => t.setKey)).toEqual(["mia"]);
    expect(owed[0].state).toBe("missing");
    expect(owed[0].severity).toBe("alert");
    expect(s.actionNeeded).toBe(1);
  });
});

describe("merge with discovery", () => {
  const disc = (over: Partial<MorningPostRow>): MorningPostRow =>
    row({ discovered: true, created_status: "", sound: null, ...over });

  it("THE REGRESSION: discovery alone populates sets the DB never heard of", () => {
    // The real 2026-08-06/07 shape: the manifest covered the three trios, the
    // four deck sets went out and were never recorded, and the panel lied.
    const dbRows = fullDay().filter((r) => r.routine === "wall-of-text");
    const discovered = EXPECTED_MORNING.filter(
      (e) => e.routine === "text-card-decks",
    ).flatMap((e) =>
      (["facebook", "instagram"] as const).map((platform) =>
        disc({
          set_key: e.setKey,
          routine: e.routine,
          platform,
          post_status: "posted",
          post_kind: "carousel",
        }),
      ),
    );

    // Derived, not hardcoded: every set the manifest didn't cover.
    const uncovered = DUE.filter((e) => e.routine !== "wall-of-text").length;
    const before = buildMorningSection(dbRows, EXPECTED_MORNING, DATE);
    expect(before.missing).toBe(uncovered); // what Dan was seeing

    const after = buildMorningSection(
      mergeMorningRows(dbRows, discovered),
      EXPECTED_MORNING,
      DATE,
    );
    // Every deck set discovery supplied is now populated — that is the bug this
    // shipped for. Lanes discovery said nothing about (single-slide) stay
    // missing, which is correct: they genuinely had no post.
    const decks = DUE.filter((e) => e.routine === "text-card-decks").length;
    const untouched = DUE.filter(
      (e) => e.routine !== "wall-of-text" && e.routine !== "text-card-decks",
    ).length;
    expect(after.posted).toBe(decks);
    expect(after.missing).toBe(untouched);
    expect(
      after.tiles.filter((t) => t.routine === "text-card-decks" && t.state === "missing"),
    ).toHaveLength(0);
  });

  it("a DB row keeps its thumbnail, sound and caption", () => {
    const dbRows = [
      row({ thumb_url: "https://x/manifest.jpg", sound: "Snatched", caption: "db" }),
    ];
    const discovered = [
      disc({ thumb_url: "https://x/live/1", caption: "live", post_status: "posted" }),
    ];
    const merged = mergeMorningRows(dbRows, discovered);
    expect(merged).toHaveLength(1);
    expect(merged[0].thumb_url).toBe("https://x/manifest.jpg");
    expect(merged[0].sound).toBe("Snatched");
    expect(merged[0].caption).toBe("db");
  });

  it("live state overrides the stored one for the SAME post", () => {
    const dbRows = [row({ doublespeed_post_id: "p1", post_status: "draft" })];
    const discovered = [disc({ doublespeed_post_id: "p1", post_status: "posted" })];
    const merged = mergeMorningRows(dbRows, discovered);
    expect(merged[0].post_status).toBe("posted");
    // ...but only those fields.
    expect(merged[0].sound).toBe("Snatched");
  });

  it("does NOT override when the ids differ — that is a different post", () => {
    const dbRows = [row({ doublespeed_post_id: "p1", post_status: "draft" })];
    const discovered = [disc({ doublespeed_post_id: "p2", post_status: "posted" })];
    const merged = mergeMorningRows(dbRows, discovered);
    expect(merged[0].post_status).toBe("draft");
  });

  it("empty on both sides is unchanged from the all-missing grid", () => {
    const s = buildMorningSection(mergeMorningRows([], []), EXPECTED_MORNING, DATE);
    expect(s.created).toBe(0);
    expect(s.missing).toBe(DUE.length);
  });
});
