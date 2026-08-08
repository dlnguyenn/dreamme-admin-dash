/**
 * Morning-posts section logic: coverage (missing tiles for absent expected
 * pairs), state mapping (the draft-reports-as-scheduled honesty rule), and
 * the pills-never-contradict-the-tiles invariant.
 */
import { describe, expect, it } from "vitest";
import {
  EXPECTED_MORNING,
  buildMorningSection,
  morningTileProblem,
  toMorningState,
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

/** Every expected set x FB/IG pair, all present. */
function fullDay(): MorningPostRow[] {
  return EXPECTED_MORNING.flatMap((e) =>
    (["facebook", "instagram"] as const).map((platform) =>
      row({ set_key: e.setKey, routine: e.routine, platform }),
    ),
  );
}

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

describe("morningTileProblem", () => {
  it("flags only states needing attention; draft stays bare", () => {
    expect(morningTileProblem("failed")).toBe("FAILED");
    expect(morningTileProblem("missing")).toBe("NOT CREATED");
    expect(morningTileProblem("unknown")).toBe("UNKNOWN");
    expect(morningTileProblem("draft")).toBeNull();
    expect(morningTileProblem("scheduled")).toBeNull();
    expect(morningTileProblem("posted")).toBeNull();
  });
});

describe("buildMorningSection coverage", () => {
  it("a complete day has zero missing tiles and full counts", () => {
    const s = buildMorningSection(fullDay(), EXPECTED_MORNING, DATE);
    expect(s.expected).toBe(EXPECTED_MORNING.length * 2);
    expect(s.created).toBe(s.expected);
    expect(s.missing).toBe(0);
    expect(s.groups).toHaveLength(EXPECTED_MORNING.length);
  });

  it("one absent pair renders exactly one missing tile in the right group", () => {
    const rows = fullDay().filter(
      (r) => !(r.set_key === "hannah" && r.platform === "instagram"),
    );
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.missing).toBe(1);
    const hannah = s.groups.find((g) => g.setKey === "hannah")!;
    const missing = hannah.tiles.filter((t) => t.state === "missing");
    expect(missing).toHaveLength(1);
    expect(missing[0].platform).toBe("instagram");
  });

  it("a whole routine absent shows as missing tiles, not a shrunken grid", () => {
    const rows = fullDay().filter((r) => r.routine !== "text-card-decks");
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const deckSets = EXPECTED_MORNING.filter(
      (e) => e.routine === "text-card-decks",
    ).length;
    expect(s.missing).toBe(deckSets * 2);
    expect(s.groups).toHaveLength(EXPECTED_MORNING.length);
  });

  it("YouTube rows are stored input but never displayed or counted", () => {
    const rows = [...fullDay(), row({ platform: "youtube" })];
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    expect(s.created).toBe(s.expected);
    for (const g of s.groups) {
      expect(g.tiles.every((t) => t.platform !== ("youtube" as never))).toBe(true);
    }
  });

  it("an unexpected set still shows up, appended after the roster", () => {
    const rows = [...fullDay(), row({ set_key: "emma", platform: "facebook" })];
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const last = s.groups[s.groups.length - 1];
    expect(last.setKey).toBe("emma");
    // Unexpected sets get no missing synthesis — only the pair that exists.
    expect(last.tiles).toHaveLength(1);
    expect(s.created).toBe(s.expected + 1);
  });
});

describe("pills agree with tiles", () => {
  it("summary counts always equal the tile-state counts", () => {
    const rows = [
      ...fullDay().slice(0, 8),
      row({ set_key: "julie_glp1", platform: "facebook", post_status: "posted" }),
      row({ set_key: "julie_glp1", platform: "instagram", post_status: "failed" }),
    ];
    const s = buildMorningSection(rows, EXPECTED_MORNING, DATE);
    const tiles = s.groups.flatMap((g) => g.tiles);
    const n = (st: string) => tiles.filter((t) => t.state === st).length;
    expect(s.posted).toBe(n("posted"));
    expect(s.failed).toBe(n("failed"));
    expect(s.drafts).toBe(n("draft"));
    expect(s.missing).toBe(n("missing"));
    expect(s.created).toBe(tiles.length - n("missing"));
  });
});
