"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { PERSONAS } from "@/lib/personas";
import type { Delivery } from "@/lib/types";

function extFromUrl(url: string): string {
  const m = url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

function yyyymmdd(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function shortIdFrom(id: string) {
  return id.replace(/-/g, "").slice(0, 6);
}

async function triggerDownload(url: string, filename: string) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Slight delay before revoking so the browser can actually write the file.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
}

export function TransformationExportModal({
  afterDelivery,
  beforePhotos,
  onClose,
  onJumpToBeforeLibrary,
}: {
  afterDelivery: Delivery;
  beforePhotos: Delivery[];
  onClose: () => void;
  onJumpToBeforeLibrary: () => void;
}) {
  const [selectedBeforeId, setSelectedBeforeId] = React.useState<string | null>(
    beforePhotos[0]?.id ?? null,
  );
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();
  const persona = PERSONAS[afterDelivery.personaId];

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const selectedBefore = beforePhotos.find((b) => b.id === selectedBeforeId) ?? null;
  const hasBefore = beforePhotos.length > 0;

  const handleDownload = async () => {
    if (!selectedBefore) return;
    setBusy(true);
    const date = yyyymmdd();
    const personaSlug = afterDelivery.personaId;
    const beforeName = `${personaSlug}-before-${date}-${shortIdFrom(selectedBefore.id)}.${extFromUrl(selectedBefore.imageUrl)}`;
    const afterName = `${personaSlug}-after-${date}-${shortIdFrom(afterDelivery.id)}.${extFromUrl(afterDelivery.imageUrl)}`;
    try {
      // Sequential to keep user gesture valid and filenames correct across browsers.
      await triggerDownload(selectedBefore.imageUrl, beforeName);
      await triggerDownload(afterDelivery.imageUrl, afterName);
      toast("Both files downloaded");
      onClose();
    } catch (e) {
      toast(`Download failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        onClick={busy ? undefined : onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklab, var(--ink) 40%, transparent)",
          backdropFilter: "blur(2px)",
          zIndex: 200,
          animation: "fadeIn 160ms ease",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 201,
          width: "94vw",
          maxWidth: 880,
          maxHeight: "90vh",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "fadeIn 180ms ease",
        }}
      >
        <div
          style={{
            padding: "20px 24px 14px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            className="serif"
            style={{
              fontSize: 22,
              fontWeight: 400,
              fontStyle: "italic",
              letterSpacing: "-0.01em",
            }}
          >
            Download as transformation
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              marginTop: 4,
            }}
          >
            Pick a before photo of{" "}
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>
              {persona.avatar} {persona.name}
            </span>{" "}
            to pair with this after photo.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: hasBefore ? "1fr 260px" : "1fr",
            gap: 0,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Left: before photo grid */}
          <div
            style={{
              padding: "18px 20px",
              overflow: "auto",
              borderRight: hasBefore ? "1px solid var(--line)" : "none",
            }}
          >
            {!hasBefore ? (
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
                  No before photos for {persona.name} yet
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-3)",
                    maxWidth: 360,
                    lineHeight: 1.5,
                  }}
                >
                  Upload some before photos from the Before library tab to start
                  exporting transformations.
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    onJumpToBeforeLibrary();
                    onClose();
                  }}
                >
                  Go to Before library
                </Button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--ink-3)",
                    marginBottom: 10,
                  }}
                >
                  Before photos ({beforePhotos.length})
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                    gap: 10,
                  }}
                >
                  {beforePhotos.map((b) => {
                    const selected = b.id === selectedBeforeId;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelectedBeforeId(b.id)}
                        style={{
                          position: "relative",
                          padding: 0,
                          border: `2px solid ${selected ? persona.color : "transparent"}`,
                          borderRadius: 10,
                          overflow: "hidden",
                          cursor: "pointer",
                          background: "transparent",
                          aspectRatio: "4 / 5",
                          boxShadow: selected
                            ? `0 0 0 3px color-mix(in oklab, ${persona.color} 24%, transparent)`
                            : "none",
                          transition: "box-shadow 140ms ease, border-color 140ms ease",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={b.imageUrl}
                          alt="before"
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
                              right: 6,
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
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Right: after preview */}
          {hasBefore && (
            <div
              style={{
                padding: "18px 20px",
                background: "var(--surface-2)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
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
                After photo
              </div>
              <div
                style={{
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid var(--line)",
                  aspectRatio: "4 / 5",
                  background: "var(--surface)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={afterDelivery.imageUrl}
                  alt="after"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {hasBefore && (
            <Button
              variant="primary"
              onClick={handleDownload}
              disabled={busy || !selectedBefore}
              icon={<Icons.Download />}
            >
              {busy ? "Downloading…" : "Download both"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
