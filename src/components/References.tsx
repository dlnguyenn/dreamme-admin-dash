"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { API } from "@/lib/supabase";
import { formatRelative } from "@/lib/format";
import type { ResourceReference, ReferenceSlide } from "@/lib/types";

export function References({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<ResourceReference[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const data = await API.fetchReferences();
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

  const handleCreated = (ref: ResourceReference) => {
    setRows((prev) => [ref, ...prev]);
    setAddOpen(false);
  };

  const handleUpdate = (updated: ResourceReference) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleDelete = async (ref: ResourceReference) => {
    if (
      !window.confirm(
        `Delete this reference? All slide images will be removed. This can't be undone.`,
      )
    )
      return;
    try {
      await API.deleteReference(ref.id);
      setRows((prev) => prev.filter((r) => r.id !== ref.id));
      toast("Reference deleted");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      {isAdmin && (
        <div style={{ marginBottom: 18 }}>
          <Button
            variant="primary"
            icon={<Icons.Plus />}
            onClick={() => setAddOpen(true)}
          >
            Add reference
          </Button>
        </div>
      )}

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

      {loading ? (
        <div
          style={{ padding: 60, textAlign: "center", color: "var(--ink-3)" }}
        >
          <div className="serif" style={{ fontSize: 20, fontStyle: "italic" }}>
            Loading references…
          </div>
        </div>
      ) : rows.length === 0 ? (
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
            No references yet
          </div>
          <div style={{ fontSize: 13 }}>
            {isAdmin
              ? "Paste a TikTok slideshow URL to scrape its slides into our library."
              : "An admin hasn't added any TikTok references yet — check back soon."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {rows.map((r) => (
            <ReferenceCard
              key={r.id}
              reference={r}
              isAdmin={isAdmin}
              onUpdate={handleUpdate}
              onDelete={() => handleDelete(r)}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddReferenceModal
          onClose={() => setAddOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}

function ReferenceCard({
  reference,
  isAdmin,
  onUpdate,
  onDelete,
}: {
  reference: ResourceReference;
  isAdmin: boolean;
  onUpdate: (r: ResourceReference) => void;
  onDelete: () => void;
}) {
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(reference.title);

  React.useEffect(() => {
    setTitleDraft(reference.title);
  }, [reference.title]);

  const saveTitle = async () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === reference.title) {
      setTitleDraft(reference.title);
      return;
    }
    try {
      const updated = await API.updateReference(reference.id, { title: next });
      onUpdate(updated);
    } catch (e) {
      console.error(e);
      setTitleDraft(reference.title);
    }
  };

  const saveSlideNote = React.useCallback(
    async (index: number, note: string) => {
      const current = reference.slides;
      if (current[index]?.note === note) return;
      const nextSlides: ReferenceSlide[] = current.map((s, i) =>
        i === index ? { ...s, note } : s,
      );
      try {
        const updated = await API.updateReference(reference.id, {
          slides: nextSlides,
        });
        onUpdate(updated);
      } catch (e) {
        console.error(e);
      }
    },
    [reference.id, reference.slides, onUpdate],
  );

  const author = reference.authorUsername
    ? `@${reference.authorUsername}`
    : "TikTok creator";
  const captionExcerpt = reference.caption.slice(0, 220);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 260px) 1fr",
        gap: 18,
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--surface)",
        padding: 16,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Left: meta */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minWidth: 0,
        }}
      >
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setTitleDraft(reference.title);
                setEditingTitle(false);
              }
            }}
            style={{
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "inherit",
              padding: "6px 8px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface-2)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
        ) : (
          <div
            onClick={() => isAdmin && setEditingTitle(true)}
            style={{
              fontWeight: 500,
              fontSize: 14,
              lineHeight: 1.35,
              color: "var(--ink)",
              cursor: isAdmin ? "text" : "default",
              wordBreak: "break-word",
            }}
            title={isAdmin ? "Click to rename" : undefined}
          >
            {reference.title}
          </div>
        )}

        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--ink-4)",
          }}
        >
          {author} · {reference.slides.length} slide
          {reference.slides.length === 1 ? "" : "s"}
        </div>

        {captionExcerpt && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-3)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 140,
              overflow: "hidden",
            }}
          >
            {captionExcerpt}
            {reference.caption.length > captionExcerpt.length ? "…" : ""}
          </div>
        )}

        <a
          href={reference.tiktokUrl}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--ink-2)",
            textDecoration: "none",
            padding: "6px 10px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--surface-2)",
            alignSelf: "flex-start",
          }}
        >
          <Icons.Link size={13} />
          Open on TikTok
        </a>

        <div
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
            marginTop: "auto",
          }}
        >
          Added {formatRelative(reference.createdAt)}
        </div>

        {isAdmin && (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setEditingTitle(true)}
              title="Edit title"
              style={iconBtnStyle(false)}
            >
              <Icons.Edit size={13} />
            </button>
            <button
              onClick={onDelete}
              title="Delete reference"
              style={iconBtnStyle(true)}
            >
              <Icons.Trash size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Right: carousel */}
      <div
        style={{
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          paddingBottom: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            minWidth: "min-content",
          }}
        >
          {reference.slides.map((slide, i) => (
            <SlideTile
              key={i}
              slide={slide}
              index={i}
              isAdmin={isAdmin}
              onSaveNote={saveSlideNote}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SlideTile({
  slide,
  index,
  isAdmin,
  onSaveNote,
}: {
  slide: ReferenceSlide;
  index: number;
  isAdmin: boolean;
  onSaveNote: (index: number, note: string) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState(slide.note);

  React.useEffect(() => {
    setDraft(slide.note);
  }, [slide.note]);

  const commit = () => {
    if (draft !== slide.note) {
      void onSaveNote(index, draft);
    }
  };

  return (
    <div
      style={{
        flex: "0 0 auto",
        width: 200,
        scrollSnapAlign: "start",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 16",
          borderRadius: 10,
          overflow: "hidden",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slide.imageUrl}
          alt={`Slide ${index + 1}`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            fontSize: 10,
            fontFamily: "var(--font-geist-mono), monospace",
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.55)",
            color: "white",
            letterSpacing: "0.06em",
          }}
        >
          {index + 1}
        </div>
      </div>
      {isAdmin ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          placeholder="Note for creators…"
          rows={3}
          style={{
            width: "100%",
            fontSize: 12,
            fontFamily: "inherit",
            padding: "6px 8px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--surface-2)",
            color: "var(--ink)",
            resize: "vertical",
            minHeight: 56,
            outline: "none",
            lineHeight: 1.4,
          }}
        />
      ) : slide.note ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.45,
            padding: "6px 8px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--surface-2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            minHeight: 56,
          }}
        >
          {slide.note}
        </div>
      ) : (
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            fontStyle: "italic",
            padding: "6px 8px",
            minHeight: 56,
          }}
        >
          No note
        </div>
      )}
    </div>
  );
}

