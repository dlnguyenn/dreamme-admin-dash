"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { Sheet } from "./Sheet";
import { useIsMobile } from "@/lib/useIsMobile";
import type { Delivery } from "@/lib/types";

const MAX_REDOS = 3;
const redoKey = (id: string) => `dreamme.redos.${id}`;

function readIsAdmin(): boolean {
  try {
    return sessionStorage.getItem("dreamme.role") === "admin";
  } catch {
    return false;
  }
}

function readRedosUsed(id: string): number {
  try {
    const raw = localStorage.getItem(redoKey(id));
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

type Status = "idle" | "generating" | "preview" | "accepting";

export function ModifyImageModal({
  item,
  onAccepted,
  onClose,
}: {
  item: Delivery;
  onAccepted: (newImageUrl: string) => void;
  onClose: () => void;
}) {
  const originalUrl = React.useRef(item.imageUrl).current;
  const [prompt, setPrompt] = React.useState("");
  const [status, setStatus] = React.useState<Status>("idle");
  const [previewDataUrl, setPreviewDataUrl] = React.useState<string | null>(
    null,
  );
  const [previewBase64, setPreviewBase64] = React.useState<string | null>(null);
  const [previewMime, setPreviewMime] = React.useState<string>("image/png");
  const [isAdmin] = React.useState<boolean>(() => readIsAdmin());
  const [redosUsed, setRedosUsed] = React.useState<number>(() =>
    readIsAdmin() ? 0 : readRedosUsed(item.id),
  );
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const isMobile = useIsMobile();

  const generate = async (isRedo: boolean) => {
    if (!prompt.trim()) return;
    setStatus("generating");
    setError(null);
    try {
      const res = await fetch("/api/modify/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: originalUrl,
          prompt: prompt.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }
      setPreviewBase64(data.imageBase64);
      setPreviewMime(data.mimeType ?? "image/png");
      setPreviewDataUrl(
        `data:${data.mimeType ?? "image/png"};base64,${data.imageBase64}`,
      );
      setStatus("preview");
      if (isRedo) {
        setRedosUsed((n) => {
          const next = n + 1;
          if (!isAdmin) {
            try {
              localStorage.setItem(redoKey(item.id), String(next));
            } catch {}
          }
          return next;
        });
      }
    } catch (e) {
      setError((e as Error).message);
      setStatus(previewDataUrl ? "preview" : "idle");
    }
  };

  const accept = async () => {
    if (!previewBase64) return;
    setStatus("accepting");
    setError(null);
    try {
      const res = await fetch("/api/modify/image/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryId: item.id,
          personaId: item.personaId,
          imageBase64: previewBase64,
          mimeType: previewMime,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }
      try {
        localStorage.removeItem(redoKey(item.id));
      } catch {}
      toast("Image updated");
      onAccepted(data.imageUrl as string);
    } catch (e) {
      setError((e as Error).message);
      setStatus("preview");
    }
  };

  const discard = () => {
    setPreviewDataUrl(null);
    setPreviewBase64(null);
    setStatus("idle");
    setError(null);
  };

  const busy = status === "generating" || status === "accepting";
  const redoLeft = Math.max(0, MAX_REDOS - redosUsed);
  const canRedo =
    status === "preview" && !busy && (isAdmin || redoLeft > 0);

  return (
    <Sheet
      open={true}
      onClose={busy ? () => {} : onClose}
      desktopMaxWidth={720}
      ariaLabel="Modify image"
    >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--ink-4)",
                marginBottom: 4,
              }}
            >
              Gemini 3.1 Flash Image
            </div>
            <div
              className="serif"
              style={{
                fontSize: 22,
                fontWeight: 400,
                fontStyle: "italic",
                letterSpacing: "-0.01em",
              }}
            >
              Modify image
            </div>
          </div>
          <button
            onClick={busy ? undefined : onClose}
            disabled={busy}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "transparent",
              border: "1px solid transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.4 : 1,
            }}
          >
            <Icons.Close size={16} />
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <ImageTile label="Original" src={originalUrl} />
          <ImageTile
            label={status === "generating" ? "Generating…" : "Preview"}
            src={previewDataUrl}
            generating={status === "generating"}
          />
        </div>

        <label
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            fontWeight: 500,
            display: "block",
            marginBottom: 6,
          }}
        >
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          readOnly={status === "preview" || busy}
          placeholder="e.g. The model should be looking at the phone, softer lighting on the face."
          style={{
            width: "100%",
            minHeight: 72,
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily: "var(--font-geist), sans-serif",
            background: "var(--surface-2)",
            border: "1px solid var(--line-2)",
            borderRadius: 10,
            outline: "none",
            color: "var(--ink)",
            resize: "vertical",
            opacity: status === "preview" || busy ? 0.75 : 1,
          }}
        />

        {error && (
          <div
            style={{
              color: "var(--accent)",
              fontSize: 12,
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "center",
            marginTop: 16,
            gap: isMobile ? 12 : 8,
            flexWrap: isMobile ? "nowrap" : "wrap",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              color: "var(--ink-4)",
              lineHeight: 1.45,
            }}
          >
            {status === "preview"
              ? isAdmin
                ? "Unlimited redos (admin)"
                : `${redoLeft} of ${MAX_REDOS} redos left`
              : isAdmin
                ? "Reference image is always the original · admin"
                : redosUsed > 0
                  ? `${redoLeft} of ${MAX_REDOS} redos left for this image`
                  : "Reference image is always the original"}
          </div>

          {status === "idle" && (
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "column-reverse" : "row",
                gap: 8,
              }}
            >
              <Button
                variant="ghost"
                onClick={onClose}
                style={
                  isMobile
                    ? { width: "100%", justifyContent: "center" }
                    : undefined
                }
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={<Icons.Sparkles />}
                onClick={() => generate(false)}
                disabled={!prompt.trim()}
                style={
                  isMobile
                    ? { width: "100%", justifyContent: "center" }
                    : undefined
                }
              >
                Generate
              </Button>
            </div>
          )}

          {status === "generating" && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant="ghost"
                disabled
                style={
                  isMobile
                    ? { width: "100%", justifyContent: "center" }
                    : undefined
                }
              >
                Generating…
              </Button>
            </div>
          )}

          {(status === "preview" || status === "accepting") && (
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "column-reverse" : "row",
                gap: 8,
              }}
            >
              <Button
                variant="ghost"
                onClick={discard}
                disabled={busy}
                style={
                  isMobile
                    ? { width: "100%", justifyContent: "center" }
                    : undefined
                }
              >
                Discard
              </Button>
              <Button
                variant="secondary"
                icon={<Icons.Sparkles />}
                onClick={() => generate(true)}
                disabled={!canRedo}
                title={
                  !isAdmin && redoLeft === 0
                    ? "Redo limit reached for this image — accept or discard"
                    : undefined
                }
                style={
                  isMobile
                    ? { width: "100%", justifyContent: "center" }
                    : undefined
                }
              >
                {isAdmin ? "Redo" : `Redo (${redoLeft} left)`}
              </Button>
              <Button
                variant="primary"
                icon={<Icons.Check />}
                onClick={accept}
                disabled={busy}
                style={
                  isMobile
                    ? { width: "100%", justifyContent: "center" }
                    : undefined
                }
              >
                {status === "accepting" ? "Saving…" : "Accept changes"}
              </Button>
            </div>
          )}
        </div>
    </Sheet>
  );
}

function ImageTile({
  label,
  src,
  generating,
}: {
  label: string;
  src: string | null;
  generating?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "6px 10px",
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-4)",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: "relative",
          aspectRatio: "4/5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-2)",
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            className="serif"
            style={{
              fontStyle: "italic",
              fontSize: 14,
              color: "var(--ink-4)",
              padding: 12,
              textAlign: "center",
            }}
          >
            {generating ? "Generating…" : "No preview yet"}
          </div>
        )}
      </div>
    </div>
  );
}
