/**
 * Morning-posts display logic — pure, no JSX, node-testable (the
 * batchDisplay.ts convention).
 *
 * The section answers one question at a glance: did this morning's routines
 * produce everything they were supposed to on the FB/IG sets? So the unit of
 * display is the EXPECTED set x platform pair, not the row: an absent pair
 * renders as a dashed "missing" tile rather than silently shrinking the grid.
 *
 * State honesty rule (the whole reason created_status exists): the Doublespeed
 * REST API reports draft posts as "scheduled", so draft-vs-scheduled can NEVER
 * be inferred from a synced status. Synced state is trusted only for terminal
 * transitions (posted / failed); otherwise we show what the routine recorded
 * at creation.
 */

export type MorningPlatform = "facebook" | "instagram";

export const MORNING_PLATFORMS: MorningPlatform[] = ["facebook", "instagram"];

export interface ExpectedSet {
  setKey: string;
  label: string;
  routine: "wall-of-text" | "text-card-decks";
}

/**
 * Which set x platform pairs the morning routines should produce daily.
 * x [facebook, instagram] = 14 expected tiles. YouTube rows are stored in
 * morning_posts too but deliberately excluded from this panel (Dan's ask was
 * the FB and IG sets); adding "youtube" to MORNING_PLATFORMS is the only
 * change needed to surface them.
 */
export const EXPECTED_MORNING: ExpectedSet[] = [
  { setKey: "hannah", label: "Hannah", routine: "wall-of-text" },
  { setKey: "olivia", label: "Olivia", routine: "wall-of-text" },
  { setKey: "mikayla", label: "Mikayla", routine: "wall-of-text" },
  { setKey: "glp1_tips", label: "GLP-1 Tips", routine: "text-card-decks" },
  { setKey: "glp1_tips_tricks", label: "Tips & Tricks", routine: "text-card-decks" },
  { setKey: "glp1hacks", label: "GLP-1 Hacks", routine: "text-card-decks" },
  { setKey: "julie_glp1", label: "Julie", routine: "text-card-decks" },
];

export type MorningTileState =
  | "posted"
  | "scheduled"
  | "draft"
  | "failed"
  | "missing"
  | "unknown";

export interface MorningPostRow {
  batch_date: string;
  routine: string;
  set_key: string;
  platform: string;
  username: string | null;
  doublespeed_post_id: string | null;
  post_kind: string;
  caption: string | null;
  sound: string | null;
  thumb_url: string | null;
  video_url: string | null;
  created_status: string;
  post_status: string | null;
  posted_at: string | null;
  public_post_url: string | null;
}

export interface MorningTile {
  setKey: string;
  setLabel: string;
  platform: MorningPlatform;
  username: string | null;
  postKind: "video" | "carousel";
  caption: string | null;
  sound: string | null;
  thumbUrl: string | null;
  videoUrl: string | null;
  publicPostUrl: string | null;
  postedAt: string | null;
  state: MorningTileState;
}

export interface MorningGroup {
  setKey: string;
  label: string;
  routine: string;
  tiles: MorningTile[];
}

export interface MorningSection {
  date: string;
  groups: MorningGroup[];
  expected: number;
  created: number;
  posted: number;
  drafts: number;
  failed: number;
  missing: number;
}

/**
 * Synced REST state is trusted only where it is trustworthy: posted and
 * failed are real transitions the API can see; "scheduled" from the API is
 * ambiguous (drafts report as scheduled) so anything non-terminal falls back
 * to the routine-recorded created_status.
 */
export function toMorningState(row: MorningPostRow): MorningTileState {
  switch ((row.post_status ?? "").toLowerCase()) {
    case "posted":
    case "succeeded":
      return "posted";
    case "failed":
    case "error":
      return "failed";
  }
  switch ((row.created_status ?? "").toLowerCase()) {
    case "draft":
      return "draft";
    case "scheduled":
      return "scheduled";
  }
  return "unknown";
}

/** Per-tile problem label, or null when the tile needs no attention. */
export function morningTileProblem(state: MorningTileState): string | null {
  switch (state) {
    case "failed":
      return "FAILED";
    case "missing":
      return "NOT CREATED";
    case "unknown":
      return "UNKNOWN";
    default:
      // draft is the EXPECTED morning state (routines create drafts for Dan
      // to promote), so it gets a neutral chip in the summary, not a red
      // per-tile flag.
      return null;
  }
}

const isMorningPlatform = (p: string): p is MorningPlatform =>
  (MORNING_PLATFORMS as string[]).includes(p);

function toTile(row: MorningPostRow, label: string): MorningTile | null {
  if (!isMorningPlatform(row.platform)) return null;
  return {
    setKey: row.set_key,
    setLabel: label,
    platform: row.platform,
    username: row.username,
    postKind: row.post_kind === "carousel" ? "carousel" : "video",
    caption: row.caption,
    sound: row.sound,
    thumbUrl: row.thumb_url,
    videoUrl: row.video_url,
    publicPostUrl: row.public_post_url,
    postedAt: row.posted_at,
    state: toMorningState(row),
  };
}

/**
 * Rows -> grouped section. Groups follow EXPECTED_MORNING order; a set that
 * posted but isn't on the expected roster is appended rather than dropped, so
 * a newly-launched account set shows up before anyone remembers to edit the
 * constant. Every expected pair with no row becomes a "missing" tile.
 */
export function buildMorningSection(
  rows: MorningPostRow[],
  expected: ExpectedSet[],
  date: string,
): MorningSection {
  const labelFor = new Map(expected.map((e) => [e.setKey, e.label]));
  const groups: MorningGroup[] = [];

  const bySet = new Map<string, MorningPostRow[]>();
  for (const r of rows) {
    if (!bySet.has(r.set_key)) bySet.set(r.set_key, []);
    bySet.get(r.set_key)!.push(r);
  }

  const buildGroup = (
    setKey: string,
    label: string,
    routine: string,
    setRows: MorningPostRow[],
    isExpected: boolean,
  ): MorningGroup => {
    const tiles: MorningTile[] = [];
    for (const platform of MORNING_PLATFORMS) {
      const row = setRows.find((r) => r.platform === platform);
      if (row) {
        const tile = toTile(row, label);
        if (tile) tiles.push(tile);
      } else if (isExpected) {
        tiles.push({
          setKey,
          setLabel: label,
          platform,
          username: null,
          postKind: "video",
          caption: null,
          sound: null,
          thumbUrl: null,
          videoUrl: null,
          publicPostUrl: null,
          postedAt: null,
          state: "missing",
        });
      }
    }
    return { setKey, label, routine, tiles };
  };

  for (const e of expected) {
    groups.push(
      buildGroup(e.setKey, e.label, e.routine, bySet.get(e.setKey) ?? [], true),
    );
  }
  for (const [setKey, setRows] of bySet) {
    if (labelFor.has(setKey)) continue;
    groups.push(
      buildGroup(setKey, setKey, setRows[0]?.routine ?? "?", setRows, false),
    );
  }

  const tiles = groups.flatMap((g) => g.tiles);
  const n = (s: MorningTileState) => tiles.filter((t) => t.state === s).length;
  return {
    date,
    groups,
    expected: expected.length * MORNING_PLATFORMS.length,
    created: tiles.filter((t) => t.state !== "missing").length,
    posted: n("posted"),
    drafts: n("draft"),
    failed: n("failed"),
    missing: n("missing"),
  };
}
