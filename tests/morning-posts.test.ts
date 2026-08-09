/**
 * Morning-posts section logic: the per-set collapse (FB and IG are the same
 * creative), coverage/partial detection, the worst-state precedence that stops
 * a collapse from hiding a single-platform failure, and the
 * pills-never-contradict-the-tiles invariant.
 */
import { describe, expect, it } from "vitest";
import {
  EXPECTED_MORNING,
  STATUS_LABEL,
  buildMorningSection,
  coverageFlag,
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

/** Every expected set on both surfaces. */
function fullDay(): MorningPostRow[] {
  return EXPECTED_MORNING.flatMap((e) =>
    (["facebook", "instagram"] as const).map((platform) =>
      row({ set_key: e.setKey, routine: e.routine, platform }),
    ),
  );
}

const tileFor = (s: ReturnType<typeof buildMorningSection>, setKey: string) =>
  s.tiles.find((t) => t.setKey === setKey)!;

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
    expect(s.expected).toBe(EXPECTED_MORNING.length);
    expect(s.created).toBe(s.expected);
    expect(s.missing).toBe(0);
    expect(s.partial).toBe(0);
    for (const t of s.tiles) {
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
    // The denominator stays the roster; an extra set can't push created past it.
    expect(s.expected).toBe(EXPECTED_MORNING.length);
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
    expect(s.missing).toBe(n("missing"));
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
    expect(s.queued).toBe(EXPECTED_MORNING.length);
    expect(s.actionNeeded).toBe(0);
    expect(s.tiles.every((t) => t.action === null)).toBe(true);
  });

  it("a fully drafted morning reports every set as needing action", () => {
    const rows = fullDay().map((r) => ({ ...r, post_status: "draft" }));
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.drafts).toBe(EXPECTED_MORNING.length);
    expect(s.actionNeeded).toBe(EXPECTED_MORNING.length);
  });

  it("unqueued decks are pending, not part of the red headline", () => {
    // Only the three wall-of-text trios queued; the four decks absent.
    const rows = fullDay()
      .filter((r) => r.routine === "wall-of-text")
      .map((r) => ({ ...r, post_status: "scheduled" }));
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.queued).toBe(3);
    expect(s.pending).toBe(4);
    expect(s.actionNeeded).toBe(0); // nothing is BROKEN
    for (const t of s.tiles.filter((x) => x.routine === "text-card-decks")) {
      expect(t.severity).toBe("pending");
      expect(t.statusLabel).toBe("NOT QUEUED");
    }
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

    const before = buildMorningSection(dbRows, EXPECTED_MORNING, DATE);
    expect(before.missing).toBe(4); // what Dan was seeing

    const after = buildMorningSection(
      mergeMorningRows(dbRows, discovered),
      EXPECTED_MORNING,
      DATE,
    );
    expect(after.missing).toBe(0);
    expect(after.posted).toBe(4);
    expect(after.pending).toBe(0);
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
    expect(s.missing).toBe(EXPECTED_MORNING.length);
  });
});
