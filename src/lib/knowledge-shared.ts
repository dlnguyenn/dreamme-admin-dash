/**
 * Pure helpers for the Knowledge tab (vault reader). No I/O, so they're unit-tested
 * in tests/knowledge-shared.test.ts. Server side: src/lib/knowledge.ts.
 */

export interface Frontmatter {
  title?: string;
  type?: string;
  updated?: string;
  tags?: string[];
  private?: boolean;
  [k: string]: unknown;
}

/** Splits a "---" YAML-ish header off a Markdown file. Only flat `key: value` and `[a, b]` lists. */
export function parseFrontmatter(src: string): { meta: Frontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, raw] = kv;
    const v = raw.trim();
    if (/^\[.*\]$/.test(v)) {
      meta[k] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (v === "true" || v === "false") {
      meta[k] = v === "true";
    } else {
      meta[k] = v.replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body: src.slice(m[0].length) };
}

/** Obsidian [[page]] / [[page|label]] links become in-app links the Knowledge reader intercepts. */
export function wikiLinksToMarkdown(src: string): string {
  return src.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, page: string, label?: string) => {
    const slug = page.trim().replace(/\.md$/, "");
    return `[${(label ?? slug).trim()}](${knowledgePageHref(slug)})`;
  });
}

export const knowledgePageHref = (slug: string) => `/?tab=knowledge&page=${encodeURIComponent(slug)}`;

/** The slug from a knowledgePageHref, or null for any other link. */
export function pageSlugFromHref(href: string): string | null {
  const m = /^\/\?tab=knowledge&page=([^&#]+)/.exec(href);
  return m ? decodeURIComponent(m[1]) : null;
}

export interface LogEntry {
  date: string;
  kind: string;
  title: string;
  page: string | null;
  body: string;
}

/** wiki/log.md entries look like "## [2026-11-08] change | Title -> [[page]]" followed by bullets. */
export function parseLog(src: string): LogEntry[] {
  const out: LogEntry[] = [];
  const re = /^## \[(\d{4}-\d{2}-\d{2})\]\s*([^|\n]*?)\s*\|\s*(.*)$/gm;
  const heads = [...src.matchAll(re)];
  heads.forEach((h, i) => {
    const start = (h.index ?? 0) + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index ?? src.length : src.length;
    let title = h[3].trim();
    let page: string | null = null;
    const link = /\s*->\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(title);
    if (link) {
      page = link[1].trim();
      title = title.slice(0, link.index).trim();
    }
    out.push({ date: h[1], kind: h[2].trim() || "note", title, page, body: src.slice(start, end).trim() });
  });
  return out;
}

/** First real sentence-ish of a page, for list cards. */
export function summaryOf(body: string, max = 220): string {
  for (const raw of body.split(/\r?\n\s*\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("#") || t.startsWith("|") || t.startsWith("```") || t.startsWith("---")) continue;
    const plain = t
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*`>]/g, "")
      .replace(/^\s*[-\d.]+\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain.length < 20) continue;
    return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
  }
  return "";
}

/** Only these vault paths can be read through the DAD. No dot-dot, no hidden folders. */
const ALLOWED: RegExp[] = [
  /^wiki\/[A-Za-z0-9._-]+\.md$/,
  /^wiki\/data\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.html$/,
  /^raw-sources\/documents\/artifacts\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\.html$/,
  /^raw-sources\/documents\/expert-feeds\/(\d{4}|backfill\/[a-z0-9-]+)\/[A-Za-z0-9._-]+\.md$/,
];
export function isAllowedVaultPath(p: string): boolean {
  if (!p || p.includes("..") || p.includes("//") || /(^|\/)\./.test(p)) return false;
  return ALLOWED.some((re) => re.test(p));
}

/** Case-insensitive search with a short snippet around the first hit. */
export function snippetFor(text: string, q: string, radius = 90): string | null {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  const from = Math.max(0, i - radius);
  const to = Math.min(text.length, i + q.length + radius);
  const plain = text.slice(from, to).replace(/\*\*|`|\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
  return (from > 0 ? "…" : "") + plain + (to < text.length ? "…" : "");
}

/** Constant-time string compare, for the passphrase. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
