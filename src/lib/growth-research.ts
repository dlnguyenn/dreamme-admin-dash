/**
 * Deep Research mode — recreates the Lightreel viral-content research
 * process as a resumable, client-stepped pipeline:
 *
 *   planning     Sonnet turns the question into adjacent categories +
 *                consumer-language seed searches (viewer phrasing, not
 *                marketer terms).
 *   seeding      Run the seed searches on TikTok (Apify searchQueries
 *                mode), keep ≥20k-view candidates.
 *   expanding    Haiku mines round-1 captions for recurring native
 *                phrases → a second round of searches → merge + dedupe,
 *                then build the inspection shortlist (view-ranked,
 *                author-diverse).
 *   inspecting   Per candidate: creator-baseline outlier score
 *                (spy-outlier) + Gemini actually WATCHES the video and
 *                codes it (app visibility 0-3, hook transcript, would it
 *                work without the app). Strong finds land in the Inspo
 *                feed (viral_app_posts, source='search').
 *   synthesizing Sonnet writes the Lightreel-style memo: format clusters
 *                with verdicts, copy/avoid, repeatable series for DreamMe.
 *
 * Every phase is one bounded chunk executed by stepResearchRun(runId);
 * state persists to growth_research_runs.phase_state between calls, so
 * a run survives route timeouts, reloads, and mid-flight interruptions —
 * the client just keeps calling /api/growth/research/step.
 */
import {
  runSearchQueryScrape,
  runSearchQueryScrapeCheap,
  runProfileScrape,
  runProfileScrapeCheap,
  runPostScrape,
  apifySpyConfigured,
} from "@/lib/apify-spy";
import { parseApifyItems, type ApifyTikTokItem } from "@/lib/schemas/apify";
import {
  computeBaselineMedian,
  computeOutlierScore,
  OUTLIER_NOTABLE_THRESHOLD,
} from "@/lib/spy-outlier";
import { analyzeVideo, geminiConfigured } from "@/lib/gemini";
import { fetchToStorage } from "@/lib/storage";
import { structuredCall } from "@/lib/growth-tools";
import { MODELS } from "@/lib/models";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const HAIKU = "claude-haiku-4-5-20251001";
/** Research floor is looser than the Inspo feed's 50k — a 30k video from a
 *  2k-median account is exactly the signal Lightreel keys on. */
export const RESEARCH_FLOOR = 20_000;
const SEED_RESULTS_PER_QUERY = 25;
const SEARCH_CONCURRENCY = 3;
export const SHORTLIST_MAX = 14;
export const MAX_PER_AUTHOR = 2;
/** Candidates fully inspected per step call — each needs 2 Apify runs +
 *  1 Gemini watch (~90-120s chained), pooled 3-wide to stay well inside
 *  the 300s route budget. */
const INSPECT_PER_STEP = 3;
const BASELINE_RESULTS = 10;

const FORMATS = ["talking_head", "screen_recording", "meme", "skit", "text_overlay", "slideshow", "other"] as const;
const HOOK_TYPES = ["question", "confession", "stat", "demo", "pov", "story", "other"] as const;

// --- types -------------------------------------------------------------------

export type ResearchStatus =
  | "planning"
  | "seeding"
  | "expanding"
  | "inspecting"
  | "synthesizing"
  | "done"
  | "failed";

export interface VideoCoding {
  app_visibility: 0 | 1 | 2 | 3;
  app_name: string;
  app_category: string;
  hook_transcript: string;
  structure: string;
  works_without_app: boolean;
  format: string;
  hook_type: string;
  why_it_hit: string;
  score: number; // 1-5 Lightreel-style overall
}

export interface ResearchCandidate {
  url: string;
  post_id: string | null;
  author: string;
  views: number;
  likes: number;
  comments: number;
  caption: string;
  cover_url: string | null;
  posted_at: string | null;
  found_via: string;
  // filled during inspect:
  baseline_median?: number | null;
  outlier_score?: number | null;
  coding?: VideoCoding | null;
  /** "prior" = coding reused from a past run's corpus — cost-free. */
  coded_from?: "video" | "cover" | "prior" | "none";
  /** Why the video path fell back to cover-frame coding (diagnostic). */
  video_error?: string;
  strong?: boolean;
  inspect_error?: string;
}

export interface SearchLogEntry {
  query: string;
  round: 1 | 2;
  fetched: number;
  kept: number;
  /** Which source served this query — the cheap actor, the clockworks
   *  fallback, or our own already-paid-for video database. */
  via?: "cheap" | "clockworks" | "database";
  error?: string;
}

export interface PhaseState {
  categories?: string[];
  seed_queries?: string[];
  strong_criteria?: string;
  expansion_queries?: string[];
  candidates?: ResearchCandidate[];
  shortlist?: string[]; // candidate urls picked for inspection
  inspect_cursor?: number;
  searches?: SearchLogEntry[];
  /** Follow-up research questions the memo suggests (rendered as chips). */
  follow_ups?: string[];
}

