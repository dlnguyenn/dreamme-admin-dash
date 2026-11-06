"use client";

/**
 * Read-only view of a DAD brief (src/lib/briefs/<slug>.md), opened from a
 * Roadmap card's brief link or straight from ?tab=roadmap&brief=<slug>.
 * The link is the shareable version: anyone with the DAD password can open it.
 */
import * as React from "react";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { parseMarkdown, type Block, type Inline } from "@/lib/mini-markdown";
import { briefLink } from "@/lib/roadmap";

interface Brief {
  slug: string;
  title: string;
  markdown: string;
}

export function BriefReader({ slug, onClose }: { slug: string; onClose: () => void }) {
  const toast = useToast();
  const [brief, setBrief] = React.useState<Brief | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setBrief(null);
    setError(null);
    fetch(`/api/briefs/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (live) setBrief(json.brief as Brief);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [slug]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const blocks = React.useMemo(() => (brief ? parseMarkdown(brief.markdown) : []), [brief]);
  // The page title is the brief's own # heading; don't show it twice.
  const body = blocks.length && blocks[0].t === "h" && blocks[0].level === 1 ? blocks.slice(1) : blocks;

  const copyLink = async () => {
    const link = briefLink(window.location.origin, slug);
    try {
      await navigator.clipboard.writeText(link);
      toast("Brief link copied");
    } catch {
      toast(link);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklab, var(--ink) 35%, transparent)",
          backdropFilter: "blur(2px)",
          zIndex: 110,
        }}
      />
      <article
        role="dialog"
        aria-label={brief?.title ?? "Brief"}
        style={{
          position: "fixed",
          top: 24,
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          width: 820,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--surface)",
          borderRadius: 14,
          boxShadow: "var(--shadow-drawer)",
          zIndex: 111,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={eyebrow}>Brief</div>
            <div className="serif" style={{ fontSize: 22, fontStyle: "italic", lineHeight: 1.2 }}>
              {brief?.title ?? (error ? "Brief unavailable" : "Loading…")}
            </div>
          </div>
          <Button variant="ghost" icon={<Icons.Link />} onClick={copyLink}>
            Copy link
          </Button>
          <button onClick={onClose} aria-label="Close" style={iconButton}>
            <Icons.Close size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 30px 36px" }}>
          {error && (
            <p style={{ color: "var(--accent)", fontSize: 13 }}>
              Couldn&apos;t load this brief: {error}
            </p>
          )}
          {body.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      </article>
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.t) {
    case "h":
      return block.level <= 2 ? (
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>
          <Inlines items={block.children} />
        </h2>
      ) : (
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "18px 0 6px" }}>
          <Inlines items={block.children} />
        </h3>
      );
    case "p":
      return (
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: "10px 0", color: "var(--ink)" }}>
          <Inlines items={block.children} />
        </p>
      );
    case "ul":
    case "ol": {
      const Tag = block.t;
      return (
        <Tag style={{ fontSize: 14, lineHeight: 1.6, margin: "8px 0", paddingLeft: 22 }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ margin: "4px 0" }}>
              <Inlines items={it.children} />
              {it.sub && <BlockView block={it.sub} />}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div style={{ overflowX: "auto", margin: "12px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
            <thead>
              <tr>
                {block.head.map((c, i) => (
                  <th key={i} style={{ ...cell, fontWeight: 600, background: "var(--surface-2)", textAlign: "left" }}>
                    <Inlines items={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} style={cell}>
                      <Inlines items={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((x, i) => {
        if (x.t === "text") return <React.Fragment key={i}>{x.v}</React.Fragment>;
        if (x.t === "strong") return <strong key={i}>{x.v}</strong>;
        if (x.t === "code")
          return (
            <code
              key={i}
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "0.88em",
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                padding: "0 4px",
              }}
            >
              {x.v}
            </code>
          );
        const external = /^https?:/i.test(x.href);
        return (
          <a
            key={i}
            href={x.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            style={{ color: "var(--accent)" }}
          >
            <Inlines items={x.children} />
          </a>
        );
      })}
    </>
  );
}

const cell: React.CSSProperties = {
  border: "1px solid var(--line)",
  padding: "7px 10px",
  verticalAlign: "top",
  lineHeight: 1.45,
};

const eyebrow: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--font-geist-mono), monospace",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--ink-3)",
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
};
