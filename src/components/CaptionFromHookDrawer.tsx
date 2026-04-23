"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, PersonaChip, useCopy, useToast } from "./ui";
import { CharCount } from "./CharCount";
import { SideDrawer } from "./SideDrawer";
import { useIsMobile } from "@/lib/useIsMobile";
import { PERSONAS } from "@/lib/personas";
import { MODELS, MODEL_LABELS, type ModelId } from "@/lib/models";
import type { GeneratedHook } from "@/lib/types";

const CAPTION_LIMIT = 4000;
const MAX_REGENS = 2;
const regenKey = (id: string) => `dreamme.captionRegens.${id}`;

function readIsAdmin(): boolean {
  try {
    return sessionStorage.getItem("dreamme.role") === "admin";
  } catch {
    return false;
  }
}

function readRegensUsed(id: string): number {
  try {
    const raw = localStorage.getItem(regenKey(id));
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

type Status = "idle" | "generating" | "preview" | "saving";

export function CaptionFromHookDrawer({
  hook,
  onClose,
  onSaved,
}: {
  hook: GeneratedHook;
  onClose: () => void;
  onSaved: () => void;
}) {
  const persona = PERSONAS[hook.personaId];
  const toast = useToast();
  const { copied, copy } = useCopy();
  const isMobile = useIsMobile();

  const [isAdmin] = React.useState<boolean>(() => readIsAdmin());
  const [model, setModel] = React.useState<ModelId>(MODELS.SONNET_4_6);
  const [notes, setNotes] = React.useState("");
  const [tipPoolAware, setTipPoolAware] = React.useState(true);

  const [status, setStatus] = React.useState<Status>("idle");
  const [caption, setCaption] = React.useState<string>("");
  const [draft, setDraft] = React.useState<string>("");
  const [editing, setEditing] = React.useState(false);
  const [regensUsed, setRegensUsed] = React.useState<number>(() =>
    readIsAdmin() ? 0 : readRegensUsed(hook.id),
  );
  const [error, setError] = React.useState<string | null>(null);

  const busy = status === "generating" || status === "saving";
  const regenLeft = Math.max(0, MAX_REGENS - regensUsed);
  const canRegen =
    status === "preview" && !busy && (isAdmin || regenLeft > 0);
  const chars = (editing ? draft : caption).length;
  const overLimit = chars > CAPTION_LIMIT;
  const hasCaption = caption.length > 0;

  const generate = async (isRegen: boolean) => {
    setStatus("generating");
    setError(null);
    try {
      const res = await fetch("/api/generate/caption", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hookId: hook.id,
          hookText: hook.hookText,
          model,
          notes: notes.trim() || undefined,
          tipPoolAware,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setCaption(data.caption);
      setDraft(data.caption);
      setEditing(false);
      setStatus("preview");
      if (isRegen) {
        setRegensUsed((n) => {
          const next = n + 1;
          if (!isAdmin) {
            try {
              localStorage.setItem(regenKey(hook.id), String(next));
            } catch {}
          }
          return next;
        });
      }
    } catch (e) {
      setError((e as Error).message);
      setStatus(hasCaption ? "preview" : "idle");
    }
  };

  const save = async () => {
    const final = editing ? draft : caption;
    if (!final.trim() || final.length > CAPTION_LIMIT) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/generate/caption/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hookId: hook.id,
          personaId: hook.personaId,
          caption: final,
          model,
          notes: notes.trim() || undefined,
          tipPoolAware,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      try {
        localStorage.removeItem(regenKey(hook.id));
      } catch {}
      toast("Caption saved to library");
      onSaved();
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

  return (
    <SideDrawer
      open={true}
      onClose={busy ? () => {} : onClose}
      side="right"
      desktopWidth={780}
      ariaLabel="Generate caption from hook"
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
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
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
                Caption from hook
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
                title={hook.hookText}
              >
                {hook.hookText}
              </div>
            </div>
          </div>
          <button
            onClick={busy ? undefined : onClose}
            disabled={busy}
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
          {/* Settings block */}
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
                placeholder="e.g. lean into the side-effect normalization angle, mention sulfur burps directly."
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

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <input
                type="checkbox"
                checked={tipPoolAware}
                onChange={(e) => setTipPoolAware(e.target.checked)}
                disabled={busy}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontWeight: 500, color: "var(--ink)" }}>
                  Tip-pool awareness
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginTop: 2,
                  }}
                >
                  Avoid reusing tip themes from the 20 most recent saved captions.
                </span>
              </span>
            </label>
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
                  Long-form · TikTok
                </div>
              </div>
              {hasCaption && <CharCount chars={chars} limit={CAPTION_LIMIT} />}
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
                Configure settings above and click <strong>Generate</strong>.
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
                  Usually takes 10–30s with {MODEL_LABELS[model]}.
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
                  minHeight: 360,
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
                border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--line-2))",
                borderRadius: 10,
                background: "color-mix(in oklab, var(--accent) 6%, var(--surface))",
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
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            background: "var(--surface)",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              color: "var(--ink-4)",
            }}
          >
            {status === "preview" || status === "saving"
              ? isAdmin
                ? "Unlimited regens (admin)"
                : `${regenLeft} of ${MAX_REGENS} regens left`
              : isAdmin
                ? "Model · admin"
                : regensUsed > 0
                  ? `${regenLeft} of ${MAX_REGENS} regens left for this hook`
                  : `Up to ${MAX_REGENS} regens per hook`}
          </div>

          {!hasCaption && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={<Icons.Sparkles />}
                onClick={() => generate(false)}
                disabled={busy}
              >
                {status === "generating" ? "Generating…" : "Generate caption"}
              </Button>
            </div>
          )}

          {hasCaption && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={busy}
              >
                Close
              </Button>
              <Button
                variant="secondary"
                icon={<Icons.Sparkles />}
                onClick={() => generate(true)}
                disabled={!canRegen}
                title={
                  !isAdmin && regenLeft === 0
                    ? "Regen limit reached for this hook — save or close"
                    : undefined
                }
              >
                {isAdmin
                  ? status === "generating"
                    ? "Regenerating…"
                    : "Regenerate"
                  : `Regenerate (${regenLeft} left)`}
              </Button>
              <Button
                variant="primary"
                icon={<Icons.Check />}
                onClick={save}
                disabled={busy || overLimit || !(editing ? draft : caption).trim()}
              >
                {status === "saving" ? "Saving…" : "Save to library"}
              </Button>
            </div>
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

