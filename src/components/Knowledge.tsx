"use client";

/**
 * Knowledge: everything Claude sessions have filed in Dan's vault, readable in the DAD.
 * Library (artifact snapshots + the growth library), What's new (the log), the wiki, and expert feeds.
 * Data is read live from the vault repo by /api/knowledge* (same access check as the rest of the DAD).
 */
import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip } from "./ui";
import { Icons } from "./Icons";
import { ErrorBanner, Segmented } from "./porcelain";
import { BlockView } from "./BriefReader";
import { parseMarkdown } from "@/lib/mini-markdown";
import { pageSlugFromHref, parseFrontmatter, wikiLinksToMarkdown, type LogEntry } from "@/lib/knowledge-shared";
import { useIsMobile } from "@/lib/useIsMobile";

type Sub = "library" | "new" | "wiki" | "feeds";
const SUB_KEY = "dad.knowledge.sub.v1";

interface LibraryItem { path: string; title: string; description: string; topic: string; updated: string | null; url: string | null; bytes: number; notes: string | null; pinned?: boolean }
interface PageMeta { path: string; slug: string; title: string; type: string | null; updated: string | null; tags: string[]; private: boolean; bytes: number; summary: string }
interface FeedFile { path: string; title: string; date: string | null; bytes: number; posts: number | null }
interface Index {
  repo: string;
  commit: { oid: string; date: string } | null;
  fetchedAt: string;
  library: LibraryItem[];
  pages: PageMeta[];
  log: LogEntry[];
  feeds: { weekly: FeedFile[]; backfill: FeedFile[] };
}
interface Hit { source: "wiki" | "expert-post"; path: string | null; title: string; snippet: string; date: string | null; url: string | null; person?: string }

type Open = { kind: "md"; path: string; title: string } | { kind: "html"; item: LibraryItem } | null;

function readLocal(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLocal(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
}

async function kfetch(url: string): Promise<Response> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 503) {
    const j = await res.json().catch(() => ({}));
    throw Object.assign(new Error(j.error ?? "not configured"), { code: 503 });
  }
  return res;
}

