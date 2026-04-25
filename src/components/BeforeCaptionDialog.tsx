"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, PersonaChip, useCopy, useToast } from "./ui";
import { CharCount } from "./CharCount";
import { SideDrawer } from "./SideDrawer";
import { useIsMobile } from "@/lib/useIsMobile";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { PERSONA_PROFILES } from "@/lib/persona-profiles";
import { MODELS, MODEL_LABELS, type ModelId } from "@/lib/models";
import { BEFORE_TRANSFORMATION_CHAR_CEILING } from "@/lib/prompts/beforeTransformationCaption";
import { API } from "@/lib/supabase";
import type { SavedCaption } from "@/lib/types";

/**
 * Dialog for generating a reflective "before transformation" caption,
 * anchored to Emma's reference template. Persona voice + writing style
 * comes from PERSONA_PROFILES; weight numbers default per persona but
 * the editor can override on a per-photo basis.
 *
 * Opened only from "before" deliveries in the Content Pipeline.
 */
export function BeforeCaptionDialog({
  open,
  onClose,
  personaId,
  sourceDeliveryId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  personaId: PersonaId;
  sourceDeliveryId: string;
  onSaved?: (row: SavedCaption) => void;
}) {
  const persona = PERSONAS[personaId];
  const profile = PERSONA_PROFILES[personaId];
  const toast = useToast();
  const { copied, copy } = useCopy();
  const isMobile = useIsMobile();

  const [model, setModel] = React.useState<ModelId>(MODELS.SONNET_4_6);
  const [notes, setNotes] = React.useState("");
  const [startWeight, setStartWeight] = React.useState<string>(
    String(profile.startWeightLbs),
  );
  const [goalWeight, setGoalWeight] = React.useState<string>(
    String(profile.goalWeightLbs),
  );

  type Status = "idle" | "generating" | "preview" | "saving";
  const [status, setStatus] = React.useState<Status>("idle");
  const [caption, setCaption] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setStatus("idle");
      setCaption("");
      setDraft("");
      setEditing(false);
      setError(null);
      setNotes("");
      setStartWeight(String(profile.startWeightLbs));
      setGoalWeight(String(profile.goalWeightLbs));
    }
  }, [open, profile.startWeightLbs, profile.goalWeightLbs]);

  const busy = status === "generating" || status === "saving";
  const chars = (editing ? draft : caption).length;
  const overLimit = chars > BEFORE_TRANSFORMATION_CHAR_CEILING;
  const hasCaption = caption.length > 0;

  const generate = async () => {
    setStatus("generating");
    setError(null);
    try {
      const startNum = Number(startWeight);
      const goalNum = Number(goalWeight);
      const out = await API.generateBeforeTransformationCaption({
        personaId,
        model,
        startWeightLbs:
          Number.isFinite(startNum) && startNum > 0 ? startNum : undefined,
        goalWeightLbs:
          Number.isFinite(goalNum) && goalNum > 0 ? goalNum : undefined,
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
    if (!final || final.length > BEFORE_TRANSFORMATION_CHAR_CEILING) return;
    setStatus("saving");
    setError(null);
    try {
      const row = await API.saveGeneratedCaption({
        personaId,
        caption: final,
        model,
        platform: "instagram",
        hookId: null,
        deliveryId: sourceDeliveryId,
        notes: notes.trim() || undefined,
        tipPoolAware: false,
      });
      toast("Caption saved");
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

  return (
    <SideDrawer
      open={open}
      onClose={busy ? () => {} : onClose}
      side="right"
      desktopWidth={720}
      ariaLabel="Generate before-transformation caption"
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
              Before-transformation caption
            </div>
            <div
              className="serif"
              style={{
                fontSize: 18,
                fontWeight: 400,
                lineHeight: 1.3,
              }}
            >
              {persona.name} · {profile.age} · {profile.archetype}
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
            opacity: busy ? 0.5 : 1,
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
          display: "flex",
          flexDirection: "column",
          gap: 18,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Inputs */}
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 14,
            background: "var(--surface-2)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <LabeledInput
              label="Start weight (lbs)"
              value={startWeight}
              onChange={setStartWeight}
              type="number"
              disabled={busy}
            />
            <LabeledInput
              label="Goal weight (lbs)"
              value={goalWeight}
              onChange={setGoalWeight}
              type="number"
              disabled={busy}
            />
          </div>

          <div>
            <div style={labelStyle}>Optional notes for the model</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything specific you want this caption to lean into…"
              rows={2}
              disabled={busy}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: "inherit",
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--surface)",
                color: "var(--ink)",
                outline: "none",
                resize: "vertical",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={labelStyle}>Model</div>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as ModelId)}
                disabled={busy}
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  background: "var(--surface)",
                  color: "var(--ink)",
                  outline: "none",
                }}
              >
                <option value={MODELS.SONNET_4_6}>
                  {MODEL_LABELS[MODELS.SONNET_4_6]}
                </option>
                <option value={MODELS.OPUS_4_7}>
                  {MODEL_LABELS[MODELS.OPUS_4_7]}
                </option>
              </select>
            </div>

            <Button
              variant="primary"
              icon={<Icons.Sparkles />}
              onClick={generate}
              disabled={busy}
              style={{ marginLeft: "auto" }}
            >
              {hasCaption
                ? status === "generating"
                  ? "Regenerating…"
                  : "Regenerate"
                : status === "generating"
                  ? "Generating…"
                  : "Generate caption"}
            </Button>
          </div>
        </div>

        {error && (
          <div
            style={{
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

        {/* Output */}
        {(hasCaption || status === "generating") && (
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
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--surface)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ink-4)",
                }}
              >
                Generated caption
              </div>
              <CharCount
                chars={chars}
                limit={BEFORE_TRANSFORMATION_CHAR_CEILING}
              />
            </div>
            {status === "generating" ? (
              <div
                style={{
                  padding: 28,
                  fontStyle: "italic",
                  color: "var(--ink-3)",
                  textAlign: "center",
                }}
                className="serif"
              >
                Writing in {persona.name}&rsquo;s voice…
              </div>
            ) : !editing ? (
              <div
                style={{
                  padding: "16px 18px",
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "var(--ink-2)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {caption}
              </div>
            ) : (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                style={{
                  width: "100%",
                  minHeight: 220,
                  padding: "16px 18px",
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
            {hasCaption && (
              <div
                style={{
                  padding: "10px 14px",
                  borderTop: "1px solid var(--line)",
                  display: "flex",
                  gap: 8,
                  justifyContent: "space-between",
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
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={cancelEdit}
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
                      copy(editing ? draft : caption);
                      toast("Caption copied");
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Icons.Bookmark />}
                    onClick={save}
                    disabled={busy || overLimit || !hasCaption}
                  >
                    {status === "saving" ? "Saving…" : "Save to library"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SideDrawer>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-geist-mono), monospace",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--ink-4)",
  marginBottom: 6,
};

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number";
  disabled?: boolean;
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "10px 12px",
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
  );
}
