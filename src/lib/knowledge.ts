/**
 * Knowledge tab: reads Dan's Obsidian vault so anything Claude sessions file there can be read in the DAD.
 *
 * Where the vault comes from, first match wins:
 *   1. KNOWLEDGE_LOCAL_VAULT (development only): a local vault folder, read from disk.
 *   2. VAULT_GITHUB_TOKEN: live from the private GitHub repo (VAULT_REPO, default dlnguyenn/success-in-all-ways).
 *   3. Default: a snapshot in the private Supabase Storage bucket "knowledge-vault", uploaded by
 *      scripts/knowledge-snapshot.mjs with the service role the DAD already has. Refreshed only when
 *      that script runs. Vault content must never go into this repo: it is public.
 * Access: an admin sign-in or the ingest token (checkAdminAuth). The tab is admin-only and holds
 * dan.md and the finance notes, so a signed-in viewer is refused here too.
 */
import {
  isAllowedVaultPath,
  parseFrontmatter,
  parseLog,
  snippetFor,
  summaryOf,
  treeFromFiles,
  type LogEntry,
  type VNode,
} from "./knowledge-shared";
import { checkAdminAuth } from "./auth-ingest";

const REPO = process.env.VAULT_REPO || "dlnguyenn/success-in-all-ways";
const [OWNER, NAME] = REPO.split("/");
const TTL_MS = 5 * 60_000;
const LOCAL = process.env.NODE_ENV !== "production" ? process.env.KNOWLEDGE_LOCAL_VAULT || "" : "";
const GITHUB = !LOCAL && !!process.env.VAULT_GITHUB_TOKEN;
// Default source: a snapshot of the vault in a private Supabase Storage bucket, uploaded by
// scripts/knowledge-snapshot.mjs. Read with the service role the DAD already has; no extra token.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SB_KEY = process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const KNOWLEDGE_BUCKET = "knowledge-vault";

export type KnowledgeConfig = { ok: true } | { ok: false; missing: string[] };
export function knowledgeConfig(): KnowledgeConfig {
  if (LOCAL || GITHUB) return { ok: true };
  const missing = [!SB_URL && "NEXT_PUBLIC_SUPABASE_URL", !SB_KEY && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean) as string[];
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** null = allowed; otherwise the HTTP status and message to return. */
export function knowledgeAuthError(req: Request): { status: number; error: string } | null {
  if (!checkAdminAuth(req)) return { status: 401, error: "unauthorized" };
  const cfg = knowledgeConfig();
  if (!cfg.ok) return { status: 503, error: `not configured: ${cfg.missing.join(", ")}` };
  return null;
}

// ---------------- vault access (GitHub, or local disk in development) ----------------


const ghHeaders = () => ({
  Authorization: `Bearer ${process.env.VAULT_GITHUB_TOKEN}`,
  "User-Agent": "dreamme-admin-dash",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function gql<T>(query: string): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { owner: OWNER, name: NAME } }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    throw new Error(`GitHub ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 240)}`);
  }
  return json.data as T;
}

type GqlEntry = { name: string; type: string; object?: { byteSize?: number; text?: string | null; isTruncated?: boolean; entries?: GqlEntry[] } | null };

/**
 * The folder at `dir`, `depth` levels deep (1 or 2). With `text`, blobs at the deepest level
 * carry their contents (GitHub truncates very large ones; those come back as null).
 */
async function listTree(dir: string, depth: 1 | 2, text = false): Promise<VNode[]> {
  if (LOCAL) return localTree(dir, depth, text);
  if (!GITHUB) return snapshotTree(dir, depth, text);
  const blob = text ? "... on Blob { byteSize text isTruncated }" : "... on Blob { byteSize }";
  const leaf = `entries { name type object { ${blob} } }`;
  const inner = depth === 2 ? `entries { name type object { ${blob} ... on Tree { ${leaf} } } }` : leaf;
  const q = `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ object(expression:${JSON.stringify(`HEAD:${dir}`)}){ ... on Tree { ${inner} } } } }`;
  const data = await gql<{ repository: { object: { entries: GqlEntry[] } | null } }>(q);
  const conv = (e: GqlEntry): VNode => ({
    name: e.name,
    type: e.type === "tree" ? "tree" : "blob",
    size: e.object?.byteSize ?? 0,
    text: e.object?.isTruncated ? null : e.object?.text,
    children: e.object?.entries?.map(conv),
  });
  return (data.repository.object?.entries ?? []).map(conv);
}

