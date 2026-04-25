"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, PersonaChip, useCopy, useToast } from "./ui";
import { CharCount } from "./CharCount";
import { SideDrawer } from "./SideDrawer";
import { useIsMobile } from "@/lib/useIsMobile";
import { formatDate, formatTime, formatRelative } from "@/lib/format";
import type { Delivery } from "@/lib/types";
import type { Persona } from "@/lib/personas";

const TIKTOK_LIMIT = 4000;

export function DetailDrawer({
  item,
  persona,
  onClose,
  onUpdate,
  onSaveToLibrary,
  onCopyLink,
  onDelete,
  onModifyImage,
  onGenerateInstagram,
  onGenerateBeforeCaption,
  inLibrary,
}: {
  item: Delivery;
  persona: Persona;
  onClose: () => void;
  onUpdate: (patch: Partial<Delivery>) => void;
  onSaveToLibrary: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onModifyImage: () => void;
  onGenerateInstagram?: () => void;
  onGenerateBeforeCaption?: () => void;
  inLibrary: boolean;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <MobileDetail
        item={item}
        persona={persona}
        onClose={onClose}
        onUpdate={onUpdate}
        onSaveToLibrary={onSaveToLibrary}
        onCopyLink={onCopyLink}
        onDelete={onDelete}
        onModifyImage={onModifyImage}
        onGenerateInstagram={onGenerateInstagram}
        onGenerateBeforeCaption={onGenerateBeforeCaption}
        inLibrary={inLibrary}
      />
    );
  }
  return (
    <DesktopDetail
      item={item}
      persona={persona}
      onClose={onClose}
      onUpdate={onUpdate}
      onSaveToLibrary={onSaveToLibrary}
      onCopyLink={onCopyLink}
      onDelete={onDelete}
      onModifyImage={onModifyImage}
      onGenerateInstagram={onGenerateInstagram}
      onGenerateBeforeCaption={onGenerateBeforeCaption}
      inLibrary={inLibrary}
    />
  );
}

/* ------------------------------------------------------------------ */
/* MOBILE — full-screen iOS-style modal                                */
/* ------------------------------------------------------------------ */