function iconBtnStyle(danger: boolean): React.CSSProperties {
  return {
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
  };
}

function AddReferenceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (ref: ResourceReference) => void;
}) {
  const [url, setUrl] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const ref = await API.createReference({ tiktokUrl: trimmed });
      onCreated(ref);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          borderRadius: 16,
          border: "1px solid var(--line)",
          padding: 24,
          width: "100%",
          maxWidth: 520,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          className="serif"
          style={{ fontSize: 22, fontStyle: "italic", color: "var(--ink)" }}
        >
          Add reference
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
          Paste a TikTok slideshow URL. We&rsquo;ll scrape every slide image
          into our library so the creators always see them, even after the
          original post expires.
        </div>
        <input
          type="url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitting) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="https://www.tiktok.com/@creator/photo/..."
          disabled={submitting}
          style={{
            padding: "10px 12px",
            fontSize: 13,
            fontFamily: "inherit",
            border: "1px solid var(--line)",
            borderRadius: 10,
            background: "var(--surface-2)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        {error && (
          <div
            style={{
              padding: "8px 12px",
              fontSize: 12.5,
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
        {submitting && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Scraping slides… this can take 5–15 seconds.
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={submitting || !url.trim()}
          >
            {submitting ? "Scraping…" : "Add"}
          </Button>
        </div>
      </div>
    </div>
  );
}
