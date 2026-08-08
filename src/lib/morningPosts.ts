/**
 * Morning-posts display logic — pure, no JSX, node-testable (the
 * batchDisplay.ts convention).
 *
 * The section answers one question at a glance: did this morning's routines
 * produce everything they were supposed to on the FB/IG sets?
 *
 * ONE TILE PER SET, not per platform. The FB and IG posts are the same
 * creative — same video, same caption — so rendering both was 14 tiles for 7
 * pieces of content. The per-platform rows are still the source of truth in
 * morning_posts; the collapse happens here at display time.
 *
 * The collapse must never hide a single-platform problem, which is what the
 * two mechanisms below are for: the tile's state is the WORST of its
 * platforms' states (worstState), and a set that produced one platform but
 * not the other is marked `coverage` != "both" so it reads as partial rather
 * than complete.
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
 * Which sets the morning routines should produce daily — 7 sets, each
 * expected on both FB and IG. YouTube rows are stored in morning_posts too
 * but deliberately excluded from this panel (Dan's ask was the FB and IG
 * sets); adding "youtube" to MORNING_PLATFORMS is the only change needed to
 * fold it into the coverage model.
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

/** Which of the two surfaces actually got a post. */
export type MorningCoverage = "both" | "facebook" | "instagram" | "none";

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

/** Per-platform detail behind a tile. Sound differs per platform (FB takes
 *  TikTok links, IG needs its own audio ids), so it belongs here. */
export interface MorningPlatformEntry {
  platform: MorningPlatform;
  username: string | null;
  state: MorningTileState;
  sound: string | null;
  videoUrl: string | null;
  publicPostUrl: string | null;
  postedAt: string | null;
}

export interface MorningTile {
  setKey: string;
  setLabel: string;
  routine: string;
  postKind: "video" | "carousel";
  /** Identical across FB/IG by construction — taken from whichever row exists. */
  caption: string | null;
  thumbUrl: string | null;
  /** The WORST state across `platforms`, so a half-broken set can't read healthy. */
  state: MorningTileState;
  platforms: MorningPlatformEntry[];
  coverage: MorningCoverage;
  /** What Dan has to do about it, or null when it resolves itself. */
  action: string | null;
}

export interface MorningSection {
  date: string;
  tiles: MorningTile[];
  /** Expected SETS (7), not posts. */
  expected: number;
  created: number;
  posted: number;
  /** Genuinely queued in Doublespeed — will publish without anyone. */
  queued: number;
  drafts: number;
  failed: number;
  missing: number;
  /** Sets that produced one platform but not the other. */
  partial: number;
  /** Tiles with a non-null action. The headline number. */
  actionNeeded: number;
}

/**
 * post_status is now the DERIVED live state written by
 * batchState.syncMorningPostState — draft / scheduled / posted, worked out
 * from which Doublespeed status FILTER returns the post rather than from the
 * post's own `status` field (which reports "scheduled" for drafts too).
 *
 * So it is trusted outright, including for draft-vs-scheduled. That is the
 * whole point: it tracks Dan promoting a draft in the Doublespeed UI, which
 * the routine-recorded created_status can never see. created_status is only
 * the fallback for a row that has never synced.
 */
export function toMorningState(row: MorningPostRow): MorningTileState {
  switch ((row.post_status ?? "").toLowerCase()) {
    case "posted":
    case "succeeded":
      return "posted";
    case "failed":
    case "error":
      return "failed";
    case "draft":
      return "draft";
    case "scheduled":
    case "pending":
    case "queued":
      return "scheduled";
  }
  switch ((row.created_status ?? "").toLowerCase()) {
    case "draft":
      return "draft";
    case "scheduled":
      return "scheduled";
  }
  return "unknown";
}

/**
 * Does this tile need Dan to do something, and what?
 *
 * The question the panel exists to answer. `scheduled` and `posted` are the
 * only states that resolve themselves; everything else is waiting on a person.
 */
export function tileAction(
  state: MorningTileState,
  coverage: MorningCoverage,
): string | null {
  switch (state) {
    case "missing":
      return "Routine did not create this";
    case "failed":
      return "Post failed, needs a retry";
    case "draft":
      return "Sitting in draft, promote it to queue";
    case "unknown":
      return "State unknown, check it in Doublespeed";
  }
  if (coverage === "facebook") return "No Instagram post for this set";
  if (coverage === "instagram") return "No Facebook post for this set";
  return null;
}

/**
 * Severity order for collapsing several platforms into one tile. Anything
 * needing a person outranks anything that is merely in progress, and posted
 * — the only truly finished state — ranks lowest so it can never mask a
 * sibling failure.
 */