async function headCommit(): Promise<{ oid: string; date: string } | null> {
  if (LOCAL) return null;
  if (!GITHUB) {
    const m = await loadManifest();
    return m.commit ? { oid: m.commit, date: m.generatedAt } : null;
  }
  const d = await gql<{ repository: { defaultBranchRef: { target: { oid: string; committedDate: string } } | null } }>(
    `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ defaultBranchRef{ target{ ... on Commit { oid committedDate } } } } }`,
  );
  const t = d.repository.defaultBranchRef?.target;
  return t ? { oid: t.oid, date: t.committedDate } : null;
}

/** Raw file from the vault's default branch (GitHub serves raw files up to 100 MB). */
async function rawFile(path: string): Promise<Response> {
  if (LOCAL) {
    const fs = await import("node:fs/promises");
    const p = await import("node:path");
    try {
      return new Response(await fs.readFile(p.join(LOCAL, path)));
    } catch {
      return new Response("not found", { status: 404 });
    }
  }
  if (!GITHUB) {
    const m = await loadManifest();
    const f = m.byPath.get(path);
    if (!f) return new Response("not found", { status: 404 });
    if (typeof f.text === "string") return new Response(f.text);
    return storageGet(path);
  }
  const url = `https://api.github.com/repos/${OWNER}/${NAME}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  return fetch(url, { headers: { ...ghHeaders(), Accept: "application/vnd.github.raw" }, cache: "no-store" });
}
async function readText(path: string): Promise<string> {
  const res = await rawFile(path);
  if (!res.ok) throw new Error(`vault ${res.status} for ${path}`);
  return res.text();
}

// ---- Supabase snapshot ----
interface ManifestFile {
  path: string;
  size: number;
  text?: string;
}
interface Manifest {
  generatedAt: string;
  commit: string | null;
  files: ManifestFile[];
  byPath: Map<string, ManifestFile>;
}
let manifestCache: { at: number; value: Manifest } | null = null;

function storageGet(path: string): Promise<Response> {
  const url = `${SB_URL}/storage/v1/object/authenticated/${KNOWLEDGE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: "no-store" });
}

