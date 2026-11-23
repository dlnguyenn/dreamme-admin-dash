/**
 * The Hooks view's logic: competitor on-screen hooks from today's live ads
 * (Outlier) and from the Foreplay archive (videos that ran 21+ days), cleaned,
 * merged and grouped by the opening pattern. Pure, so it can be tested.
 *
 * Patterns follow the vault's paid-ads guide, section 6 ("Hooks").
 */

import type { AdView } from "./logic";
import type { HookRow } from "./archive-import";

export type PatternId = "timeline" | "symptom" | "mascot" | "question" | "noplan" | "confession" | "other";

export const PATTERNS: { id: PatternId; title: string; about: string }[] = [
  { id: "timeline", title: "Day or week N, plus one small moment", about: "Starts with where she is on her GLP-1, then one specific thing that happened." },
  { id: "symptom", title: "The embarrassing symptom first", about: "Leads with a side effect people don't post about: constipation, nausea, fatigue." },
  { id: "mascot", title: "The mascot makes her do it", about: "A cartoon pet guilts her into water, protein or fiber. Only MeAgain runs these, and it's Sushi's lane." },
  { id: "question", title: "A question to her", about: "Asks about her week, her dose or what she eats." },
  { id: "noplan", title: "No plan, nobody told her", about: "She got the prescription and no guidance, so she was guessing." },
  { id: "confession", title: "A confession or a mistake", about: "She owns up to something: a wasted month, a wrong guess, a mistake to avoid." },
  { id: "other", title: "Claims and callouts", about: "Statements about tracking or the app. Generic claims rarely last." },
];

// ---------------------------------------------------------------- text

/** Emoji the hook database spelled out in brackets. Unknown ones are dropped. */
const EMOJI: Record<string, string> = {
  "crying laughing": "😂",
  "loudly crying": "😭",
  "sweat face": "😓",
  "down arrow": "👇",
  "pointing down": "👇",
  eyes: "👀",
  poop: "💩",
  toilet: "🚽",
  rewind: "⏪",
  pencil: "✏️",
  "chat bubble": "💬",
};

export interface CleanHook {
  /** The first-screen text, one entry per on-screen line. */
  lines: string[];
  /** What follows on later screens or in the speech captions, if the source recorded it. */
  later: string | null;
}

/**
 * The hook database writes on-screen line breaks as " / ", later text after
 * " → " or " + ", and emoji as "[name]". Keep the first screen as lines.
 */