const SEVERITY: Record<MorningTileState, number> = {
  failed: 5,
  missing: 4,
  unknown: 3,
  draft: 2,
  scheduled: 1,
  posted: 0,
};

export function worstState(states: MorningTileState[]): MorningTileState {
  if (states.length === 0) return "missing";
  return states.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
}

/**
 * The status badge every tile carries. Dan's ask: he must be able to tell at a
 * glance whether a post is drafted, queued or already out — so unlike the
 * earlier design, healthy tiles are labelled too rather than left bare.
 */
export const STATUS_LABEL: Record<MorningTileState, string> = {
  posted: "POSTED",
  scheduled: "QUEUED",
  draft: "DRAFT",
  failed: "FAILED",
  missing: "NOT CREATED",
  unknown: "UNKNOWN",
};

/** Extra red flag for a set that only made one surface. */
export function coverageFlag(coverage: MorningCoverage): string | null {
  if (coverage === "facebook") return "FB ONLY";
  if (coverage === "instagram") return "IG ONLY";
  return null;
}

const isMorningPlatform = (p: string): p is MorningPlatform =>
  (MORNING_PLATFORMS as string[]).includes(p);

function coverageOf(present: MorningPlatform[]): MorningCoverage {
  if (present.length === 0) return "none";
  if (present.length >= MORNING_PLATFORMS.length) return "both";
  return present[0];
}

function buildTile(
  setKey: string,
  label: string,
  routine: string,
  setRows: MorningPostRow[],
): MorningTile {
  const platforms: MorningPlatformEntry[] = [];
  for (const platform of MORNING_PLATFORMS) {
    const row = setRows.find((r) => r.platform === platform);
    if (!row) continue;
    platforms.push({
      platform,
      username: row.username,
      state: toMorningState(row),
      sound: row.sound,
      videoUrl: row.video_url,
      publicPostUrl: row.public_post_url,
      postedAt: row.posted_at,
    });
  }

  // Thumb/caption/kind are the same creative on both surfaces; take the first
  // row that actually carries them rather than assuming FB exists.
  const withThumb = setRows.find((r) => isMorningPlatform(r.platform) && r.thumb_url);
  const any = setRows.find((r) => isMorningPlatform(r.platform));
  const coverage = coverageOf(platforms.map((p) => p.platform));
  const state: MorningTileState =
    coverage === "none" ? "missing" : worstState(platforms.map((p) => p.state));

  return {
    setKey,
    setLabel: label,
    routine,
    postKind: any?.post_kind === "carousel" ? "carousel" : "video",
    caption: any?.caption ?? null,
    thumbUrl: withThumb?.thumb_url ?? null,
    state,
    platforms,
    coverage,
    action: tileAction(state, coverage),
  };
}

/**
 * Rows -> one tile per set. Tiles follow EXPECTED_MORNING order; a set that
 * posted but isn't on the expected roster is appended rather than dropped, so
 * a newly-launched account set shows up before anyone remembers to edit the
 * constant. An expected set with no rows at all becomes a "missing" tile —
 * rendered as a dashed placeholder, because a routine that didn't run has to
 * be visible rather than shrinking the grid.
 */
export function buildMorningSection(
  rows: MorningPostRow[],
  expected: ExpectedSet[],
  date: string,
): MorningSection {
  const expectedKeys = new Set(expected.map((e) => e.setKey));
  const bySet = new Map<string, MorningPostRow[]>();
  for (const r of rows) {
    if (!isMorningPlatform(r.platform)) continue;
    if (!bySet.has(r.set_key)) bySet.set(r.set_key, []);
    bySet.get(r.set_key)!.push(r);
  }

  const tiles: MorningTile[] = expected.map((e) =>
    buildTile(e.setKey, e.label, e.routine, bySet.get(e.setKey) ?? []),
  );
  for (const [setKey, setRows] of bySet) {
    if (expectedKeys.has(setKey)) continue;
    tiles.push(
      buildTile(setKey, setKey, setRows[0]?.routine ?? "?", setRows),
    );
  }

  const n = (s: MorningTileState) => tiles.filter((t) => t.state === s).length;
  return {
    date,
    tiles,
    expected: expected.length,
    created: tiles.filter((t) => t.coverage !== "none").length,
    posted: n("posted"),
    queued: n("scheduled"),
    drafts: n("draft"),
    failed: n("failed"),
    missing: n("missing"),
    partial: tiles.filter(
      (t) => t.coverage === "facebook" || t.coverage === "instagram",
    ).length,
    actionNeeded: tiles.filter((t) => t.action !== null).length,
  };
}