function MobileDetail({
  item,
  persona,
  onClose,
  onUpdate,
  onSaveToLibrary,
  onCopyLink,
  onDelete,
  onModifyImage,
  onGenerateInstagram,
  onGenerateBeforeCaption,
  inLibrary,
}: {
  item: Delivery;
  persona: Persona;
  onClose: () => void;
  onUpdate: (patch: Partial<Delivery>) => void;
  onSaveToLibrary: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onModifyImage: () => void;
  onGenerateInstagram?: () => void;
  onGenerateBeforeCaption?: () => void;
  inLibrary: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.caption);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const { copied, copy } = useCopy();
  const toast = useToast();

  React.useEffect(() => {
    setDraft(item.caption);
    setEditing(false);
  }, [item.id, item.caption]);

  const chars = draft.length;
  const overLimit = chars > TIKTOK_LIMIT;

  const save = () => {
    onUpdate({ caption: draft });
    setEditing(false);
    toast("Caption updated");
  };

  // The floating overlay buttons sit above the notch safe area. Matches the
  // mockup's iOS pattern where Close and More float over the hero image.
  const overlayBtn: React.CSSProperties = {
    width: 40,
    height: 40,
    minHeight: 40,
    borderRadius: 999,
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid color-mix(in oklab, var(--ink) 6%, transparent)",
    color: "var(--ink)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };

  return (
    <SideDrawer
      open={true}
      onClose={onClose}
      side="right"
      ariaLabel="Delivery detail"
    >
      {/* Top floating controls — Close left, More right. Sit above the
          status bar so they never collide with the notch. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          padding: "calc(10px + env(safe-area-inset-top)) 10px 0",
          display: "flex",
          alignItems: "center",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ ...overlayBtn, pointerEvents: "auto" }}
        >
          <Icons.Close size={20} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="More actions"
          style={{ ...overlayBtn, pointerEvents: "auto" }}
        >
          <Icons.MoreVertical size={20} />
        </button>
      </div>

      {/* Scroll area — image at top, caption below. */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Full-bleed hero */}
        <div style={{ position: "relative", background: persona.soft }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt=""
            style={{
              width: "100%",
              display: "block",
              aspectRatio: "4/5",
              objectFit: "cover",
            }}
          />

          {/* Persona + time chip, bottom-left */}
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px 6px 6px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <PersonaChip persona={persona} size="sm" />
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink)",
                  lineHeight: 1.1,
                }}
              >
                {persona.name}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--ink-3)",
                  lineHeight: 1.1,
                  marginTop: 2,
                }}
              >
                {formatRelative(item.createdAt)}
              </div>
            </div>
          </div>

          {/* Star toggle, bottom-right */}
          <button
            onClick={() => onUpdate({ starred: !item.starred })}
            aria-label={item.starred ? "Unstar" : "Star"}
            style={{
              position: "absolute",
              bottom: 12,
              right: 12,
              width: 40,
              height: 40,
              minHeight: 40,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "none",
              color: item.starred ? "var(--accent)" : "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {item.starred ? (
              <Icons.StarFilled size={18} />
            ) : (
              <Icons.Star size={18} />
            )}
          </button>
        </div>

        {/* Caption block — serif body, scrolls under sticky action bar. */}
        <div style={{ padding: "20px 18px 24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--ink-4)",
              }}
            >
              Caption
            </div>
            <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            <CharCount chars={chars} limit={TIKTOK_LIMIT} />
          </div>

          {!editing ? (
            <div
              className="serif"
              style={{
                fontSize: 16,
                lineHeight: 1.6,
                color: "var(--ink)",
                fontStyle: "italic",
                whiteSpace: "pre-wrap",
              }}
            >
              {draft}
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                minHeight: 200,
                maxHeight: "34vh",
                padding: "12px 14px",
                fontSize: 15,
                lineHeight: 1.6,
                fontFamily: "var(--font-newsreader), Georgia, serif",
                fontStyle: "italic",
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                outline: "none",
                resize: "vertical",
                color: "var(--ink)",
              }}
            />
          )}

          {editing && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button
                size="sm"
                variant="primary"
                icon={<Icons.Check />}
                onClick={save}
                disabled={overLimit}
              >
                Save caption
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(item.caption);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* Bottom spacer so sticky action bar never clips the last line of
            the caption when it's long. */}
        <div style={{ height: 16 }} />
      </div>

      {/* Sticky action bar — 3 verbs, always thumb-reachable. */}
      <div
        style={{
          padding:
            "12px 14px calc(16px + env(safe-area-inset-bottom))",
          background:
            "color-mix(in oklab, var(--surface) 95%, transparent)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid var(--line)",
          display: "flex",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => {
            onUpdate({ posted: !item.posted });
            toast(item.posted ? "Marked as unposted" : "Marked as posted");
          }}
          style={{
            flex: 1,
            height: 48,
            minHeight: 48,
            borderRadius: 14,
            background: item.posted
              ? "var(--p-olivia-soft)"
              : "var(--surface-2)",
            border: "1px solid",
            borderColor: item.posted
              ? "color-mix(in oklab, var(--p-olivia) 40%, var(--line-2))"
              : "var(--line-2)",
            fontSize: 13,
            fontWeight: 600,
            color: item.posted
              ? "color-mix(in oklab, var(--p-olivia) 60%, var(--ink))"
              : "var(--ink-2)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <Icons.Check size={16} /> {item.posted ? "Posted" : "Mark posted"}
        </button>
        <button
          onClick={onSaveToLibrary}
          disabled={inLibrary}
          style={{
            flex: 1,
            height: 48,
            minHeight: 48,
            borderRadius: 14,
            background: "var(--surface-2)",
            border: "1px solid var(--line-2)",
            fontSize: 13,
            fontWeight: 600,
            color: inLibrary ? "var(--ink-3)" : "var(--ink-2)",
            opacity: inLibrary ? 0.7 : 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor: inLibrary ? "default" : "pointer",
          }}
        >
          {inLibrary ? (
            <Icons.BookmarkFilled size={16} />
          ) : (
            <Icons.Bookmark size={16} />
          )}{" "}
          {inLibrary ? "Saved" : "Save"}
        </button>
        <button
          onClick={() => {
            copy(draft);
            toast("Caption copied");
          }}
          style={{
            flex: 1.4,
            height: 48,
            minHeight: 48,
            borderRadius: 14,
            background: "var(--ink)",
            color: "var(--surface)",
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          {copied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}{" "}
          {copied ? "Copied" : "Copy caption"}
        </button>
      </div>

      {moreOpen && (
        <MoreActionsPopover
          onClose={() => setMoreOpen(false)}
          onEdit={() => {
            setEditing(true);
            setMoreOpen(false);
          }}
          onModifyImage={() => {
            onModifyImage();
            setMoreOpen(false);
          }}
          onOpenImage={() => {
            window.open(item.imageUrl, "_blank");
            setMoreOpen(false);
          }}
          onCopyLink={() => {
            const url = `${window.location.origin}/item/${item.id}`;
            navigator.clipboard?.writeText(url).catch(() => {});
            onCopyLink();
            toast("Link copied");
            setMoreOpen(false);
          }}
          onDelete={() => {
            setMoreOpen(false);
            onDelete();
          }}
          onGenerateInstagram={
            onGenerateInstagram && !item.isBefore
              ? () => {
                  setMoreOpen(false);
                  onGenerateInstagram();
                }
              : undefined
          }
          onGenerateBeforeCaption={
            onGenerateBeforeCaption && item.isBefore
              ? () => {
                  setMoreOpen(false);
                  onGenerateBeforeCaption();
                }
              : undefined
          }
        />
      )}
    </SideDrawer>
  );
}

function MoreActionsPopover({
  onClose,
  onEdit,
  onModifyImage,
  onOpenImage,
  onCopyLink,
  onDelete,
  onGenerateInstagram,
  onGenerateBeforeCaption,
}: {
  onClose: () => void;
  onEdit: () => void;
  onModifyImage: () => void;
  onOpenImage: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onGenerateInstagram?: () => void;
  onGenerateBeforeCaption?: () => void;
}) {
  // Anchored below the top-right More button. Tap outside (scrim) to close.
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 25,
          background: "transparent",
        }}
      />
      <div
        role="menu"
        style={{
          position: "absolute",
          top: "calc(56px + env(safe-area-inset-top))",
          right: 14,
          zIndex: 26,
          minWidth: 200,
          padding: 6,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          boxShadow: "var(--shadow-md)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <MoreItem icon={<Icons.Edit size={16} />} label="Edit caption" onClick={onEdit} />
        {onGenerateInstagram && (
          <MoreItem
            icon={<Icons.Sparkles size={16} />}
            label="Generate IG caption"
            onClick={onGenerateInstagram}
          />
        )}
        {onGenerateBeforeCaption && (
          <MoreItem
            icon={<Icons.Sparkles size={16} />}
            label="Generate caption"
            onClick={onGenerateBeforeCaption}
          />
        )}
        <MoreItem
          icon={<Icons.Sparkles size={16} />}
          label="Modify image"
          onClick={onModifyImage}
        />
        <MoreItem
          icon={<Icons.Download size={16} />}
          label="Open image"
          onClick={onOpenImage}
        />
        <MoreItem
          icon={<Icons.Link size={16} />}
          label="Copy share link"
          onClick={onCopyLink}
        />
        <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
        <MoreItem
          icon={<Icons.Trash size={16} />}
          label="Delete"
          onClick={onDelete}
          tone="danger"
        />
      </div>
    </>
  );
}

function MoreItem({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 10px",
        background: "transparent",
        border: "none",
        borderRadius: 8,
        fontSize: 14,
        color: tone === "danger" ? "var(--accent)" : "var(--ink-2)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* DESKTOP — unchanged from pre-redesign                               */
/* ------------------------------------------------------------------ */

function DesktopDetail({
  item,
  persona,
  onClose,
  onUpdate,
  onSaveToLibrary,
  onCopyLink,
  onDelete,
  onModifyImage,
  onGenerateInstagram,
  onGenerateBeforeCaption,
  inLibrary,
}: {
  item: Delivery;
  persona: Persona;
  onClose: () => void;
  onUpdate: (patch: Partial<Delivery>) => void;
  onSaveToLibrary: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onModifyImage: () => void;
  onGenerateInstagram?: () => void;
  onGenerateBeforeCaption?: () => void;
  inLibrary: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.caption);
  const { copied, copy } = useCopy();
  const { copied: linkCopied, copy: copyLink } = useCopy();
  const toast = useToast();

  React.useEffect(() => {
    setDraft(item.caption);
    setEditing(false);
  }, [item.id, item.caption]);

  const chars = draft.length;
  const overLimit = chars > TIKTOK_LIMIT;
  const save = () => {
    onUpdate({ caption: draft });
    setEditing(false);
    toast("Caption updated");
  };

  return (
    <SideDrawer
      open={true}
      onClose={onClose}
      side="right"
      desktopWidth={720}
      ariaLabel="Delivery detail"
    >
      <div
        style={{
          padding: "18px 24px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: persona.soft,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <PersonaChip persona={persona} size="md" />
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {formatDate(item.createdAt)} · {formatTime(item.createdAt)}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "transparent",
            border: "1px solid transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icons.Close size={18} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "24px 28px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          style={{
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid var(--line)",
            marginBottom: 24,
            background: persona.soft,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt=""
            style={{
              width: "100%",
              display: "block",
              aspectRatio: "4/5",
              objectFit: "cover",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          <Button
            icon={item.starred ? <Icons.StarFilled /> : <Icons.Star />}
            onClick={() => onUpdate({ starred: !item.starred })}
            style={
              item.starred
                ? {
                    color: "var(--accent)",
                    borderColor:
                      "color-mix(in oklab, var(--accent) 30%, var(--line-2))",
                  }
                : undefined
            }
          >
            {item.starred ? "Starred" : "Star"}
          </Button>
          <Button
            icon={item.posted ? <Icons.Check /> : <Icons.Bookmark />}
            onClick={() => {
              onUpdate({ posted: !item.posted });
              toast(item.posted ? "Marked as unposted" : "Marked as posted");
            }}
            style={
              item.posted
                ? {
                    color:
                      "color-mix(in oklab, var(--p-olivia) 60%, var(--ink))",
                    borderColor:
                      "color-mix(in oklab, var(--p-olivia) 40%, var(--line-2))",
                  }
                : undefined
            }
          >
            {item.posted ? "Posted" : "Mark as posted"}
          </Button>
          <Button
            icon={<Icons.Download />}
            onClick={() => {
              window.open(item.imageUrl, "_blank");
            }}
          >
            Open image
          </Button>
          <Button
            icon={linkCopied ? <Icons.Check /> : <Icons.Link />}
            onClick={() => {
              const url = `${window.location.origin}/item/${item.id}`;
              copyLink(url);
              onCopyLink();
            }}
          >
            {linkCopied ? "Link copied" : "Copy link"}
          </Button>
          <Button
            variant="secondary"
            icon={<Icons.Sparkles />}
            onClick={onModifyImage}
          >
            Modify image
          </Button>
          <Button
            variant="danger"
            icon={<Icons.Trash />}
            onClick={onDelete}
            style={{ marginLeft: "auto" }}
          >
            Delete
          </Button>
        </div>

        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 14,
            background: "var(--surface-2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--surface)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 2,
                }}
              >
                Caption
              </div>
              <div
                className="serif"
                style={{
                  fontSize: 18,
                  fontWeight: 400,
                  fontStyle: "italic",
                }}
              >
                Long-form · TikTok
              </div>
            </div>
            <CharCount chars={chars} limit={TIKTOK_LIMIT} />
          </div>
          {!editing ? (
            <div
              style={{
                padding: "18px 20px",
                fontSize: 14,
                lineHeight: 1.7,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
                maxHeight: 320,
                overflow: "auto",
              }}
            >
              {draft}
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                minHeight: 260,
                padding: "18px 20px",
                fontSize: 14,
                lineHeight: 1.7,
                fontFamily: "var(--font-geist), sans-serif",
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "vertical",
                color: "var(--ink)",
              }}
            />
          )}
          <div
            style={{
              padding: "12px 14px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
              alignItems: "center",
              background: "var(--surface)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              {!editing ? (
                <Button
                  size="sm"
                  icon={<Icons.Edit />}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Icons.Check />}
                    onClick={save}
                    disabled={overLimit}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDraft(item.caption);
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {onGenerateInstagram && !item.isBefore && (
                <Button
                  size="sm"
                  icon={<Icons.Sparkles />}
                  onClick={onGenerateInstagram}
                >
                  IG caption
                </Button>
              )}
              {onGenerateBeforeCaption && item.isBefore && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Icons.Sparkles />}
                  onClick={onGenerateBeforeCaption}
                >
                  Generate caption
                </Button>
              )}
              <Button
                size="sm"
                icon={copied ? <Icons.Check /> : <Icons.Copy />}
                onClick={() => {
                  copy(draft);
                  toast("Copied to clipboard");
                }}
              >
                {copied ? "Copied" : "Copy caption"}
              </Button>
              <Button
                size="sm"
                variant={inLibrary ? "secondary" : "primary"}
                icon={inLibrary ? <Icons.BookmarkFilled /> : <Icons.Plus />}
                onClick={onSaveToLibrary}
                disabled={inLibrary}
              >
                {inLibrary ? "In library" : "Save to library"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SideDrawer>
  );
}