async function loadManifest(): Promise<Manifest> {
  if (manifestCache && Date.now() - manifestCache.at < TTL_MS) return manifestCache.value;
  const res = await storageGet("manifest.json");
  if (res.status === 400 || res.status === 404) {
    throw Object.assign(new Error("no snapshot uploaded yet (run scripts/knowledge-snapshot.mjs)"), { code: 503 });
  }
  if (!res.ok) throw new Error(`Supabase storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = (await res.json()) as Omit<Manifest, "byPath">;
  const value: Manifest = { ...raw, byPath: new Map(raw.files.map((f) => [f.path, f])) };
  manifestCache = { at: Date.now(), value };
  return value;
}

/** The same shape listTree returns, built from the snapshot's file list. */
async function snapshotTree(dir: string, depth: number, text: boolean): Promise<VNode[]> {
  return treeFromFiles((await loadManifest()).files, dir, depth, text);
}

async function localTree(dir: string, depth: number, text: boolean): Promise<VNode[]> {
  const fs = await import("node:fs/promises");
  const p = await import("node:path");
  const walk = async (rel: string, left: number): Promise<VNode[]> => {
    let ents: import("node:fs").Dirent[] = [];
    try {
      ents = await fs.readdir(p.join(LOCAL, rel), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: VNode[] = [];
    for (const e of ents) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        out.push({ name: e.name, type: "tree", size: 0, children: left > 1 ? await walk(r, left - 1) : undefined });
      } else {
        const st = await fs.stat(p.join(LOCAL, r));
        const wantText = text && left === 1 && st.size < 2_000_000;
        out.push({ name: e.name, type: "blob", size: st.size, text: wantText ? await fs.readFile(p.join(LOCAL, r), "utf8") : undefined });
      }
    }
    return out;
  };
  return walk(dir, depth);
}

// ---------------- index ----------------

export interface PageMeta {
  path: string;
  slug: string;
  title: string;
  type: string | null;
  updated: string | null;
  tags: string[];
  private: boolean;
  bytes: number;
  summary: string;
}
export interface LibraryItem {
  path: string;
  title: string;
  description: string;
  topic: string;
  updated: string | null;
  url: string | null;
  bytes: number;
  notes: string | null;
  pinned?: boolean;
}
export interface FeedFile {
  path: string;
  title: string;
  date: string | null;
  bytes: number;
  posts: number | null;
}
export interface KnowledgeIndex {
  repo: string;
  commit: { oid: string; date: string } | null;
  fetchedAt: string;
  library: LibraryItem[];
  pages: PageMeta[];
  log: LogEntry[];
  feeds: { weekly: FeedFile[]; backfill: FeedFile[] };
}

let indexCache: { at: number; value: KnowledgeIndex } | null = null;
let pageTextCache = new Map<string, string>();

const ARTIFACTS = "raw-sources/documents/artifacts";
const FEEDS = "raw-sources/documents/expert-feeds";
const BACKFILL_POSTS = `${FEEDS}/backfill/linkedin-2025-11-to-2026-11/posts.json`;

export async function getKnowledgeIndex(force = false): Promise<KnowledgeIndex> {
  if (!force && indexCache && Date.now() - indexCache.at < TTL_MS) return indexCache.value;

  const [commit, wiki, wikiData, artifacts, feeds, backfillTree, logText] = await Promise.all([
    headCommit(),
    listTree("wiki", 1, true),
    listTree("wiki/data", 2),
    listTree(ARTIFACTS, 2),
    listTree(FEEDS, 2),
    listTree(`${FEEDS}/backfill`, 2),
    readText("wiki/log.md").catch(() => ""),
  ]);

  // Wiki pages, with text kept server-side for search and the reader.
  const texts = new Map<string, string>();
  const pages: PageMeta[] = [];
  for (const e of wiki) {
    if (e.type !== "blob" || !e.name.endsWith(".md") || e.name === "log.md") continue;
    const path = `wiki/${e.name}`;
    let text = e.text ?? "";
    if (e.text == null && e.size > 0) text = await readText(path).catch(() => "");
    texts.set(path, text);
    const { meta, body } = parseFrontmatter(text);
    const slug = e.name.replace(/\.md$/, "");
    pages.push({
      path,
      slug,
      title: (meta.title as string) || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || slug,
      type: (meta.type as string) ?? null,
      updated: (meta.updated as string) ?? null,
      tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
      private: meta.private === true,
      bytes: e.size,
      summary: summaryOf(body),
    });
  }
  pages.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || a.title.localeCompare(b.title));

  // The log: entries from the last 30 days, newest first.
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const log = parseLog(logText).filter((l) => l.date >= since).reverse();

  // Library: the growth library page (pinned) + artifact snapshots (newest snapshot per slug).
  const library: LibraryItem[] = [];
  // Only the growth library is pinned from wiki/data; other pages there (e.g. the ICP) are also artifact snapshots.
  for (const d of wikiData) {
    if (!d.name.startsWith("subscription-growth-library")) continue;
    for (const f of d.children ?? []) {
      if (f.type === "blob" && f.name.endsWith(".html")) {
        library.push({
          path: `wiki/data/${d.name}/${f.name}`,
          title: "DreamMe Growth Library",
          description: "Every rated podcast, video and expert post on growing a subscription app, boiled down to tips for DreamMe.",
          topic: "growth",
          updated: pages.find((p) => p.slug === "subscription-growth-library")?.updated ?? null,
          url: "https://claude.ai/artifact/DZ8hRD91vUMQdFVG9Q4aNS",
          bytes: f.size,
          notes: null,
          pinned: true,
        });
      }
    }
  }
  const snapDirs = artifacts.filter((e) => e.type === "tree" && /^\d{4}-\d{2}-\d{2}$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
  const seen = new Set<string>();
  for (const d of snapDirs) {
    const sizes = new Map((d.children ?? []).map((f) => [f.name, f.size]));
    if (!sizes.has("index.json")) continue;
    let items: Array<Record<string, unknown>> = [];
    try {
      items = JSON.parse(await readText(`${ARTIFACTS}/${d.name}/index.json`));
    } catch {
      continue;
    }
    for (const it of items) {
      const slug = String(it.slug ?? "");
      const file = String(it.file ?? `${slug}.html`);
      if (!slug || seen.has(slug) || !sizes.has(file)) continue;
      seen.add(slug);
      library.push({
        path: `${ARTIFACTS}/${d.name}/${file}`,
        title: String(it.title ?? slug),
        description: String(it.description ?? ""),
        topic: String(it.topic ?? "other"),
        updated: (it.updated as string) ?? d.name,
        url: (it.url as string) ?? null,
        bytes: sizes.get(file) ?? 0,
        notes: (it.notes as string) ?? null,
      });
    }
  }
  library.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updated ?? "").localeCompare(a.updated ?? ""));

  // Expert feeds: weekly digests (<year>/*.md) and the backfill folders (backfill/<folder>/<person>.md).
  const weekly: FeedFile[] = [];
  for (const d of feeds) {
    if (d.type !== "tree" || !/^\d{4}$/.test(d.name)) continue;
    for (const f of d.children ?? []) {
      if (!f.name.endsWith(".md")) continue;
      weekly.push({ path: `${FEEDS}/${d.name}/${f.name}`, title: f.name.replace(/\.md$/, ""), date: /^(\d{4}-\d{2}-\d{2})/.exec(f.name)?.[1] ?? null, bytes: f.size, posts: null });
    }
  }
  weekly.sort((a, b) => b.title.localeCompare(a.title, undefined, { numeric: true }));
  const backfill: FeedFile[] = [];
  for (const d of backfillTree) {
    const readmeNode = d.children?.find((f) => f.name === "README.md");
    for (const f of d.children ?? []) {
      if (!f.name.endsWith(".md") || f.name === "README.md") continue;
      backfill.push({ path: `${FEEDS}/backfill/${d.name}/${f.name}`, title: f.name.replace(/\.md$/, ""), date: null, bytes: f.size, posts: null });
    }
    if (readmeNode) {
      // Person names and counts come from the README's table.
      const readme = await readText(`${FEEDS}/backfill/${d.name}/README.md`).catch(() => "");
      for (const row of readme.matchAll(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(\d+)\s*\|\s*([\d-]+)\s*\|\s*([\d-]+)\s*\|/gm)) {
        const hit = backfill.find((b) => b.path === `${FEEDS}/backfill/${d.name}/${row[2]}`);
        if (hit) Object.assign(hit, { title: row[1], posts: Number(row[3]), date: `${row[4]} to ${row[5]}` });
      }
    }
  }
  backfill.sort((a, b) => (b.posts ?? 0) - (a.posts ?? 0));

  const value: KnowledgeIndex = {
    repo: LOCAL ? `local:${LOCAL}` : REPO,
    commit,
    fetchedAt: new Date().toISOString(),
    library,
    pages,
    log,
    feeds: { weekly, backfill },
  };
  pageTextCache = texts;
  indexCache = { at: Date.now(), value };
  return value;
}

// ---------------- search ----------------

export interface SearchHit {
  source: "wiki" | "expert-post";
  path: string | null;
  title: string;
  snippet: string;
  date: string | null;
  url: string | null;
  person?: string;
}

interface FeedPost {
  platform: string;
  person: string;
  url: string;
  posted_at: string;
  text: string;
}
let postsCache: { at: number; posts: FeedPost[] } | null = null;

async function expertPosts(): Promise<FeedPost[]> {
  if (postsCache && Date.now() - postsCache.at < TTL_MS * 2) return postsCache.posts;
  const posts: FeedPost[] = [];
  const backfill = await readText(BACKFILL_POSTS).catch(() => "");
  if (backfill) posts.push(...((JSON.parse(backfill).posts ?? []) as FeedPost[]));
  // Weekly digests' .json twins are small, so their text comes back with the folder listing.
  const years = await listTree(FEEDS, 2, true).catch(() => [] as VNode[]);
  for (const d of years) {
    if (!/^\d{4}$/.test(d.name)) continue;
    for (const f of d.children ?? []) {
      if (!f.name.endsWith(".json")) continue;
      const text = f.text ?? (await readText(`${FEEDS}/${d.name}/${f.name}`).catch(() => ""));
      try {
        posts.push(...((JSON.parse(text).posts ?? []) as FeedPost[]));
      } catch {
        /* skip a malformed digest */
      }
    }
  }
  const byUrl = new Map<string, FeedPost>();
  for (const p of posts) if (p?.url && !byUrl.has(p.url)) byUrl.set(p.url, p);
  postsCache = { at: Date.now(), posts: [...byUrl.values()] };
  return postsCache.posts;
}

export async function searchKnowledge(q: string, limit = 60): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const index = await getKnowledgeIndex();
  const hits: SearchHit[] = [];
  for (const p of index.pages) {
    const text = pageTextCache.get(p.path) ?? "";
    const inTitle = p.title.toLowerCase().includes(query.toLowerCase());
    const snip = snippetFor(parseFrontmatter(text).body, query);
    if (inTitle || snip) hits.push({ source: "wiki", path: p.path, title: p.title, snippet: snip ?? p.summary, date: p.updated, url: null });
  }
  for (const e of index.log) {
    const snip = snippetFor(`${e.title}\n${e.body}`, query);
    if (snip) hits.push({ source: "wiki", path: "wiki/log.md", title: `Log ${e.date}: ${e.title}`, snippet: snip, date: e.date, url: null });
  }
  const posts = await expertPosts().catch(() => [] as FeedPost[]);
  const postHits = posts
    .map((p) => ({ p, snip: snippetFor(p.text ?? "", query) }))
    .filter((x): x is { p: FeedPost; snip: string } => !!x.snip)
    .sort((a, b) => b.p.posted_at.localeCompare(a.p.posted_at));
  for (const { p, snip } of postHits) {
    hits.push({
      source: "expert-post",
      path: null,
      title: `${p.person} on ${p.platform === "x" ? "X" : "LinkedIn"}`,
      snippet: snip,
      date: p.posted_at.slice(0, 10),
      url: p.url,
      person: p.person,
    });
  }
  // Notes first (they're few), then the newest expert posts.
  return [...hits.filter((h) => h.source === "wiki").slice(0, 25), ...hits.filter((h) => h.source === "expert-post")].slice(0, limit);
}

/** One allowlisted vault file as plain text, for the reader. Streamed through so multi-MB pages don't buffer. */
export async function readVaultDoc(path: string): Promise<Response> {
  if (!isAllowedVaultPath(path)) return new Response("path not allowed", { status: 400 });
  const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" };
  const cached = pageTextCache.get(path);
  if (cached !== undefined && indexCache && Date.now() - indexCache.at < TTL_MS) return new Response(cached, { headers });
  const upstream = await rawFile(path);
  if (!upstream.ok) return new Response(`vault ${upstream.status}`, { status: upstream.status === 404 ? 404 : 502 });
  return new Response(upstream.body, { headers });
}