const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function Knowledge() {
  const isMobile = useIsMobile();
  const [hydrated, setHydrated] = React.useState(false);
  const [index, setIndex] = React.useState<Index | null>(null);
  const [error, setError] = React.useState<{ msg: string; code?: number } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sub, setSub] = React.useState<Sub>("library");
  const [open, setOpen] = React.useState<Open>(null);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[] | null>(null);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    const s = readLocal(SUB_KEY);
    if (s === "library" || s === "new" || s === "wiki" || s === "feeds") setSub(s);
    setHydrated(true);
  }, []);
  React.useEffect(() => {
    if (hydrated) writeLocal(SUB_KEY, sub);
  }, [sub, hydrated]);

  const load = React.useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await kfetch(`/api/knowledge${refresh ? "?refresh=1" : ""}`);
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        setIndex(j as Index);
      } catch (e) {
        const err = e as Error & { code?: number };
        setError({ msg: err.message, code: err.code });
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  React.useEffect(() => {
    void load();
  }, [load]);

  // ?tab=knowledge&page=<slug> deep links open that wiki page.
  React.useEffect(() => {
    if (!index) return;
    const slug = new URLSearchParams(window.location.search).get("page");
    const p = slug && index.pages.find((x) => x.slug === slug);
    if (p) setOpen({ kind: "md", path: p.path, title: p.title });
  }, [index]);

  // Debounced search.
  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await kfetch(`/api/knowledge/search?q=${encodeURIComponent(term)}`);
        const j = await res.json();
        if (live) setHits(j.ok ? (j.hits as Hit[]) : []);
      } catch {
        if (live) setHits([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const openPage = React.useCallback(
    (slug: string) => {
      const p = index?.pages.find((x) => x.slug === slug);
      if (p) setOpen({ kind: "md", path: p.path, title: p.title });
    },
    [index],
  );

  if (!hydrated) return null;

  const since14 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const recentPages = index?.pages.filter((p) => (p.updated ?? "") >= since14) ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Knowledge"
        title="What we've learned"
        subtitle={`Playbooks, research and notes Claude has filed in the vault.${index?.commit ? ` Snapshot taken ${new Date(index.commit.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : ""}`}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <SearchBox value={q} onChange={setQ} busy={searching} />
            <Button variant="ghost" icon={<Icons.Refresh />} onClick={() => void load(true)} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {error && (
        <ErrorBanner>
          {error.code === 503
            ? `The vault isn't connected yet (${error.msg}). Add it in Vercel, then redeploy.`
            : `Couldn't load the vault: ${error.msg}`}
        </ErrorBanner>
      )}

      {hits ? (
        <SearchResults
          q={q}
          hits={hits}
          onOpen={(h) => {
            if (h.source === "wiki" && h.path) {
              const p = index?.pages.find((x) => x.path === h.path);
              if (p) setOpen({ kind: "md", path: p.path, title: p.title });
              else if (h.path === "wiki/log.md") setSub("new");
            }
          }}
          onClear={() => setQ("")}
        />
      ) : (
        <>
          <div style={{ marginBottom: 18, overflowX: "auto" }}>
            <Segmented
              value={sub}
              onChange={(v) => setSub(v as Sub)}
              options={[
                { value: "library", label: `Library${index ? ` · ${index.library.length}` : ""}` },
                { value: "new", label: `What's new${index ? ` · ${index.log.filter((l) => l.date >= since14).length}` : ""}` },
                { value: "wiki", label: `Wiki${index ? ` · ${index.pages.length}` : ""}` },
                { value: "feeds", label: "Expert feeds" },
              ]}
            />
          </div>

          {!index && loading && <Muted>Reading the vault…</Muted>}
          {index && sub === "library" && <Library items={index.library} onOpen={(item) => setOpen({ kind: "html", item })} />}
          {index && sub === "new" && <WhatsNew log={index.log} pages={recentPages} onOpenPage={openPage} isMobile={isMobile} />}
          {index && sub === "wiki" && <Wiki pages={index.pages} onOpen={(p) => setOpen({ kind: "md", path: p.path, title: p.title })} />}
          {index && sub === "feeds" && (
            <Feeds feeds={index.feeds} onOpen={(f, title) => setOpen({ kind: "md", path: f.path, title })} isMobile={isMobile} />
          )}
          {index?.commit && (
            <Muted style={{ marginTop: 28 }}>
              Vault at {index.commit.oid.slice(0, 7)}, {new Date(index.commit.date).toLocaleString()}. To refresh, run node scripts/knowledge-snapshot.mjs in the DAD folder.
            </Muted>
          )}
        </>
      )}

      {open?.kind === "md" && (
        <MarkdownReader path={open.path} title={open.title} onClose={() => setOpen(null)} onOpenPage={openPage} />
      )}
      {open?.kind === "html" && <HtmlReader item={open.item} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------------- pieces ----------------

function SearchBox({ value, onChange, busy }: { value: string; onChange: (v: string) => void; busy: boolean }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 10, top: 9, color: "var(--ink-3)" }}>
        <Icons.Search size={15} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={busy ? "Searching…" : "Search notes and expert posts"}
        aria-label="Search the vault"
        style={{ ...input, paddingLeft: 32, width: 260, maxWidth: "70vw" }}
      />
    </div>
  );
}

const TOPIC_LABEL: Record<string, string> = {
  growth: "Growth",
  competitors: "Competitors",
  "paid-ads": "Paid ads",
  retention: "Retention",
  product: "Product",
  partners: "Partners",
  planning: "Planning",
};