export interface ResearchRun {
  id: string;
  question: string;
  status: ResearchStatus;
  phase_state: PhaseState;
  report_md: string | null;
  model: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// --- supabase helpers ----------------------------------------------------------

async function sbSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("Supabase not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase read failed (${path.split("?")[0]}): ${res.status}`);
  return (await res.json()) as T[];
}

async function sbWrite(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<unknown[]> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("service role not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST"
          ? "resolution=merge-duplicates,return=representation"
          : "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${path.split("?")[0]}): ${res.status} ${await res.text()}`);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// --- pure helpers (unit-tested) --------------------------------------------------

/** Merge new candidates into the existing list, deduping by url (first
 *  sighting wins so found_via stays honest about which query surfaced it). */
export function mergeCandidates(
  existing: ResearchCandidate[],
  incoming: ResearchCandidate[],
): ResearchCandidate[] {
  const byUrl = new Map(existing.map((c) => [c.url, c]));
  for (const c of incoming) {
    if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  return [...byUrl.values()];
}

/** View-ranked shortlist with author diversity (max 2 per creator) so one
 *  prolific account can't eat the whole inspection budget. */
export function buildShortlist(
  candidates: ResearchCandidate[],
  max: number = SHORTLIST_MAX,
  maxPerAuthor: number = MAX_PER_AUTHOR,
): string[] {
  const sorted = [...candidates].sort((a, b) => b.views - a.views);
  const perAuthor = new Map<string, number>();
  const out: string[] = [];
  for (const c of sorted) {
    if (out.length >= max) break;
    const key = c.author.toLowerCase() || c.url;
    const n = perAuthor.get(key) ?? 0;
    if (n >= maxPerAuthor) continue;
    perAuthor.set(key, n + 1);
    out.push(c.url);
  }
  return out;
}

/** Lightreel's keep rule: proof the app matters (visibility ≥2) OR the
 *  post is a genuine outlier for its creator (≥3× their median). */
export function isStrongFind(c: {
  coding?: { app_visibility: number } | null;
  outlier_score?: number | null;
}): boolean {
  if ((c.coding?.app_visibility ?? 0) >= 2) return true;
  return (c.outlier_score ?? 0) >= OUTLIER_NOTABLE_THRESHOLD;
}

/** Tolerant JSON extraction for Gemini text output (strips code fences,
 *  grabs the outermost object). Throws when no object is found. */
export function parseJsonLoose(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

export function validateCoding(v: unknown): VideoCoding {
  const o = v as Record<string, unknown>;
  const vis = Math.max(0, Math.min(3, Math.round(Number(o.app_visibility) || 0))) as 0 | 1 | 2 | 3;
  const fmt = (FORMATS as readonly string[]).includes(String(o.format)) ? String(o.format) : "other";
  const hook = (HOOK_TYPES as readonly string[]).includes(String(o.hook_type)) ? String(o.hook_type) : "other";
  return {
    app_visibility: vis,
    app_name: String(o.app_name ?? "").slice(0, 80),
    app_category: String(o.app_category ?? "other").slice(0, 40),
    hook_transcript: String(o.hook_transcript ?? "").slice(0, 300),
    structure: String(o.structure ?? "").slice(0, 500),
    works_without_app: o.works_without_app === true,
    format: fmt,
    hook_type: hook,
    why_it_hit: String(o.why_it_hit ?? "").slice(0, 500),
    score: Math.max(1, Math.min(5, Math.round(Number(o.score) || 1))),
  };
}

// --- video database (reuse what we already paid for) ------------------------------
//
// Lightreel's core cost move: search an internal corpus of already-analyzed
// videos BEFORE (and alongside) paid scrapes, and never watch the same video
// twice. Our corpus is (a) viral_app_posts — every post the Inspo pipeline or
// a past research run enriched — and (b) coded candidates inside past
// growth_research_runs.phase_state.

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "about", "what",
  "look", "find", "search", "viral", "video", "videos", "content", "tiktok",
  "app", "apps", "b2c", "niche", "their", "them", "then", "than", "have",
  "some", "more", "most", "very", "just", "like", "over", "under",
]);

/** Meaningful lowercase keywords from a research question (for ilike matching
 *  against the local corpus). */
export function extractTerms(question: string, cap = 8): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, cap);
}

/** Search viral_app_posts for candidates matching the question's terms —
 *  zero marginal cost, these were paid for by past scrapes/runs. */
async function searchLocalPosts(terms: string[], floor: number): Promise<ResearchCandidate[]> {
  if (!terms.length) return [];
  const out: ResearchCandidate[] = [];
  for (const term of terms.slice(0, 5)) {
    try {
      const enc = encodeURIComponent(`*${term}*`);
      const rows = await sbSelect<Record<string, unknown>>(
        `viral_app_posts?select=post_url,post_id,author_handle,view_count,like_count,comment_count,caption,thumbnail_url,posted_at,hook_text,app_name` +
          `&or=(caption.ilike.${enc},hook_text.ilike.${enc},app_name.ilike.${enc},why_it_hit.ilike.${enc})` +
          `&view_count=gte.${floor}&platform=eq.tiktok&order=view_count.desc&limit=15`,
      );
      for (const r of rows) {
        out.push({
          url: String(r.post_url),
          post_id: r.post_id != null ? String(r.post_id) : null,
          author: String(r.author_handle ?? ""),
          views: Number(r.view_count) || 0,
          likes: Number(r.like_count) || 0,
          comments: Number(r.comment_count) || 0,
          caption: String(r.caption ?? "").slice(0, 800),
          cover_url: (r.thumbnail_url as string | null) ?? null,
          posted_at: (r.posted_at as string | null) ?? null,
          found_via: `video_database:"${term}"`,
        });
      }
    } catch {
      // corpus search is best-effort — a miss never blocks the run
    }
  }
  return out;
}

export interface PriorCodings {
  byUrl: Map<string, { coding: VideoCoding; baseline_median: number | null }>;
  baselineByAuthor: Map<string, number | null>;
}

/** Codings + creator baselines from recent runs, so a video is never watched
 *  twice and a known creator's baseline is never re-scraped. */
async function fetchPriorCodings(excludeRunId: string): Promise<PriorCodings> {
  const byUrl = new Map<string, { coding: VideoCoding; baseline_median: number | null }>();
  const baselineByAuthor = new Map<string, number | null>();
  try {
    const runs = await sbSelect<{ id: string; phase_state: PhaseState }>(
      `growth_research_runs?select=id,phase_state&order=created_at.desc&limit=15`,
    );
    for (const run of runs) {
      if (run.id === excludeRunId) continue;
      for (const c of run.phase_state?.candidates ?? []) {
        if (c.coding && (c.coded_from === "video" || c.coded_from === "cover") && !byUrl.has(c.url)) {
          byUrl.set(c.url, { coding: c.coding, baseline_median: c.baseline_median ?? null });
        }
        if (c.author && c.baseline_median != null && !baselineByAuthor.has(c.author.toLowerCase())) {
          baselineByAuthor.set(c.author.toLowerCase(), c.baseline_median);
        }
      }
    }
  } catch {
    // best-effort
  }
  return { byUrl, baselineByAuthor };
}

/** Copy prior codings onto matching candidates (pure — unit-tested). Returns
 *  how many candidates were satisfied from the corpus. */
export function applyPriorCodings(
  candidates: ResearchCandidate[],
  byUrl: PriorCodings["byUrl"],
): number {
  let reused = 0;
  for (const c of candidates) {
    if (c.coding) continue;
    const prior = byUrl.get(c.url);
    if (!prior) continue;
    c.coding = prior.coding;
    c.coded_from = "prior";
    if (c.baseline_median == null && prior.baseline_median != null) {
      c.baseline_median = prior.baseline_median;
      c.outlier_score = computeOutlierScore(c.views, prior.baseline_median);
    }
    reused++;
  }
  return reused;
}

// --- candidate collection --------------------------------------------------------

function tiktokVideoUrl(item: ApifyTikTokItem): string | null {
  const rec = item as Record<string, unknown>;
  const media = rec.mediaUrls;
  if (Array.isArray(media) && typeof media[0] === "string" && media[0]) {
    return media[0];
  }
  const vm = rec.videoMeta as Record<string, unknown> | undefined;
  const dl = vm?.downloadAddr;
  return typeof dl === "string" && dl ? dl : null;
}

function toCandidate(item: ApifyTikTokItem, query: string): ResearchCandidate | null {
  if (!item.webVideoUrl) return null;
  return {
    url: item.webVideoUrl,
    post_id: item.id ?? null,
    author: item.authorMeta?.name ?? "",
    views: item.playCount ?? 0,
    likes: item.diggCount ?? 0,
    comments: item.commentCount ?? 0,
    caption: (item.text ?? "").slice(0, 800),
    cover_url:
      item.videoMeta?.originalCoverUrl ?? item.videoMeta?.coverUrl ?? null,
    posted_at: item.createTimeISO ?? null,
    found_via: query,
  };
}

/** Normalizer for the cheap search actor (paul_44/tiktok-search). Its shape
 *  differs from clockworks: caption is `title`, author under `channel`,
 *  `uploadedAt` is unix seconds, cover under `thumbnail`/`coverImage`. */
export function fromCheapSearchItem(raw: unknown, query: string): ResearchCandidate | null {
  const o = raw as Record<string, unknown>;
  const ch = (o.channel ?? {}) as Record<string, unknown>;
  const url = String(o.url ?? o.postPage ?? o.tiktokUrl ?? "");
  if (!url) return null;
  const uploadedAt = Number(o.uploadedAt);
  return {
    url,
    post_id: o.id != null ? String(o.id) : null,
    author: String(ch.username ?? ""),
    views: Number(o.views) || 0,
    likes: Number(o.likes) || 0,
    comments: Number(o.comments) || 0,
    caption: String(o.title ?? "").slice(0, 800),
    cover_url:
      (typeof o.thumbnail === "string" && o.thumbnail) ||
      (typeof o.coverImage === "string" && o.coverImage) ||
      (typeof o.thumbnailCdn === "string" && o.thumbnailCdn) ||
      null,
    posted_at: Number.isFinite(uploadedAt) && uploadedAt > 0
      ? new Date(uploadedAt * 1000).toISOString()
      : null,
    found_via: query,
  };
}

/** One query: try the cheap actor (server-side view floor), fall back to
 *  clockworks (MOST_LIKED sort) on any error/empty. Returns kept candidates
 *  plus which path served it. */
async function searchOneQuery(query: string): Promise<{
  candidates: ResearchCandidate[];
  fetched: number;
  via: "cheap" | "clockworks";
  error?: string;
}> {
  // cheap path first
  try {
    const raw = await runSearchQueryScrapeCheap({
      query,
      maxItems: SEED_RESULTS_PER_QUERY,
      minPlayCount: RESEARCH_FLOOR,
    });
    if (raw.length > 0) {
      const candidates = raw
        .map((r) => fromCheapSearchItem(r, query))
        .filter((c): c is ResearchCandidate => !!c && c.views >= RESEARCH_FLOOR);
      return { candidates, fetched: raw.length, via: "cheap" };
    }
  } catch {
    // fall through to clockworks
  }
  // clockworks fallback
  const raw = await runSearchQueryScrape({
    query,
    resultsPerPage: SEED_RESULTS_PER_QUERY,
    sortByLikes: true,
  });
  const { items } = parseApifyItems(raw);
  const candidates = items
    .map((item) => toCandidate(item, query))
    .filter((c): c is ResearchCandidate => !!c && c.views >= RESEARCH_FLOOR);
  return { candidates, fetched: items.length, via: "clockworks" };
}

async function runSearches(
  queries: string[],
  round: 1 | 2,
  state: PhaseState,
): Promise<void> {
  const found: ResearchCandidate[] = [];
  const log: SearchLogEntry[] = state.searches ?? [];
  await pool(queries, SEARCH_CONCURRENCY, async (query) => {
    const entry: SearchLogEntry = { query, round, fetched: 0, kept: 0 };
    try {
      const { candidates, fetched, via } = await searchOneQuery(query);
      entry.via = via;
      entry.fetched = fetched;
      for (const c of candidates) {
        found.push(c);
        entry.kept++;
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    log.push(entry);
  });
  state.searches = log;
  state.candidates = mergeCandidates(state.candidates ?? [], found);
}

// --- LLM passes -------------------------------------------------------------------

interface ResearchPlan {
  categories: string[];
  seed_queries: string[];
  strong_criteria: string;
}

async function planPhase(question: string): Promise<ResearchPlan> {
  const { value } = await structuredCall<ResearchPlan>({
    model: MODELS.SONNET_4_6,
    system:
      "You are a viral-content research planner for the growth team of DreamMe — a consumer iOS app: a GLP-1 companion + self-care Tamagotchi (medication/shot logging, protein & fiber tracking, food scanning, weight journey, virtual pet). Skew adjacent categories toward veins DreamMe could credibly own. " +
      "You turn a research question into TikTok search queries the way a smart human researcher would: " +
      "seed from ADJACENT content categories, not just the literal topic (a food-scanner question also lives in grocery hauls, ingredient exposés, allergy content, symptom talk); " +
      "and phrase every query in NATIVE VIEWER LANGUAGE — what a normal person types or says ('foods that scored 100 at aldi', 'what I eat in a day scanning everything'), never marketer terms like 'app promo video'.",
    user:
      `Research question: "${question}"\n\n` +
      "Emit the research plan: 3-5 adjacent content categories worth sweeping, 6-8 seed search queries in native viewer language (mix the literal topic with the adjacent categories), and a one-sentence statement of what will count as a STRONG find for this question.",
    toolName: "emit_research_plan",
    toolDescription: "Emit the research plan.",
    schema: {
      type: "object",
      properties: {
        categories: { type: "array", items: { type: "string" }, description: "3-5 adjacent content categories." },
        seed_queries: { type: "array", items: { type: "string" }, description: "6-8 TikTok search queries in native viewer language." },
        strong_criteria: { type: "string", description: "One sentence: what counts as a strong find." },
      },
      required: ["categories", "seed_queries", "strong_criteria"],
    },
    validate: (v) => {
      const o = v as Record<string, unknown>;
      const arr = (x: unknown, cap: number) =>
        (Array.isArray(x) ? x : []).map((s) => String(s).slice(0, 120)).filter(Boolean).slice(0, cap);
      const seeds = arr(o.seed_queries, 8);
      if (seeds.length < 3) throw new Error("plan needs at least 3 seed queries");
      return {
        categories: arr(o.categories, 5),
        seed_queries: seeds,
        strong_criteria: String(o.strong_criteria ?? "").slice(0, 300),
      };
    },
    maxTokens: 900,
  });
  return value;
}

async function expansionQueries(
  question: string,
  candidates: ResearchCandidate[],
): Promise<string[]> {
  const sample = [...candidates]
    .sort((a, b) => b.views - a.views)
    .slice(0, 30)
    .map((c) => `- [${c.views} views] ${c.caption.slice(0, 150) || "(no caption)"}`)
    .join("\n");
  const { value } = await structuredCall<{ queries: string[] }>({
    model: HAIKU,
    system:
      "You mine viral-video captions for the RECURRING NATIVE PHRASES real viewers use, then turn them into fresh TikTok search queries. Extract the language patterns that keep appearing (specific phrasings, formats like 'X that scored 100', named stores/brands), not generic topic words.",
    user:
      `Research question: "${question}"\n\nRound-1 viral captions:\n${sample || "(round 1 found nothing — derive queries from the question alone)"}\n\nEmit 4-6 NEW search queries built from the recurring native phrases. No duplicates of obvious round-1 phrasing.`,
    toolName: "emit_expansion_queries",
    toolDescription: "Emit round-2 search queries.",
    schema: {
      type: "object",
      properties: {
        queries: { type: "array", items: { type: "string" }, description: "4-6 new search queries." },
      },
      required: ["queries"],
    },
    validate: (v) => {
      const o = v as Record<string, unknown>;
      const qs = (Array.isArray(o.queries) ? o.queries : [])
        .map((s) => String(s).slice(0, 120))
        .filter(Boolean)
        .slice(0, 6);
      return { queries: qs };
    },
    maxTokens: 500,
  });
  return value.queries;
}

const RUBRIC_PROMPT = `You are coding a TikTok video for an app-marketing research study. Watch the video, then reply with ONLY a JSON object (no prose, no code fences) with these keys:
- app_visibility: 0-3 integer. 0 = no app appears at all. 1 = logo or name-drop only. 2 = app screenshot/screen shown as proof. 3 = the app's UI appears at the decision moment — the video's payoff depends on it.
- app_name: the app shown or named ("" if none).
- app_category: short category like health_fitness, glp1, wellness, food, productivity, finance, other.
- hook_transcript: what is said/shown in the FIRST 2 SECONDS, verbatim.
- structure: the video's beats in one or two sentences (hook → build → payoff).
- works_without_app: true if the video would be just as compelling with the app removed (bad sign for replication), false if the app is load-bearing.
- format: one of talking_head, screen_recording, meme, skit, text_overlay, slideshow, other.
- hook_type: one of question, confession, stat, demo, pov, story, other.
- why_it_hit: 1-2 sentences on the persuasion mechanic that made this go viral.
- score: 1-5 overall replication value for a consumer health app (5 = proven repeatable format with the app load-bearing).`;

// --- inspect helpers ----------------------------------------------------------------

async function codeFromCover(c: ResearchCandidate): Promise<VideoCoding> {
  if (!c.cover_url) throw new Error("no cover to fall back to");
  const res = await fetch(c.cover_url);
  if (!res.ok) throw new Error(`cover fetch failed: ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  const { value } = await structuredCall<VideoCoding>({
    model: HAIKU,
    system:
      "You are coding a TikTok video for an app-marketing research study, but you can only see the COVER FRAME and caption (the video file was unavailable). Code conservatively: app_visibility only what the frame proves; hook_transcript = the on-screen overlay text.",
    user: [
      { type: "image", source: { type: "base64", media_type: mime, data } },
      {
        type: "text",
        text: `Caption: ${c.caption || "(none)"}\nViews: ${c.views}\n\nEmit the coding via emit_video_coding.`,
      },
    ],
    toolName: "emit_video_coding",
    toolDescription: "Emit the video coding.",
    schema: {
      type: "object",
      properties: {
        app_visibility: { type: "number" },
        app_name: { type: "string" },
        app_category: { type: "string" },
        hook_transcript: { type: "string" },
        structure: { type: "string" },
        works_without_app: { type: "boolean" },
        format: { type: "string", enum: [...FORMATS] },
        hook_type: { type: "string", enum: [...HOOK_TYPES] },
        why_it_hit: { type: "string" },
        score: { type: "number" },
      },
      required: ["app_visibility", "app_name", "app_category", "hook_transcript", "structure", "works_without_app", "format", "hook_type", "why_it_hit", "score"],
    },
    validate: validateCoding,
    maxTokens: 600,
  });
  return value;
}

/** Baseline view-count list for a creator. Cheap actor (novi) first; on
 *  error/empty fall back to clockworks. Excludes the candidate's own post so
 *  a viral outlier can't inflate its own baseline. */
async function fetchBaselineViews(profile: string, ownPostId: string | null): Promise<number[]> {
  // cheap path (novi/tiktok-user-api)
  try {
    const raw = await runProfileScrapeCheap({ profile, limit: BASELINE_RESULTS });
    if (raw.length > 0) {
      const views = raw
        .map((r) => r as Record<string, unknown>)
        .filter((r) => String(r.aweme_id ?? "") !== (ownPostId ?? "\0"))
        .map((r) => Number((r.statistics as Record<string, unknown> | undefined)?.play_count) || 0)
        .filter((v) => v > 0);
      if (views.length > 0) return views;
    }
  } catch {
    // fall through to clockworks
  }
  // clockworks fallback
  const raw = await runProfileScrape({ profile, resultsPerPage: BASELINE_RESULTS });
  const { items } = parseApifyItems(raw);
  return items
    .filter((i) => i.id !== ownPostId)
    .map((i) => i.playCount ?? 0)
    .filter((v) => v > 0);
}

async function inspectCandidate(
  c: ResearchCandidate,
  runId: string,
  baselineCache?: Map<string, number | null>,
): Promise<void> {
  // (a) creator baseline → outlier score. Reuse a same-author baseline
  //     already computed this run (some creators land multiple videos in the
  //     shortlist — EXPOSR had two — and their baseline doesn't change).
  try {
    if (c.author) {
      const key = c.author.toLowerCase();
      let median: number | null | undefined = baselineCache?.get(key);
      if (median === undefined) {
        const views = await fetchBaselineViews(c.author, c.post_id);
        median = computeBaselineMedian(views);
        baselineCache?.set(key, median);
      }
      c.baseline_median = median;
      c.outlier_score = computeOutlierScore(c.views, median ?? null);
    }
  } catch (e) {
    c.inspect_error = `baseline: ${e instanceof Error ? e.message : String(e)}`;
  }

  // (b) watch the video (Gemini), cover-frame fallback if the file is gone
  try {
    let videoUrl: string | null = null;
    try {
      const raw = await runPostScrape({ postUrl: c.url });
      const { items } = parseApifyItems(raw);
      videoUrl = items[0] ? tiktokVideoUrl(items[0]) : null;
      if (!videoUrl) {
        const errItem = (raw[0] ?? {}) as Record<string, unknown>;
        c.video_error = String(errItem.error ?? "post scrape returned no video url").slice(0, 200);
      }
    } catch (e) {
      videoUrl = null;
      c.video_error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    }
    if (videoUrl && geminiConfigured()) {
      const { text } = await analyzeVideo({
        videoUrl,
        prompt: RUBRIC_PROMPT,
        route: "/api/growth/research/step",
      });
      c.coding = validateCoding(parseJsonLoose(text));
      c.coded_from = "video";
      delete c.video_error;
    } else {
      if (!c.video_error && !geminiConfigured()) c.video_error = "GOOGLE_API_KEY not set";
      c.coding = await codeFromCover(c);
      c.coded_from = "cover";
    }
  } catch (e) {
    c.video_error =
      c.video_error ?? (e instanceof Error ? e.message : String(e)).slice(0, 200);
    // last resort: try the cover if the video path threw mid-way
    try {
      c.coding = await codeFromCover(c);
      c.coded_from = "cover";
    } catch {
      c.coding = null;
      c.coded_from = "none";
      c.inspect_error = `${c.inspect_error ? c.inspect_error + " · " : ""}coding: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  c.strong = isStrongFind(c);

  // (c) strong app finds feed the Inspo feed
  if (c.strong && c.coding && c.coding.app_visibility >= 1) {
    try {
      let thumb: string | null = null;
      if (c.cover_url) {
        try {
          const postId = c.post_id ?? c.url.split("/").filter(Boolean).pop() ?? runId;
          thumb = await fetchToStorage(c.cover_url, `viral-apps/tiktok/${postId}.jpg`);
        } catch {
          thumb = null;
        }
      }
      await sbWrite("POST", `viral_app_posts?on_conflict=post_url`, {
        platform: "tiktok",
        post_id: c.post_id,
        post_url: c.url,
        author_handle: c.author || null,
        app_name: c.coding.app_name || null,
        app_category: c.coding.app_category || null,
        by_brand: false,
        source: "search",
        source_detail: `research:${runId}`,
        posted_at: c.posted_at,
        view_count: c.views,
        like_count: c.likes,
        comment_count: c.comments,
        share_count: 0,
        caption: c.caption || null,
        thumbnail_url: thumb,
        hook_text: c.coding.hook_transcript || null,
        format: c.coding.format,
        hook_type: c.coding.hook_type || null,
        why_it_hit: c.coding.why_it_hit || null,
        is_confirmed_app: true,
      });
    } catch (e) {
      c.inspect_error = `${c.inspect_error ? c.inspect_error + " · " : ""}inspo upsert: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

// --- synthesis -----------------------------------------------------------------------

async function synthesizeReport(run: ResearchRun): Promise<{ report_md: string; follow_ups: string[] }> {
  const state = run.phase_state;
  const inspected = (state.candidates ?? []).filter((c) => c.coding || c.outlier_score != null);
  const evidence = inspected.map((c) => ({
    url: c.url,
    author: c.author,
    views: c.views,
    outlier: c.outlier_score != null ? `${c.outlier_score.toFixed(1)}x their ${c.baseline_median} median` : "no baseline",
    coded_from: c.coded_from,
    strong: c.strong === true,
    found_via: c.found_via,
    ...(c.coding ?? {}),
  }));
  const { value } = await structuredCall<{ report_md: string; follow_ups: string[] }>({
    model: MODELS.SONNET_4_6,
    system:
      "You write viral-content research memos for DreamMe, a GLP-1 companion iOS app (medication logging, protein/fiber tracking, food scanning, virtual pet). " +
      "Your memos read like a sharp human researcher's: every claim is anchored to a specific coded video (author, views, outlier multiple), formats get explicit verdicts, and recommendations are concrete enough to shoot this week. " +
      "Judge replication value the Lightreel way: a format only counts if the app is load-bearing (visibility 2-3, works_without_app=false) — virality that ignores the app doesn't transfer.",
    user:
      `Research question: "${run.question}"\n\n` +
      `Categories swept: ${(state.categories ?? []).join(", ")}\n` +
      `Searches run: ${(state.searches ?? []).map((s) => `"${s.query}"`).join(", ")}\n` +
      `Strong-find criteria: ${state.strong_criteria ?? "(default)"}\n\n` +
      `Coded evidence (${evidence.length} videos):\n${JSON.stringify(evidence, null, 1)}\n\n` +
      "Write the memo in markdown with EXACTLY these sections:\n" +
      "## The short version — 3-5 bullets, the headline findings\n" +
      "## Format clusters — group the winners into named, repeatable formats; per format: the evidence videos (author, views, outlier multiple, app visibility), and a verdict (REPLICATE / TEST / SKIP with one-line why)\n" +
      "## Copy / avoid — what to lift verbatim vs the traps (e.g. formats that work without the app)\n" +
      "## 3 repeatable series for DreamMe — concrete series concepts with example first-video hooks in native viewer language\n" +
      "## Replication searches — the exact TikTok searches a human should run monthly to keep mining this vein\n" +
      "EVERY time you cite an evidence video, cite it as a markdown link using its exact url from the evidence JSON, in the form [@author · 2.1M views](url) — the dashboard renders these as clickable evidence. " +
      "Where evidence is thin (few videos, cover-only coding), say so plainly.\n\n" +
      "Also emit follow_ups: 3 sharp follow-up research questions this memo begs (each phrased as a runnable research question, like 'Find viral videos where a scanner app settles a couple's grocery argument').",
    toolName: "emit_research_memo",
    toolDescription: "Emit the final research memo.",
    schema: {
      type: "object",
      properties: {
        report_md: { type: "string", description: "The full memo in markdown, evidence videos cited as [@author · views](url) links." },
        follow_ups: {
          type: "array",
          items: { type: "string" },
          description: "3 follow-up research questions this memo suggests running next.",
        },
      },
      required: ["report_md", "follow_ups"],
    },
    validate: (v) => {
      const o = v as Record<string, unknown>;
      const md = String(o.report_md ?? "").trim();
      if (md.length < 200) throw new Error("memo too short");
      const follow_ups = (Array.isArray(o.follow_ups) ? o.follow_ups : [])
        .map((s) => String(s).slice(0, 200))
        .filter(Boolean)
        .slice(0, 4);
      return { report_md: md, follow_ups };
    },
    // Memo + inline citations + follow_ups for a 14-video run regularly runs
    // past 4.5k output tokens — a truncated tool call surfaces as
    // "memo too short", so keep real headroom here.
    maxTokens: 8000,
  });
  return value;
}

// --- run lifecycle ---------------------------------------------------------------------

export async function createResearchRun(question: string): Promise<ResearchRun> {
  const rows = await sbWrite("POST", "growth_research_runs", {
    question: question.slice(0, 500),
    status: "planning",
    phase_state: {},
    model: MODELS.SONNET_4_6,
  });
  const run = rows[0] as ResearchRun | undefined;
  if (!run?.id) throw new Error("failed to create research run");
  return run;
}

export async function getResearchRun(id: string): Promise<ResearchRun | null> {
  const rows = await sbSelect<ResearchRun>(
    `growth_research_runs?id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function listResearchRuns(limit = 12): Promise<ResearchRun[]> {
  return sbSelect<ResearchRun>(
    `growth_research_runs?select=id,question,status,report_md,model,error,created_at,updated_at,completed_at,phase_state&order=created_at.desc&limit=${Math.max(1, Math.min(50, limit))}`,
  );
}

async function saveRun(
  id: string,
  patch: Partial<Pick<ResearchRun, "status" | "phase_state" | "report_md" | "error" | "completed_at">>,
): Promise<void> {
  await sbWrite("PATCH", `growth_research_runs?id=eq.${encodeURIComponent(id)}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

/** Human-readable progress for the UI stepper. */
export function runProgress(run: ResearchRun): {
  phase: ResearchStatus;
  label: string;
  inspected: number;
  shortlist: number;
  candidates: number;
  strong: number;
} {
  const s = run.phase_state;
  const shortlist = s.shortlist?.length ?? 0;
  const cursor = s.inspect_cursor ?? 0;
  const strong = (s.candidates ?? []).filter((c) => c.strong).length;
  const labels: Record<ResearchStatus, string> = {
    planning: "Planning adjacent categories + seed searches",
    seeding: "Running seed searches",
    expanding: "Mining native phrases → round-2 searches",
    inspecting: `Watching videos (${Math.min(cursor, shortlist)}/${shortlist})`,
    synthesizing: "Writing the memo",
    done: "Done",
    failed: run.error ?? "Failed",
  };
  return {
    phase: run.status,
    label: labels[run.status],
    inspected: Math.min(cursor, shortlist),
    shortlist,
    candidates: s.candidates?.length ?? 0,
    strong,
  };
}

/**
 * Advance a run by ONE bounded phase chunk. Client calls this in a loop
 * until status is done/failed. A step on a failed run retries the phase
 * that failed (status is left pointing at it).
 */
export async function stepResearchRun(runId: string): Promise<ResearchRun> {
  if (!apifySpyConfigured()) throw new Error("APIFY_KEY not set");
  const run = await getResearchRun(runId);
  if (!run) throw new Error("run not found");
  if (run.status === "done") return run;

  // A failed run retries the phase recorded in phase_state; "failed" itself
  // isn't a phase. Recover the last real phase from state shape.
  let status: ResearchStatus = run.status;
  if (status === "failed") {
    const s = run.phase_state;
    status = !s.seed_queries
      ? "planning"
      : !s.expansion_queries
        ? s.candidates?.length
          ? "expanding"
          : "seeding"
        : (s.inspect_cursor ?? 0) < (s.shortlist?.length ?? 0)
          ? "inspecting"
          : "synthesizing";
    await saveRun(run.id, { status, error: null } as Partial<ResearchRun>);
  }

  const state: PhaseState = run.phase_state ?? {};
  try {
    switch (status) {
      case "planning": {
        const plan = await planPhase(run.question);
        state.categories = plan.categories;
        state.seed_queries = plan.seed_queries;
        state.strong_criteria = plan.strong_criteria;
        state.candidates = [];
        state.searches = [];
        await saveRun(run.id, { status: "seeding", phase_state: state });
        break;
      }
      case "seeding": {
        // Our own video database first (free — already paid for by past
        // scrapes and runs), then the paid searches.
        const terms = extractTerms(`${run.question} ${(state.categories ?? []).join(" ")}`);
        const local = await searchLocalPosts(terms, RESEARCH_FLOOR);
        if (local.length) {
          state.candidates = mergeCandidates(state.candidates ?? [], local);
          state.searches = [
            ...(state.searches ?? []),
            { query: terms.slice(0, 5).join(", "), round: 1, fetched: local.length, kept: local.length, via: "database" },
          ];
        }
        await runSearches(state.seed_queries ?? [], 1, state);
        await saveRun(run.id, { status: "expanding", phase_state: state });
        break;
      }
      case "expanding": {
        const queries = await expansionQueries(run.question, state.candidates ?? []);
        state.expansion_queries = queries;
        if (queries.length) await runSearches(queries, 2, state);
        state.shortlist = buildShortlist(state.candidates ?? []);
        state.inspect_cursor = 0;
        const next = state.shortlist.length ? "inspecting" : "synthesizing";
        await saveRun(run.id, { status: next, phase_state: state });
        break;
      }
      case "inspecting": {
        const shortlist = state.shortlist ?? [];
        const cursor = state.inspect_cursor ?? 0;
        const byUrl = new Map((state.candidates ?? []).map((c) => [c.url, c]));
        const batch = shortlist
          .slice(cursor, cursor + INSPECT_PER_STEP)
          .map((url) => byUrl.get(url))
          .filter((c): c is ResearchCandidate => !!c);
        // Never watch the same video twice: pull codings + creator baselines
        // from recent runs and satisfy what we can from the corpus for free.
        const prior = await fetchPriorCodings(run.id);
        const reused = applyPriorCodings(batch, prior.byUrl);
        for (const c of batch) {
          if (c.coded_from === "prior") c.strong = isStrongFind(c);
        }
        // Seed the baseline cache from candidates already inspected in prior
        // steps AND from prior runs, so a known author isn't re-scraped.
        const baselineCache = new Map<string, number | null>(prior.baselineByAuthor);
        for (const cand of state.candidates ?? []) {
          if (cand.author && cand.baseline_median !== undefined) {
            baselineCache.set(cand.author.toLowerCase(), cand.baseline_median ?? null);
          }
        }
        const todo = batch.filter((c) => c.coded_from !== "prior");
        if (reused > 0) {
          // still resolve baselines for prior-coded candidates missing one
          for (const c of batch) {
            if (c.coded_from === "prior" && c.outlier_score == null && c.author) {
              const cached = baselineCache.get(c.author.toLowerCase());
              if (cached != null) {
                c.baseline_median = cached;
                c.outlier_score = computeOutlierScore(c.views, cached);
                c.strong = isStrongFind(c);
              }
            }
          }
        }
        await pool(todo, INSPECT_PER_STEP, (c) => inspectCandidate(c, run.id, baselineCache));
        state.inspect_cursor = Math.min(cursor + INSPECT_PER_STEP, shortlist.length);
        const finished = state.inspect_cursor >= shortlist.length;
        await saveRun(run.id, {
          status: finished ? "synthesizing" : "inspecting",
          phase_state: state,
        });
        break;
      }
      case "synthesizing": {
        const { report_md, follow_ups } = await synthesizeReport({ ...run, phase_state: state });
        state.follow_ups = follow_ups;
        await saveRun(run.id, {
          status: "done",
          phase_state: state,
          report_md,
          completed_at: new Date().toISOString(),
        } as Partial<ResearchRun>);
        break;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await saveRun(run.id, { status: "failed", phase_state: state, error: msg } as Partial<ResearchRun>);
    const failed = await getResearchRun(run.id);
    if (failed) return failed;
    throw e;
  }

  const updated = await getResearchRun(run.id);
  if (!updated) throw new Error("run vanished mid-step");
  return updated;
}
