"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, PersonaChip, useCopy, useToast } from "./ui";
import { CharCount } from "./CharCount";
import { SideDrawer } from "./SideDrawer";
import { useIsMobile } from "@/lib/useIsMobile";
import { formatDate, formatTime } from "@/lib/format";
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
  inLibrary: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.caption);
  const { copied, copy } = useCopy();
  const { copied: linkCopied, copy: copyLink } = useCopy();
  const toast = useToast();
  const isMobile = useIsMobile();

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
            padding: isMobile ? "14px 16px" : "18px 24px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: persona.soft,
            paddingTop: isMobile
              ? "calc(14px + env(safe-area-inset-top))"
              : undefined,
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
            padding: isMobile ? "16px" : "24px 28px",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
            style={{
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid var(--line)",
              marginBottom: isMobile ? 16 : 24,
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
              marginBottom: isMobile ? 16 : 24,
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
                  padding: isMobile ? "14px 16px" : "18px 20px",
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "var(--ink-2)",
                  whiteSpace: "pre-wrap",
                  maxHeight: isMobile ? "32vh" : 320,
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
                  minHeight: isMobile ? 180 : 260,
                  maxHeight: isMobile ? "32vh" : undefined,
                  padding: isMobile ? "14px 16px" : "18px 20px",
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