function Library({ items, onOpen }: { items: LibraryItem[]; onOpen: (i: LibraryItem) => void }) {
  const [topic, setTopic] = React.useState<string>("all");
  const topics = [...new Set(items.map((i) => i.topic))];
  const shown = topic === "all" ? items : items.filter((i) => i.topic === topic);
  if (!items.length) return <Muted>No artifacts saved to the vault yet.</Muted>;
  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {["all", ...topics].map((t) => (
          <Chip key={t} tone={t === topic ? "accent" : "neutral"} onClick={() => setTopic(t)}>
            {t === "all" ? "All" : TOPIC_LABEL[t] ?? t}
          </Chip>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {shown.map((it) => (
          <button key={it.path} onClick={() => onOpen(it)} style={{ ...card, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {it.pinned && <Chip tone="accent">Start here</Chip>}
              <span style={eyebrow}>{TOPIC_LABEL[it.topic] ?? it.topic}</span>
              <span style={{ ...eyebrow, marginLeft: "auto" }}>{it.updated ?? ""}</span>
            </div>
            <div style={{ font: "650 15px/1.3 var(--font-ui)", color: "var(--ink)" }}>{it.title}</div>
            <div style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)" }}>{it.description}</div>
            {it.notes && <div style={{ font: "400 11.5px/1.45 var(--font-ui)", color: "var(--ink-3)" }}>Some parts only work on claude.ai</div>}
          </button>
        ))}
      </div>
    </>
  );
}

function WhatsNew({ log, pages, onOpenPage, isMobile }: { log: LogEntry[]; pages: PageMeta[]; onOpenPage: (slug: string) => void; isMobile: boolean }) {
  const [days, setDays] = React.useState<"3" | "7" | "14" | "30">("7");
  const since = new Date(Date.now() - Number(days) * 864e5).toISOString().slice(0, 10);
  const entries = log.filter((l) => l.date >= since);
  const byDate = new Map<string, LogEntry[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const shownPages = pages.filter((p) => (p.updated ?? "") >= since);
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 300px", gap: 20, alignItems: "start" }}>
      <div>
        <div style={{ marginBottom: 12 }}>
          <Segmented
            size="sm"
            value={days}
            onChange={(v) => setDays(v as typeof days)}
            options={[
              { value: "3", label: "3 days" },
              { value: "7", label: "7 days" },
              { value: "14", label: "14 days" },
              { value: "30", label: "30 days" },
            ]}
          />
        </div>
        {!entries.length && <Muted>Nothing logged in this window.</Muted>}
        {[...byDate].map(([date, list]) => (
          <section key={date} style={{ marginBottom: 22 }}>
            <div style={{ ...eyebrow, marginBottom: 8 }}>
              {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} · {list.length}
            </div>
            {list.map((e, i) => (
              <LogCard key={`${date}-${i}`} entry={e} onOpenPage={onOpenPage} />
            ))}
          </section>
        ))}
      </div>
      <aside style={{ ...card, position: isMobile ? "static" : "sticky", top: 16 }}>
        <div style={{ font: "600 13px var(--font-ui)", marginBottom: 10 }}>Pages updated · {shownPages.length}</div>
        {shownPages.map((p) => (
          <button key={p.path} onClick={() => onOpenPage(p.slug)} style={listButton}>
            <span style={{ flex: 1, minWidth: 0 }}>{p.title}</span>
            <span style={eyebrow}>{p.updated?.slice(5)}</span>
          </button>
        ))}
      </aside>
    </div>
  );
}

function LogCard({ entry, onOpenPage }: { entry: LogEntry; onOpenPage: (slug: string) => void }) {
  const [openBody, setOpenBody] = React.useState(false);
  const blocks = React.useMemo(() => (openBody ? parseMarkdown(wikiLinksToMarkdown(entry.body)) : []), [openBody, entry.body]);
  return (
    <div style={{ ...card, padding: "12px 14px", marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
        <span style={eyebrow}>{entry.kind}</span>
        {entry.page && (
          <button
            onClick={() => onOpenPage(entry.page as string)}
            style={{ ...linkish, marginLeft: "auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {entry.page} →
          </button>
        )}
      </div>
      <button
        onClick={() => setOpenBody((v) => !v)}
        aria-expanded={openBody}
        style={{ all: "unset", cursor: "pointer", display: "block", font: "550 14px/1.4 var(--font-ui)", color: "var(--ink)" }}
      >
        {entry.title} <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>{openBody ? "▴" : "▾"}</span>
      </button>
      {openBody && (
        <ReaderClicks onOpenPage={onOpenPage}>
          <div style={{ marginTop: 6 }}>
            {blocks.map((b, i) => (
              <BlockView key={i} block={b} />
            ))}
          </div>
        </ReaderClicks>
      )}
    </div>
  );
}

function Wiki({ pages, onOpen }: { pages: PageMeta[]; onOpen: (p: PageMeta) => void }) {
  const [filter, setFilter] = React.useState("");
  const f = filter.trim().toLowerCase();
  const shown = f ? pages.filter((p) => p.title.toLowerCase().includes(f) || p.tags.some((t) => t.includes(f)) || p.slug.includes(f)) : pages;
  return (
    <>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter pages by title or tag" aria-label="Filter wiki pages" style={{ ...input, width: 320, maxWidth: "100%", marginBottom: 12 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
        {shown.map((p) => (
          <button key={p.path} onClick={() => onOpen(p)} style={{ ...card, padding: "12px 14px", textAlign: "left", cursor: "pointer" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <span style={eyebrow}>{p.type ?? "page"}</span>
              {p.private && <span style={{ ...eyebrow, color: "var(--accent)" }}>private</span>}
              <span style={{ ...eyebrow, marginLeft: "auto" }}>{p.updated ?? ""}</span>
            </div>
            <div style={{ font: "600 14px/1.35 var(--font-ui)", color: "var(--ink)", marginBottom: 4 }}>{p.title}</div>
            <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {p.summary}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function Feeds({ feeds, onOpen, isMobile }: { feeds: Index["feeds"]; onOpen: (f: FeedFile, title: string) => void; isMobile: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, alignItems: "start" }}>
      <div style={card}>
        <div style={{ font: "600 14px var(--font-ui)", marginBottom: 4 }}>Weekly pulls</div>
        <Muted style={{ marginBottom: 10 }}>New X and LinkedIn posts from the expert list, every Monday.</Muted>
        {feeds.weekly.map((f) => (
          <button key={f.path} onClick={() => onOpen(f, `Expert feeds ${f.title}`)} style={listButton}>
            <span style={{ flex: 1 }}>{f.title}</span>
            <span style={eyebrow}>{kb(f.bytes)}</span>
          </button>
        ))}
      </div>
      <div style={card}>
        <div style={{ font: "600 14px var(--font-ui)", marginBottom: 4 }}>LinkedIn, past year</div>
        <Muted style={{ marginBottom: 10 }}>Every public post from Nov 2025 to Nov 2026, one page per person.</Muted>
        {feeds.backfill.map((f) => (
          <button key={f.path} onClick={() => onOpen(f, `${f.title} on LinkedIn`)} style={listButton}>
            <span style={{ flex: 1 }}>{f.title}</span>
            <span style={eyebrow}>{f.posts ?? "?"} posts</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchResults({ q, hits, onOpen, onClear }: { q: string; hits: Hit[]; onOpen: (h: Hit) => void; onClear: () => void }) {
  const wiki = hits.filter((h) => h.source === "wiki");
  const posts = hits.filter((h) => h.source === "expert-post");
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ font: "600 14px var(--font-ui)" }}>
          {hits.length} result{hits.length === 1 ? "" : "s"} for “{q.trim()}”
        </div>
        <button onClick={onClear} style={linkish}>Clear</button>
      </div>
      {[["Notes", wiki], ["Expert posts", posts]].map(([label, list]) =>
        (list as Hit[]).length ? (
          <section key={label as string} style={{ marginBottom: 20 }}>
            <div style={{ ...eyebrow, marginBottom: 8 }}>{label as string}</div>
            {(list as Hit[]).map((h, i) => {
              const body = (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ font: "600 13.5px var(--font-ui)", color: "var(--ink)", flex: 1 }}>{h.title}</span>
                    <span style={eyebrow}>{h.date ?? ""}</span>
                  </div>
                  <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)", marginTop: 3 }}>{h.snippet}</div>
                </>
              );
              return h.url ? (
                <a key={i} href={h.url} target="_blank" rel="noopener noreferrer" style={{ ...card, display: "block", padding: "10px 14px", marginBottom: 6, textDecoration: "none" }}>
                  {body}
                </a>
              ) : (
                <button key={i} onClick={() => onOpen(h)} style={{ ...card, display: "block", width: "100%", padding: "10px 14px", marginBottom: 6, textAlign: "left", cursor: "pointer" }}>
                  {body}
                </button>
              );
            })}
          </section>
        ) : null,
      )}
    </div>
  );
}

/** Intercepts clicks on [[wiki]] links inside rendered Markdown and opens them in the reader. */
function ReaderClicks({ children, onOpenPage }: { children: React.ReactNode; onOpenPage: (slug: string) => void }) {
  return (
    <div
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        const slug = a && pageSlugFromHref(a.getAttribute("href") ?? "");
        if (slug) {
          e.preventDefault();
          onOpenPage(slug);
        }
      }}
    >
      {children}
    </div>
  );
}

function Overlay({ title, eyebrowText, actions, onClose, wide, children }: { title: string; eyebrowText: string; actions?: React.ReactNode; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const isMobile = useIsMobile();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "color-mix(in oklab, var(--ink) 35%, transparent)", backdropFilter: "blur(2px)", zIndex: 110 }} />
      <article
        role="dialog"
        aria-label={title}
        style={{
          position: "fixed",
          top: isMobile ? 0 : 20,
          bottom: isMobile ? 0 : 20,
          left: "50%",
          transform: "translateX(-50%)",
          width: wide ? 1200 : 860,
          maxWidth: isMobile ? "100vw" : "calc(100vw - 32px)",
          background: "var(--surface)",
          borderRadius: isMobile ? 0 : 14,
          boxShadow: "var(--shadow-drawer)",
          zIndex: 111,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={eyebrow}>{eyebrowText}</div>
            <div style={{ font: "650 17px/1.25 var(--font-ui)", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          </div>
          {actions}
          <button onClick={onClose} aria-label="Close" style={iconButton}>
            <Icons.Close size={18} />
          </button>
        </header>
        {children}
      </article>
    </>
  );
}

function useDoc(path: string) {
  const [text, setText] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setText(null);
    setError(null);
    kfetch(`/api/knowledge/doc?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        const body = await res.text();
        if (!res.ok) throw new Error(body.slice(0, 200) || `HTTP ${res.status}`);
        if (live) setText(body);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [path]);
  return { text, error };
}

function MarkdownReader({ path, title, onClose, onOpenPage }: { path: string; title: string; onClose: () => void; onOpenPage: (slug: string) => void }) {
  const { text, error } = useDoc(path);
  const parsed = React.useMemo(() => {
    if (text === null) return null;
    const { meta, body: raw } = parseFrontmatter(text);
    // Feed digests put each post's bare URL on its own line above the stats; make it a link.
    const body = path.startsWith("wiki/") ? raw : raw.replace(/^(https?:\/\/\S+?)\s*$/gm, "[Open post ↗]($1) ·");
    const blocks = parseMarkdown(wikiLinksToMarkdown(body));
    // The page title is shown in the header; drop a matching first # heading.
    const rest = blocks.length && blocks[0].t === "h" && blocks[0].level === 1 ? blocks.slice(1) : blocks;
    return { meta, blocks: rest };
  }, [text, path]);
  return (
    <Overlay title={title} eyebrowText={path.startsWith("wiki/") ? "Wiki page" : "Expert feed"} onClose={onClose}>
      <div style={{ flex: 1, overflow: "auto", padding: "10px 28px 40px" }}>
        {error && <p style={{ color: "var(--accent)", fontSize: 13 }}>Couldn&apos;t load this page: {error}</p>}
        {!parsed && !error && <Muted>Loading…</Muted>}
        {parsed && (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 4px" }}>
              {typeof parsed.meta.updated === "string" && <Chip>Updated {parsed.meta.updated}</Chip>}
              {(parsed.meta.tags ?? []).slice(0, 8).map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
            <ReaderClicks onOpenPage={(slug) => onOpenPage(slug)}>
              {parsed.blocks.map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </ReaderClicks>
          </>
        )}
      </div>
    </Overlay>
  );
}

function HtmlReader({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const { text, error } = useDoc(item.path);
  return (
    <Overlay
      wide
      title={item.title}
      eyebrowText={`Saved ${item.updated ?? ""} · ${kb(item.bytes)}`}
      onClose={onClose}
      actions={
        item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ ...linkish, font: "550 13px var(--font-ui)" }}>
            Open on claude.ai ↗
          </a>
        ) : null
      }
    >
      {item.notes && (
        <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--line)", font: "400 12px/1.45 var(--font-ui)", color: "var(--ink-3)" }}>
          Saved copy: {item.notes}
        </div>
      )}
      {error && <p style={{ color: "var(--accent)", fontSize: 13, padding: 20 }}>Couldn&apos;t load this artifact: {error}</p>}
      {text === null && !error && <Muted style={{ padding: 20 }}>Loading {kb(item.bytes)}…</Muted>}
      {text !== null && (
        // A unique-origin sandbox (no allow-same-origin): the page's scripts run, but they can't
        // read the DAD's storage or cookies.
        <iframe
          title={item.title}
          srcDoc={text}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          style={{ flex: 1, width: "100%", border: 0, borderRadius: "0 0 14px 14px", background: "#fff" }}
        />
      )}
    </Overlay>
  );
}

function Muted({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-3)", ...style }}>{children}</div>;
}

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  padding: 16,
  font: "inherit",
  color: "inherit",
};
const input: React.CSSProperties = {
  font: "400 13.5px var(--font-ui)",
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid var(--line-2)",
  background: "var(--surface)",
  color: "var(--ink)",
  outline: "none",
  minWidth: 0,
  flex: 1,
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontFamily: "var(--font-geist-mono), monospace",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--ink-3)",
};
const listButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 4px",
  border: "none",
  borderTop: "1px solid var(--line)",
  background: "transparent",
  font: "500 13px/1.35 var(--font-ui)",
  color: "var(--ink)",
  textAlign: "left",
  cursor: "pointer",
};
const linkish: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  font: "500 12.5px var(--font-ui)",
  cursor: "pointer",
  textDecoration: "none",
};
const iconButton: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: "transparent",
  border: "1px solid transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "var(--ink)",
};
