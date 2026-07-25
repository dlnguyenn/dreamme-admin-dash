"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, useToast } from "./ui";
import { Icons, type IconName } from "./Icons";
import { CategoryTag, ErrorBanner, Segmented, fam, type Family } from "./porcelain";
import { ResourceAddModal } from "./ResourceAddModal";
import { References } from "./References";
import { API } from "@/lib/supabase";
import { formatRelative } from "@/lib/format";
import type { Resource } from "@/lib/types";

type SubtabId = "library" | "references";
const SUBTAB_KEY = "dreamme.resourcesSubtab";

// One family + glyph per resource type (Porcelain soft tile + matching tag).
const KIND_META: Record<
  "link" | "image",
  { family: Family; icon: IconName; label: string }
> = {
  link: { family: "info", icon: "Link", label: "LINK" },
  image: { family: "accent", icon: "Image", label: "IMAGE" },
};

export function Resources({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Resource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Resource | null>(null);
  const [subtab, setSubtab] = React.useState<SubtabId>("library");

  // Restore persisted subtab on mount.
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(SUBTAB_KEY);
      if (saved === "library" || saved === "references") setSubtab(saved);
    } catch {}
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem(SUBTAB_KEY, subtab);
    } catch {}
  }, [subtab]);

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
        eyebrow="Admin / Ops"
        title="Resources"
        subtitle="Reference images, templates, and external links — curated to help creators ship faster."
        actions={
          isAdmin && subtab === "library" ? (
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

      <div style={{ marginBottom: 20 }}>
        <Segmented
          options={[
            { value: "library", label: "Library" },
            { value: "references", label: "References" },
          ]}
          value={subtab}
          onChange={(v) => setSubtab(v as SubtabId)}
        />
      </div>

      {subtab === "references" && <References isAdmin={isAdmin} />}

      {subtab === "library" && (
        <>
      {error && <ErrorBanner>{error}</ErrorBanner>}

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
              font: "400 13px var(--font-ui)",
              border: "1px solid var(--line-2)",
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
              font: "650 10.5px var(--font-ui)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--ink-3)",
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
          style={{
            padding: 60,
            textAlign: "center",
            color: "var(--ink-3)",
            font: "400 14px var(--font-ui)",
          }}
        >
          Loading resources…
        </div>
      ) : visible.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--line-2)",
            borderRadius: 16,
            color: "var(--ink-3)",
          }}
        >
          <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>
            {rows.length === 0 ? "No resources yet" : "Nothing matches"}
          </div>
          <div style={{ font: "400 13px var(--font-ui)" }}>
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
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
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
  const meta = KIND_META[isLink ? "link" : "image"];
  const f = fam(meta.family);
  const GlyphIcon = Icons[meta.icon];

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        border: `1px solid ${hover ? "var(--line-2)" : "var(--line)"}`,
        borderRadius: 16,
        padding: 18,
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        transition: "border-color 140ms ease",
        position: "relative",
      }}
    >
      {isAdmin && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
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
          display: "flex",
          flexDirection: "column",
          gap: 10,
          textDecoration: "none",
          color: "inherit",
          minHeight: 0,
          flex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: f.soft,
              color: f.text,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <GlyphIcon size={17} />
          </span>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              font: "650 14px/1.35 var(--font-ui)",
              color: "var(--ink)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {resource.title}
          </div>
          <CategoryTag family={meta.family} size={9.5}>
            {meta.label}
          </CategoryTag>
        </div>

        {resource.kind === "image" && resource.imageUrl && (
          <div
            style={{
              aspectRatio: "16 / 10",
              borderRadius: 10,
              overflow: "hidden",
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resource.imageUrl}
              alt={resource.title}
              loading="lazy"
              decoding="async"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        )}

        {resource.description && (
          <div
            style={{
              font: "400 12.5px/1.5 var(--font-ui)",
              color: "var(--ink-2)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
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
            }}
          >
            {resource.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                style={{
                  font: "700 9.5px var(--font-ui)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  padding: "2.5px 7px",
                  borderRadius: 7,
                  border: "1px solid var(--line-2)",
                  background: "transparent",
                }}
              >
                {t}
              </span>
            ))}
            {resource.tags.length > 4 && (
              <span
                style={{
                  font: "400 10.5px var(--font-ui)",
                  color: "var(--ink-4)",
                  alignSelf: "center",
                }}
              >
                +{resource.tags.length - 4}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            font: "400 11.5px var(--font-ui)",
            color: "var(--ink-4)",
            marginTop: "auto",
          }}
        >
          Added {formatRelative(resource.createdAt)}
          {isLink ? ` · ${hostOf(resource.linkUrl)}` : ""}
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
        color: danger ? "var(--danger-text)" : "var(--ink-2)",
        cursor: "pointer",
        boxShadow: "var(--shadow-xs)",
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
