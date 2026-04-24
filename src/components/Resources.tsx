"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, useToast } from "./ui";
import { Icons } from "./Icons";
import { ResourceAddModal } from "./ResourceAddModal";
import { API } from "@/lib/supabase";
import { formatRelative } from "@/lib/format";
import type { Resource } from "@/lib/types";

export function Resources({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Resource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Resource | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const data = await API.fetchResources();
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const allTags = React.useMemo(() => {
    const set = new Map<string, number>();
    for (const r of rows) {
      for (const t of r.tags) set.set(t, (set.get(t) ?? 0) + 1);
    }
    return Array.from(set.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
  }, [rows]);

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeTag && !r.tags.includes(activeTag)) return false;
      if (q) {
        const hay = `${r.title} ${r.description} ${r.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, activeTag]);

  const onSaved = (saved: Resource) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx === -1) return [saved, ...prev];
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
    setAddOpen(false);
    setEditing(null);
  };

  const onDelete = async (resource: Resource) => {
    if (
      !window.confirm(
        `Delete "${resource.title}"? This can't be undone.`,
      )
    )
      return;
    try {
      await API.deleteResource(resource.id);
      setRows((prev) => prev.filter((r) => r.id !== resource.id));
      toast("Resource deleted");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Creator toolkit"
        title={<em>Resources</em>}
        subtitle="Reference images, templates, and external links — curated to help creators ship faster."
        tint="color-mix(in oklab, var(--p-olivia) 45%, transparent)"
        actions={
          isAdmin ? (
            <Button
              variant="primary"
              icon={<Icons.Plus />}
              onClick={() => setAddOpen(true)}
            >
              Add resource
            </Button>
          ) : null
        }
      />

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background:
              "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: "1 1 280px",
            minWidth: 220,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--ink-4)",
              pointerEvents: "none",
            }}
          >
            <Icons.Search size={15} />
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, tag…"
            style={{
              width: "100%",
              padding: "10px 12px 10px 32px",
              fontSize: 13,
              fontFamily: "inherit",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--surface)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
        </div>
      </div>

      {allTags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 24,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--ink-4)",
              marginRight: 4,
            }}
          >
            Tag
          </span>
          <Chip
            tone={!activeTag ? "ink" : "neutral"}
            onClick={() => setActiveTag(null)}
          >
            All
          </Chip>
          {allTags.map((t) => (
            <Chip
              key={t}
              tone={activeTag === t ? "ink" : "neutral"}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
            >
              {t}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div
          style={{ padding: 60, textAlign: "center", color: "var(--ink-3)" }}
        >
          <div className="serif" style={{ fontSize: 20, fontStyle: "italic" }}>
            Loading resources…
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--line)",
            borderRadius: 14,
            color: "var(--ink-3)",
          }}
        >
          <div
            className="serif"
            style={{ fontSize: 22, fontStyle: "italic", marginBottom: 6 }}
          >
            {rows.length === 0 ? "No resources yet" : "Nothing matches"}
          </div>
          <div style={{ fontSize: 13 }}>
            {rows.length === 0
              ? isAdmin
                ? "Add reference images, drive links, or templates to get started."
                : "An admin hasn't added anything here yet — check back soon."
              : "Try a different search term or tag."}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {visible.map((r) => (
            <ResourceCard
              key={r.id}
              resource={r}
              isAdmin={isAdmin}
              onEdit={() => setEditing(r)}
              onDelete={() => onDelete(r)}
            />
          ))}
        </div>
      )}

      {(addOpen || editing) && (
        <ResourceAddModal
          resource={editing}
          onClose={() => {
            setAddOpen(false);
            setEditing(null);
          }}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function ResourceCard({
  resource,
  isAdmin,
  onEdit,
  onDelete,
}: {
  resource: Resource;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const isLink = resource.kind === "link";
  const href = isLink ? resource.linkUrl ?? "#" : resource.imageUrl ?? "#";

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--surface)",
        overflow: "hidden",
        transition: "transform 180ms ease, box-shadow 180ms ease",
        transform: hover ? "translateY(-2px)" : "none",
        boxShadow: hover ? "var(--shadow-lg)" : "var(--shadow-sm)",
        position: "relative",
      }}
    >
      {isAdmin && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            gap: 4,
            zIndex: 2,
            opacity: hover ? 1 : 0,
            transition: "opacity 140ms ease",
          }}
        >
          <CardIconButton title="Edit" onClick={onEdit}>
            <Icons.Edit size={14} />
          </CardIconButton>
          <CardIconButton title="Delete" onClick={onDelete} danger>
            <Icons.Trash size={14} />
          </CardIconButton>
        </div>
      )}

      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        style={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div
          style={{
            aspectRatio: "16 / 10",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {resource.kind === "image" && resource.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resource.imageUrl}
              alt={resource.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: 20,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background:
                    "color-mix(in oklab, var(--p-andrea) 20%, var(--surface))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--ink-2)",
                }}
              >
                <Icons.Link size={24} />
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  wordBreak: "break-all",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {hostOf(resource.linkUrl)}
              </div>
            </div>
          )}
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
            }}
          >
            <Chip tone={isLink ? "neutral" : "ink"}>
              {isLink ? "Link" : "Image"}
            </Chip>
          </div>
        </div>

        <div
          style={{
            padding: "12px 14px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontWeight: 500,
              fontSize: 14,
              lineHeight: 1.35,
              color: "var(--ink)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {resource.title}
          </div>
          {resource.description && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-3)",
                lineHeight: 1.45,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
            >
              {resource.description}
            </div>
          )}
          {resource.tags.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginTop: 4,
              }}
            >
              {resource.tags.slice(0, 4).map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-geist-mono), monospace",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--ink-3)",
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {t}
                </span>
              ))}
              {resource.tags.length > 4 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--ink-4)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  +{resource.tags.length - 4}
                </span>
              )}
            </div>
          )}
          <div
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              fontFamily: "var(--font-geist-mono), monospace",
              marginTop: 4,
            }}
          >
            Added {formatRelative(resource.createdAt)}
          </div>
        </div>
      </a>
    </div>
  );
}

function CardIconButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      style={{
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--surface)",
        color: danger ? "var(--accent)" : "var(--ink-2)",
        cursor: "pointer",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {children}
    </button>
  );
}

function hostOf(url: string | null): string {
  if (!url) return "external link";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "external link";
  }
}
