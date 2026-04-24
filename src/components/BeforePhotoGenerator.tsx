"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { Sheet } from "./Sheet";
import { useIsMobile } from "@/lib/useIsMobile";
import { API } from "@/lib/supabase";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import type { Delivery } from "@/lib/types";

const MAX_GEN = 3;
const BATCH_SIZE = 2;

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function countKey(personaId: PersonaId): string {
  return `dreamme.beforeGenCount.${personaId}.${todayIso()}`;
}

function readIsAdmin(): boolean {
  try {
    return sessionStorage.getItem("dreamme.role") === "admin";
  } catch {
    return false;
  }
}

function readCount(personaId: PersonaId): number {
  try {
    const raw = localStorage.getItem(countKey(personaId));
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCount(personaId: PersonaId, n: number): void {
  try {
    localStorage.setItem(countKey(personaId), String(n));
  } catch {}
}

type View = "pick" | "results";

interface ResultImage {
  id: string;
  imageBase64: string;
  mimeType: string;
  targetLb: number;
}

export function BeforePhotoGenerator({
  personaId,
  onSaved,
  onClose,
}: {
  personaId: PersonaId;
  onSaved: (row: Delivery) => void;
  onClose: () => void;
}) {
  const persona = PERSONAS[personaId];
  const toast = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const [isAdmin] = React.useState<boolean>(() => readIsAdmin());
  const [view, setView] = React.useState<View>("pick");
  const [references, setReferences] = React.useState<
    { path: string; url: string }[]
  >([]);
  const [loadingRefs, setLoadingRefs] = React.useState(true);
  const [refsError, setRefsError] = React.useState<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = React.useState(false);
  const [deletingPath, setDeletingPath] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [results, setResults] = React.useState<ResultImage[]>([]);
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [genCount, setGenCount] = React.useState<number>(() =>
    readIsAdmin() ? 0 : readCount(personaId),
  );

  const busy =
    generating ||
    uploadingRef ||
    savingIds.size > 0 ||
    deletingPath !== null;
  const left = Math.max(0, MAX_GEN - genCount);
  const canGenerate =
    !busy &&
    !!selectedPath &&
    references.length > 0 &&
    (isAdmin || left > 0);

  const loadReferences = React.useCallback(async () => {
    setLoadingRefs(true);
    setRefsError(null);
    try {
      const items = await API.listPersonaReferences(personaId);
      setReferences(items);
      // Auto-select first reference if none selected (or current selection removed)
      setSelectedPath((prev) => {
        if (prev && items.some((r) => r.path === prev)) return prev;
        return items[0]?.path ?? null;
      });
    } catch (e) {
      setRefsError((e as Error).message);
    } finally {
      setLoadingRefs(false);
    }
  }, [personaId]);

  React.useEffect(() => {
    loadReferences();
  }, [loadReferences]);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast("Please pick an image file");
      return;
    }
    setUploadingRef(true);
    try {
      await API.uploadPersonaReference({ personaId, file });
      toast("Reference uploaded");
      await loadReferences();
    } catch (e) {
      toast(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploadingRef(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteReference = async (path: string) => {
    if (deletingPath) return;
    setDeletingPath(path);
    try {
      await API.deletePersonaReference(path);
      toast("Reference removed");
      await loadReferences();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`);
    } finally {
      setDeletingPath(null);
    }
  };

  const runGenerate = async () => {
    if (!selectedPath) return;
    const ref = references.find((r) => r.path === selectedPath);
    if (!ref) return;
    setError(null);
    setGenerating(true);
    // Increment quota BEFORE the API call for non-admin; this makes the
    // counter tick even on failures (matches the caption regen pattern).
    if (!isAdmin) {
      const next = genCount + 1;
      setGenCount(next);
      writeCount(personaId, next);
    }
    try {
      const { images, partialErrors } = await API.generateBeforePhotos({
        personaId,
        referenceImageUrl: ref.url,
        count: BATCH_SIZE,
      });
      const withIds: ResultImage[] = images.map((img) => ({
        ...img,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
      }));
      setResults(withIds);
      setSavedIds(new Set());
      setSavingIds(new Set());
      setView("results");
      if (partialErrors && partialErrors.length > 0) {
        toast(`Generated ${images.length} of ${BATCH_SIZE} (some failed)`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleKeep = async (result: ResultImage) => {
    if (savingIds.has(result.id) || savedIds.has(result.id)) return;
    setSavingIds((prev) => new Set(prev).add(result.id));
    try {
      const row = await API.uploadBeforePhotoBase64({
        personaId,
        imageBase64: result.imageBase64,
        imageMime: result.mimeType,
      });
      setSavedIds((prev) => new Set(prev).add(result.id));
      onSaved(row);
      toast("Saved to Before library");
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`);
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(result.id);
        return next;
      });
    }
  };

  const handleDiscardAll = () => {
    setResults([]);
    setSavedIds(new Set());
    setSavingIds(new Set());
    setView("pick");
    setError(null);
  };

  return (
    <Sheet
      open={true}
      onClose={busy ? () => {} : onClose}
      desktopMaxWidth={880}
      padded={false}
      fullscreenOnMobile
      ariaLabel="Generate before photo"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          // On mobile the Sheet is now fullscreen (inset: 0), so this inner
          // column takes the whole viewport minus the safe-area padding
          // Sheet already applied. Desktop keeps the 90vh card layout.
          height: isMobile ? "100%" : undefined,
          maxHeight: isMobile ? undefined : "90vh",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: isMobile ? "12px 16px 12px" : "20px 24px 14px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          {isMobile && (
            <button
              onClick={busy ? undefined : onClose}
              aria-label="Close"
              style={{
                width: 36,
                height: 36,
                minHeight: 36,
                borderRadius: 10,
                background: "transparent",
                border: "1px solid transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: busy ? "default" : "pointer",
                flexShrink: 0,
                marginTop: -4,
                marginLeft: -8,
                color: "var(--ink-2)",
                opacity: busy ? 0.4 : 1,
              }}
            >
              <Icons.Close size={20} />
            </button>
          )}
          <div>
            <div
              className="serif"
              style={{
                fontSize: 22,
                fontWeight: 400,
                fontStyle: "italic",
                letterSpacing: "-0.01em",
              }}
            >
              {view === "pick"
                ? "Generate before photo"
                : "Pick which to keep"}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-3)",
                marginTop: 4,
              }}
            >
              {view === "pick" ? (
                <>
                  Creating a before photo of{" "}
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                    {persona.avatar} {persona.name}
                  </span>
                  . Pick a reference photo to seed the generation.
                </>
              ) : (
                <>
                  Two variations generated. Keep any you like — they save into
                  the Before library for {persona.avatar} {persona.name}.
                </>
              )}
            </div>
          </div>
          {!isAdmin && (
            <div
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                color: left > 0 ? "var(--ink-2)" : "var(--accent)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              title="Generations reset daily"
            >
              {left} / {MAX_GEN} left today
            </div>
          )}
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: isMobile ? "14px 14px" : "18px 20px",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {view === "pick" ? (
            <PickView
              persona={persona}
              loadingRefs={loadingRefs}
              refsError={refsError}
              references={references}
              selectedPath={selectedPath}
              setSelectedPath={setSelectedPath}
              onUploadClick={() => fileInputRef.current?.click()}
              uploadingRef={uploadingRef}
              deletingPath={deletingPath}
              isAdmin={isAdmin}
              onDelete={handleDeleteReference}
              error={error}
            />
          ) : (
            <ResultsView
              persona={persona}
              results={results}
              savingIds={savingIds}
              savedIds={savedIds}
              onKeep={handleKeep}
            />
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handleFileSelect(e.target.files)}
        />

        {/* Footer */}
        <div
          style={{
            padding: isMobile
              ? "10px 14px calc(12px + env(safe-area-inset-bottom))"
              : "14px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "center",
            gap: isMobile ? 8 : 8,
            background: isMobile ? "var(--surface)" : undefined,
          }}
        >
          {(generating ||
            (view === "results" && results.length > 0)) && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                textAlign: isMobile ? "center" : "left",
              }}
            >
              {generating &&
                "Generating two variations — this usually takes 10-30 seconds…"}
              {!generating && view === "results" && results.length > 0 && (
                <span>
                  {savedIds.size} of {results.length} kept
                </span>
              )}
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              width: isMobile ? "100%" : undefined,
            }}
          >
            {view === "pick" ? (
              <>
                {!isMobile && (
                  <Button variant="ghost" onClick={onClose} disabled={busy}>
                    Close
                  </Button>
                )}
                <Button
                  variant="primary"
                  icon={<Icons.Sparkles />}
                  onClick={runGenerate}
                  disabled={!canGenerate}
                  style={isMobile ? { width: "100%" } : undefined}
                  title={
                    !selectedPath
                      ? "Pick a reference photo first"
                      : !isAdmin && left <= 0
                        ? "Daily generation limit reached"
                        : undefined
                  }
                >
                  {generating
                    ? "Generating…"
                    : isAdmin
                      ? `Generate ${BATCH_SIZE} before photos`
                      : `Generate ${BATCH_SIZE} (${left} of ${MAX_GEN} left)`}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={handleDiscardAll}
                  disabled={busy}
                  style={isMobile ? { width: "100%" } : undefined}
                >
                  {isMobile ? "Pick again" : "Discard & pick again"}
                </Button>
                <Button
                  variant="primary"
                  icon={<Icons.Sparkles />}
                  onClick={runGenerate}
                  disabled={!canGenerate || generating}
                  style={isMobile ? { width: "100%" } : undefined}
                  title={
                    !isAdmin && left <= 0
                      ? "Daily generation limit reached"
                      : undefined
                  }
                >
                  {generating
                    ? "Regenerating…"
                    : isAdmin
                      ? "Regenerate"
                      : `Regenerate (${left} of ${MAX_GEN} left)`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function PickView({
  persona,
  loadingRefs,
  refsError,
  references,
  selectedPath,
  setSelectedPath,
  onUploadClick,
  uploadingRef,
  deletingPath,
  isAdmin,
  onDelete,
  error,
}: {
  persona: (typeof PERSONAS)[PersonaId];
  loadingRefs: boolean;
  refsError: string | null;
  references: { path: string; url: string }[];
  selectedPath: string | null;
  setSelectedPath: (p: string | null) => void;
  onUploadClick: () => void;
  uploadingRef: boolean;
  deletingPath: string | null;
  isAdmin: boolean;
  onDelete: (path: string) => void;
  error: string | null;
}) {
  if (loadingRefs) {
    return (
      <div
        style={{
          padding: "60px 20px",
          textAlign: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Loading reference photos…
      </div>
    );
  }

  if (refsError) {
    return (
      <div
        style={{
          padding: "40px 20px",
          textAlign: "center",
          color: "var(--accent)",
          fontSize: 13,
        }}
      >
        {refsError}
      </div>
    );
  }

  if (references.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "40px 20px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>{persona.avatar}</div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>
          No reference photos for {persona.name} yet
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            maxWidth: 360,
            lineHeight: 1.5,
          }}
        >
          Upload one or more reference photos — these are the "current" photos
          of {persona.name} that Gemini will use to preserve her face when
          generating before photos.
        </div>
        <Button
          variant="primary"
          icon={<Icons.Upload />}
          onClick={onUploadClick}
          disabled={uploadingRef}
        >
          {uploadingRef ? "Uploading…" : "Upload reference photo"}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--ink-3)",
          }}
        >
          Reference photos ({references.length})
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.Upload />}
          onClick={onUploadClick}
          disabled={uploadingRef}
        >
          {uploadingRef ? "Uploading…" : "Add reference"}
        </Button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: 10,
        }}
      >
        {references.map((r) => {
          const selected = r.path === selectedPath;
          const deleting = deletingPath === r.path;
          return (
            <div
              key={r.path}
              style={{ position: "relative" }}
            >
              <button
                type="button"
                onClick={() => setSelectedPath(r.path)}
                disabled={deleting}
                style={{
                  width: "100%",
                  padding: 0,
                  border: `2px solid ${selected ? persona.color : "transparent"}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: deleting ? "wait" : "pointer",
                  background: "transparent",
                  aspectRatio: "4 / 5",
                  boxShadow: selected
                    ? `0 0 0 3px color-mix(in oklab, ${persona.color} 24%, transparent)`
                    : "none",
                  transition:
                    "box-shadow 140ms ease, border-color 140ms ease, opacity 140ms ease",
                  opacity: deleting ? 0.5 : 1,
                  display: "block",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.url}
                  alt="reference"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                {selected && (
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: persona.color,
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                    }}
                  >
                    <Icons.Check size={14} stroke="white" strokeWidth={2.5} />
                  </div>
                )}
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        "Remove this reference photo? (Does not delete any generated before photos already saved.)",
                      )
                    ) {
                      onDelete(r.path);
                    }
                  }}
                  disabled={deleting}
                  aria-label="Remove reference"
                  title="Remove reference (admin)"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "1px solid var(--line)",
                    background:
                      "color-mix(in oklab, var(--surface) 85%, transparent)",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: deleting ? "wait" : "pointer",
                    color: "var(--ink-2)",
                    padding: 0,
                  }}
                >
                  <Icons.Close size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            background: "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            color: "var(--accent)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

function ResultsView({
  persona,
  results,
  savingIds,
  savedIds,
  onKeep,
}: {
  persona: (typeof PERSONAS)[PersonaId];
  results: ResultImage[];
  savingIds: Set<string>;
  savedIds: Set<string>;
  onKeep: (r: ResultImage) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: results.length > 1 ? "1fr 1fr" : "1fr",
        gap: 16,
      }}
    >
      {results.map((r) => {
        const saving = savingIds.has(r.id);
        const saved = savedIds.has(r.id);
        return (
          <div
            key={r.id}
            style={{
              borderRadius: 12,
              overflow: "hidden",
              border: `2px solid ${saved ? persona.color : "var(--line)"}`,
              background: "var(--surface-2)",
              display: "flex",
              flexDirection: "column",
              transition: "border-color 180ms ease",
            }}
          >
            <div
              style={{
                position: "relative",
                aspectRatio: "4 / 5",
                background: "var(--surface)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${r.mimeType};base64,${r.imageBase64}`}
                alt="generated before"
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
                  top: 8,
                  left: 8,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background:
                    "color-mix(in oklab, var(--ink) 70%, transparent)",
                  color: "var(--surface)",
                  fontSize: 10,
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                ~{r.targetLb} lb
              </div>
              {saved && (
                <div
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: persona.color,
                    color: "white",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                  }}
                >
                  <Icons.Check size={12} stroke="white" strokeWidth={2.5} />
                  Saved
                </div>
              )}
            </div>
            <div
              style={{
                padding: "10px 12px",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <Button
                variant={saved ? "ghost" : "primary"}
                size="sm"
                onClick={() => onKeep(r)}
                disabled={saving || saved}
                icon={saved ? <Icons.Check /> : <Icons.Bookmark />}
              >
                {saved ? "Saved" : saving ? "Saving…" : "Keep"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
