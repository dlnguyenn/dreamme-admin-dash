"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, PersonaChip, useCopy, useToast } from "./ui";
import { CharCount } from "./CharCount";
import { SideDrawer } from "./SideDrawer";
import { useIsMobile } from "@/lib/useIsMobile";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { MODELS, MODEL_LABELS, type ModelId } from "@/lib/models";
import { INSTAGRAM_CHAR_CEILING } from "@/lib/prompts/instagramCaption";
import { API } from "@/lib/supabase";
import type { SavedCaption } from "@/lib/types";

/**
 * Dialog for generating an Instagram caption from a hook (or a hook-shaped
 * seed). Opened from four surfaces: HookAnalytics hook cards, Caption
 * Library rows, ContentCard menus, and DetailDrawer footers.
 *
 * `seedHookText` is the text the generator uses as the emotional anchor.
 * For hook-linked surfaces this is the hook's actual text. For Delivery
 * surfaces it's the delivery's existing TikTok caption, which the user
 * picked as the fallback seed when no hook is available.
 */
export function InstagramCaptionDialog({
  open,
  onClose,
  personaId,
  seedHookText,
  sourceHookId = null,
  sourceDeliveryId = null,
  seedPreview,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  personaId: PersonaId;
  seedHookText: string;
  sourceHookId?: string | null;
  sourceDeliveryId?: string | null;
  /** Short label shown in the header — defaults to the seed hook text. */
  seedPreview?: string;
  onSaved?: (row: SavedCaption) => void;
}) {
  const persona = PERSONAS[personaId];
  const toast = useToast();
  const { copied, copy } = useCopy();
  const isMobile = useIsMobile();

  const [isAdmin] = React.useState<boolean>(() => {
    try {
      return sessionStorage.getItem("dreamme.role") === "admin";
    } catch {
      return false;
    }
  });
  const [model, setModel] = React.useState<ModelId>(MODELS.SONNET_4_6);
  const [notes, setNotes] = React.useState("");

  type Status = "idle" | "generating" | "preview" | "saving";
  const [status, setStatus] = React.useState<Status>("idle");
  const [caption, setCaption] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset on open/close.
  React.useEffect(() => {
    if (!open) {
      setStatus("idle");
      setCaption("");
      setDraft("");
      setEditing(false);
      setError(null);
      setNotes("");
    }
  }, [open]);

  const busy = status === "generating" || status === "saving";
  const chars = (editing ? draft : caption).length;
  const overLimit = chars > INSTAGRAM_CHAR_CEILING;
  const hasCaption = caption.length > 0;

  const generate = async () => {
    setStatus("generating");
    setError(null);
    try {
      const out = await API.generateInstagramCaption({
        personaId,
        hookText: seedHookText,
        model,
        notes: notes.trim() || undefined,
      });
      setCaption(out.caption);
      setDraft(out.caption);
      setEditing(false);
      setStatus("preview");
    } catch (e) {
      setError((e as Error).message);
      setStatus(hasCaption ? "preview" : "idle");
    }
  };

  const save = async () => {
    const final = (editing ? draft : caption).trim();
    if (!final || final.length > INSTAGRAM_CHAR_CEILING) return;
    setStatus("saving");
    setError(null);
    try {
      const row = await API.saveGeneratedCaption({
        personaId,
        caption: final,
        model,
        platform: "instagram",
        hookId: sourceHookId,
        deliveryId: sourceDeliveryId,
        notes: notes.trim() || undefined,
        tipPoolAware: false,
      });
      toast("Instagram caption saved");
      onSaved?.(row);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setStatus("preview");
    }
  };

  const saveEdit = () => {
    setCaption(draft);
    setEditing(false);
  };
  const cancelEdit = () => {
    setDraft(caption);
    setEditing(false);
  };

  const headerPreview = seedPreview ?? seedHookText;

  return (
    <SideDrawer
      open={open}
      onClose={busy ? () => {} : onClose}
      side="right"
      desktopWidth={720}
      ariaLabel="Generate Instagram caption"
    >
      {/* Header */}
      <div
        style={{
          padding: isMobile ? "14px 16px" : "18px 24px",
          paddingTop: isMobile
            ? "calc(14px + env(safe-area-inset-top))"
            : undefined,
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: persona.soft,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}
        >
          <PersonaChip persona={persona} size="md" />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--ink-4)",
                marginBottom: 2,
              }}
            >
              Instagram caption
            </div>
            <div
              className="serif"
              style={{
                fontSize: 18,
                fontWeight: 400,
                lineHeight: 1.3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={headerPreview}
            >
              {headerPreview}
            </div>
          </div>
        </div>
        <button
          onClick={busy ? undefined : onClose}
          disabled={busy}
          aria-label="Close"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "transparent",
            border: "1px solid transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.4 : 1,
          }}
        >
          <Icons.Close size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: isMobile ? "16px" : "20px 24px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Settings */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            marginBottom: 18,
            padding: 16,
            border: "1px solid var(--line)",
            borderRadius: 12,
            background: "var(--surface-2)",
          }}
        >
          <div>
            <Label>Model</Label>
            <div
              style={{
                display: "inline-flex",
                padding: 4,
                background: "var(--surface)",
                border: "1px solid var(--line-2)",
                borderRadius: 9,
                gap: 2,
              }}
            >
              {[MODELS.SONNET_4_6, MODELS.OPUS_4_7].map((id) => {
                const active = model === id;
                const locked = id === MODELS.OPUS_4_7 && !isAdmin;
                return (
                  <button
                    key={id}
                    onClick={() => !locked && !busy && setModel(id)}
                    disabled={locked || busy}
                    title={locked ? "Opus 4.7 is admin-only" : undefined}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "none",
                      background: active ? "var(--bg-2)" : "transparent",
                      fontWeight: active ? 500 : 400,
                      fontSize: 12,
                      color: locked ? "var(--ink-4)" : "var(--ink)",
                      cursor: locked || busy ? "not-allowed" : "pointer",
                      opacity: locked ? 0.55 : 1,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {MODEL_LABELS[id]}
                    {locked && (
                      <span style={{ fontSize: 10 }} aria-hidden>
                        🔒
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label>Notes / extra context (optional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. lean into the body-image beat, make it feel like a late-night confession."
              readOnly={busy}
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: "var(--font-geist), sans-serif",
                background: "var(--surface)",
                border: "1px solid var(--line-2)",
                borderRadius: 9,
                outline: "none",
                color: "var(--ink)",
                resize: "vertical",
                opacity: busy ? 0.75 : 1,
              }}
            />
          </div>

          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            IG captions are capped at {INSTAGRAM_CHAR_CEILING} characters and
            skip hashtags — add your own when posting.
          </div>
        </div>

        {/* Caption area */}
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 12,
            background: "var(--surface-2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
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
                  fontSize: 10,
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
                style={{ fontSize: 16, fontWeight: 400, fontStyle: "italic" }}
              >
                Instagram · story-first
              </div>
            </div>
            {hasCaption && (
              <CharCount chars={chars} limit={INSTAGRAM_CHAR_CEILING} />
            )}
          </div>

          {!hasCaption && status !== "generating" && (
            <div
              style={{
                padding: "48px 20px",
                textAlign: "center",
                color: "var(--ink-4)",
                fontSize: 13,
              }}
            >
              <div
                className="serif"
                style={{
                  fontSize: 18,
                  fontStyle: "italic",
                  marginBottom: 6,
                  color: "var(--ink-3)",
                }}
              >
                No caption yet.
              </div>
              Tap <strong>Generate</strong> to draft one from this hook.
            </div>
          )}

          {status === "generating" && (
            <div
              style={{
                padding: "48px 20px",
                textAlign: "center",
                color: "var(--ink-3)",
                fontSize: 13,
              }}
            >
              <div
                className="serif"
                style={{
                  fontSize: 18,
                  fontStyle: "italic",
                  marginBottom: 6,
                }}
              >
                Generating caption…
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
                Usually takes 5–15s with {MODEL_LABELS[model]}.
              </div>
            </div>
          )}

          {hasCaption && !editing && (
            <div
              style={{
                padding: "16px 18px",
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
                maxHeight: 420,
                overflow: "auto",
              }}
            >
              {caption}
            </div>
          )}

          {hasCaption && editing && (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                minHeight: 320,
                padding: "16px 18px",
                fontSize: 13,
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

          {hasCaption && (
            <div
              style={{
                padding: "10px 14px",
                borderTop: "1px solid var(--line)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", gap: 6 }}>
                {!editing ? (
                  <Button
                    size="sm"
                    icon={<Icons.Edit />}
                    onClick={() => {
                      setDraft(caption);
                      setEditing(true);
                    }}
                    disabled={busy}
                  >
                    Edit
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Icons.Check />}
                      onClick={saveEdit}
                      disabled={overLimit}
                    >
                      Save edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
              <Button
                size="sm"
                icon={copied ? <Icons.Check /> : <Icons.Copy />}
                onClick={() => {
                  copy(editing ? draft : caption);
                  toast("Copied to clipboard");
                }}
              >
                {copied ? "Copied" : "Copy caption"}
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              border:
                "1px solid color-mix(in oklab, var(--accent) 30%, var(--line-2))",
              borderRadius: 10,
              background:
                "color-mix(in oklab, var(--accent) 6%, var(--surface))",
              color: "var(--accent)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Action footer */}
      <div
        style={{
          padding: isMobile ? "12px 14px" : "14px 24px",
          paddingBottom: isMobile
            ? "calc(12px + env(safe-area-inset-bottom))"
            : undefined,
          borderTop: "1px solid var(--line)",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
          background: "var(--surface)",
          flexWrap: "wrap",
        }}
      >
        {!hasCaption && (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Icons.Sparkles />}
              onClick={generate}
              disabled={busy}
            >
              {status === "generating" ? "Generating…" : "Generate caption"}
            </Button>
          </>
        )}

        {hasCaption && (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button
              variant="secondary"
              icon={<Icons.Sparkles />}
              onClick={generate}
              disabled={busy}
            >
              {status === "generating" ? "Regenerating…" : "Regenerate"}
            </Button>
            <Button
              variant="primary"
              icon={<Icons.Check />}
              onClick={save}
              disabled={
                busy || overLimit || !(editing ? draft : caption).trim()
              }
            >
              {status === "saving" ? "Saving…" : "Save to library"}
            </Button>
          </>
        )}
      </div>
    </SideDrawer>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "var(--ink-4)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