export function cleanHook(raw: string): CleanHook {
  let text = raw
    .replace(/\((?:word-by-word )?speech captions\)/gi, "")
    .replace(/\[(captions|kinetic|subtitle)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  let later: string | null = null;
  // " + " joins two texts, except inside a hook like "just started GLP-1 + NO idea".
  const cut = text.search(/ → | \+ (?![A-Z]{2,}\b)/);
  if (cut > 0) {
    later = text.slice(cut + 3).replace(/ → | \+ /g, " ").trim() || null;
    text = text.slice(0, cut).trim();
  }
  const withEmoji = (s: string) =>
    s
      .replace(/\[([a-z ]+)\]/gi, (_, name: string) => EMOJI[name.toLowerCase()] ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const lines = text.split(" / ").map(withEmoji).filter(Boolean);
  return { lines: lines.length ? lines : [withEmoji(text)], later: later ? withEmoji(later.replace(/ \/ /g, " ")) || null : null };
}

/** Live ads store the hook as one string, sometimes with real line breaks. */
export function cleanLiveHook(raw: string): CleanHook {
  return { lines: raw.split(/\r?\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean), later: null };
}

/** A key that matches the same hook across brands' copies and the archive. */
export function hookKey(brand: string, lines: string[]): string {
  const norm = lines
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
  return `${brand.toLowerCase()}:${norm.slice(0, 24)}`;
}

// ---------------------------------------------------------------- patterns

const NUM = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|few)";
const MASCOT = /tamagotchi|capybara|cartoon|mascot|\bmy (little )?(glp-?1 )?pet\b|\bhe (gets|looks)\b/;
const OWNS_UP = /mistake|wasted|i wish i (knew|had)|learn from my/;
const TIMELINE = new RegExp(
  [
    "\\b(day|week|month)\\s*\\d+",
    "\\b\\d+(st|nd|rd|th) (day|week|month)",
    `(?<![$\\d])\\b${NUM}\\s+(days?|weeks?|months?|years?)\\s+(on|into|of|in)\\b`,
    "^(days|weeks|months|years) (into|of|on)\\b",
    "\\b(week|month) (one|two|three)\\b",
    "\\bfirst (glp-?1 )?(shot|week|month|day|morning)\\b",
  ].join("|"),
);
const SYMPTOM = /constipat|poop|nause|fatigu|exhausted|napping|tired|side effect|sick|bloat|headache|no appetite|zero appetite|barely (any|have an) appetite|struggling/;
const NO_PLAN = /\bno (guidance|plan|idea|instructions)\b|zero (guidance|instructions)|nobody (told|tells|warns|talks)|no one (told|tells|warns)|never (told|given)|didn'?t come with|said nothing|guess(ing|ed)?\b|\bwing\b/;
const CONFESSION = /\bi thought\b|\bi felt\b|\bi could never\b|\bi didn'?t\b|disaster|no clue|\bi was\b|\bi'?ve been\b|\bi'?d been\b|scared me|\bi made\b|\bi lost\b|\bi used to\b|\bi almost\b|\bi stopped\b|\bi ate\b|\bi started\b/;

export function hookPattern(lines: string[]): PatternId {
  const t = lines.join(" ").toLowerCase().replace(/[’']/g, "'");
  if (MASCOT.test(t)) return "mascot";
  if (OWNS_UP.test(t)) return "confession";
  if (TIMELINE.test(t)) return "timeline";
  if (SYMPTOM.test(t)) return "symptom";
  if (t.includes("?")) return "question";
  if (NO_PLAN.test(t)) return "noplan";
  if (CONFESSION.test(t)) return "confession";
  return "other";
}

export type AppMention = "named" | "this" | null;

/** Whether the first screen names the app, or teases it as "this". */
export function appMention(lines: string[]): AppMention {
  const t = lines.join(" ").toLowerCase();
  if (/shotsy|meagain|me again|glowise/.test(t)) return "named";
  if (/\bthis\b|\bfound out\b|turns out there/.test(t)) return "this";
  return null;
}

// ---------------------------------------------------------------- merge

export interface HookArchiveRow extends HookRow {
  /** The stored frame of the matched ad, when Outlier has one. */
  thumb?: string | null;
}

export interface HookItem {
  key: string;
  brand: string;
  lines: string[];
  later: string | null;
  pattern: PatternId;
  app: AppMention;
  /** Best delivery rank today among this hook's live ads. */
  liveRank: number | null;
  /** Live ads using it today. */
  liveAds: number;
  /** Longest run, live or archived. */
  days: number | null;
  /** Ads that used the creative (live copies today, or the archive's count, whichever is larger). */
  copies: number;
  inArchive: boolean;
  /** The best-ranked live ad, to open its detail. */
  ad: AdView | null;
  frame: string | null;
  /** The archive's description of the opening shot. */
  shot: string | null;
  textStyle: string | null;
  videoSeconds: number | null;
  identity: string | null;
  adLibraryUrl: string | null;
}

const BRAND: Record<string, string> = { meagain: "MeAgain", shotsy: "Shotsy", glowise: "Glowise" };
const brandName = (b: string) => BRAND[b.toLowerCase()] ?? (b ? b[0].toUpperCase() + b.slice(1) : b);
const libraryUrl = (id: string) => `https://www.facebook.com/ads/library/?id=${id}`;

/**
 * One item per hook: live ads collapse by creative, then by text, and an
 * archive hook joins the live one with the same opening.
 */
export function mergeHooks(live: AdView[], archive: HookArchiveRow[]): HookItem[] {
  const byKey = new Map<string, HookItem>();
  const ranked = [...live].filter((a) => a.hook?.trim()).sort((a, b) => (a.rank.now ?? 1e9) - (b.rank.now ?? 1e9));
  for (const a of ranked) {
    const clean = cleanLiveHook(a.hook!);
    const key = hookKey(a.brand, clean.lines);
    const cur = byKey.get(key);
    if (cur) {
      if (!cur.frame && a.thumb) cur.frame = a.thumb;
      cur.liveAds += 1;
      cur.days = Math.max(cur.days ?? 0, a.runDays ?? 0) || cur.days;
      cur.copies = Math.max(cur.copies, a.copies);
      continue;
    }
    byKey.set(key, {
      key,
      brand: a.brand,
      lines: clean.lines,
      later: null,
      pattern: hookPattern(clean.lines),
      app: appMention(clean.lines),
      liveRank: a.rank.now,
      liveAds: 1,
      days: a.runDays,
      copies: a.copies,
      inArchive: false,
      ad: a,
      frame: a.thumb,
      shot: null,
      textStyle: null,
      videoSeconds: a.videoSeconds,
      identity: a.isPartnership ? a.identity : null,
      adLibraryUrl: a.adLibraryUrl,
    });
  }
  for (const h of archive) {
    const clean = cleanHook(h.hook);
    const brand = brandName(h.brand);
    const key = hookKey(brand, clean.lines);
    const cur = byKey.get(key);
    if (cur) {
      cur.inArchive = true;
      cur.days = Math.max(cur.days ?? 0, h.max_days ?? 0) || cur.days;
      cur.copies = Math.max(cur.copies, h.ads ?? 0);
      cur.shot ??= h.visual;
      cur.textStyle ??= h.style;
      cur.later ??= clean.later;
      cur.frame ??= h.thumb ?? null;
      cur.videoSeconds ??= h.video_s;
      continue;
    }
    byKey.set(key, {
      key,
      brand,
      lines: clean.lines,
      later: clean.later,
      pattern: hookPattern(clean.lines),
      app: appMention(clean.lines),
      liveRank: null,
      liveAds: 0,
      days: h.max_days,
      copies: h.ads ?? 1,
      inArchive: true,
      ad: null,
      frame: h.thumb ?? null,
      shot: h.visual,
      textStyle: h.style,
      videoSeconds: h.video_s,
      identity: h.identity && !/ app$/i.test(h.identity) ? h.identity : null,
      adLibraryUrl: h.ad_archive_id ? libraryUrl(h.ad_archive_id) : null,
    });
  }
  return [...byKey.values()];
}

/** Ranked live hooks first (best rank), then the longest runners. */
export function sortHooks(items: HookItem[]): HookItem[] {
  return [...items].sort((a, b) => (a.liveRank ?? 1e9) - (b.liveRank ?? 1e9) || (b.days ?? 0) - (a.days ?? 0) || b.copies - a.copies);
}

export function groupHooks(items: HookItem[]): { pattern: (typeof PATTERNS)[number]; items: HookItem[] }[] {
  return PATTERNS.map((pattern) => ({ pattern, items: sortHooks(items.filter((h) => h.pattern === pattern.id)) })).filter((g) => g.items.length);
}

// ---------------------------------------------------------------- words

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "#24 today · 53 days live · 35 copies" */
export function evidence(h: HookItem): string {
  const parts = [
    h.liveRank != null ? `#${h.liveRank} today` : h.liveAds ? "Live, not ranked" : null,
    h.days != null ? `${plural(h.days, "day")} live` : null,
    h.copies > 1 ? plural(h.copies, "copy", "copies") : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export const APP_WORDS: Record<Exclude<AppMention, null>, string> = { named: "Names the app", this: "Calls the app “this”" };

/** A brief for the UGC agency from the hooks picked, plain text, no AI. */
export function hookBrief(items: HookItem[], today: string): string {
  const out = [`# Hook brief: ${plural(items.length, "competitor hook")} to adapt (${today})`, ""];
  items.forEach((h, i) => {
    const pattern = PATTERNS.find((p) => p.id === h.pattern)!;
    out.push(`## ${i + 1}. ${pattern.title}`);
    out.push(`- On screen: ${h.lines.join(" / ")}`);
    if (h.later) out.push(`- Then: ${h.later}`);
    if (h.shot) out.push(`- Opening shot: ${h.shot}`);
    if (h.textStyle) out.push(`- Text style: ${h.textStyle}`);
    out.push(`- Proof: ${h.brand}, ${evidence(h).replace(/ · /g, ", ").toLowerCase() || "no run data"}`);
    if (h.identity) out.push(`- Runs as: ${h.identity} (creator account)`);
    out.push(`- Names the app in the hook: ${h.app === "named" ? "yes" : h.app === "this" ? "no, calls it “this”" : "no"}`);
    if (h.videoSeconds) out.push(`- Their video: ${Math.round(h.videoSeconds)} s`);
    if (h.adLibraryUrl) out.push(`- Ad Library: ${h.adLibraryUrl}`);
    out.push("");
  });
  out.push(
    "## Our version",
    "- Copy the mechanism, not the words: her own GLP-1 moment in her words.",
    "- Tease DreamMe as “this” in the hook and name it later in the video.",
    "- No “was X, now Y” lines that credit the app with a physical change.",
  );
  return out.join("\n");
}
