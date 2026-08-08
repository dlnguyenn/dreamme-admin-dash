/**
 * Morning-posts section logic: the per-set collapse (FB and IG are the same
 * creative), coverage/partial detection, the worst-state precedence that stops
 * a collapse from hiding a single-platform failure, and the
 * pills-never-contradict-the-tiles invariant.
 */
import { describe, expect, it } from "vitest";
import {
  EXPECTED_MORNING,
  buildMorningSection,
  morningTileProblem,
  toMorningState,
  worstState,
  type MorningPostRow,
} from "../src/lib/morningPosts";

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

  it("never infers draft-vs-scheduled from a synced 'scheduled'", () => {
    // REST reports drafts as "scheduled"; the routine said draft, so draft it is.
    expect(
      toMorningState(row({ post_status: "scheduled", created_status: "draft" })),
    ).toBe("draft");
    expect(
      toMorningState(row({ post_status: "scheduled", created_status: "scheduled" })),
    ).toBe("scheduled");
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

describe("morningTileProblem", () => {
  it("flags states needing attention; draft and posted stay bare", () => {
    expect(morningTileProblem("failed")).toBe("FAILED");
    expect(morningTileProblem("missing")).toBe("NOT CREATED");
    expect(morningTileProblem("unknown")).toBe("UNKNOWN");
    expect(morningTileProblem("draft")).toBeNull();
    expect(morningTileProblem("scheduled")).toBeNull();
    expect(morningTileProblem("posted")).toBeNull();
  });

  it("flags a one-surface set even when that surface is healthy", () => {
    expect(morningTileProblem("posted", "facebook")).toBe("FB ONLY");
    expect(morningTileProblem("draft", "instagram")).toBe("IG ONLY");
    // A hard problem still wins the label.
    expect(morningTileProblem("failed", "instagram")).toBe("FAILED");
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
    expect(s.failed).toBe(n("failed"));
    expect(s.drafts).toBe(n("draft"));
    expect(s.missing).toBe(n("missing"));
    expect(s.created).toBe(s.tiles.filter((t) => t.coverage !== "none").length);
    expect(s.partial).toBe(
      s.tiles.filter((t) => t.coverage === "facebook" || t.coverage === "instagram")
        .length,
    );
  });
});
