"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { Sheet } from "./Sheet";
import { API } from "@/lib/supabase";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import type { Delivery } from "@/lib/types";

export function BeforePhotoUploader({
  personaId,
  onUploaded,
  onClose,
}: {
  personaId: PersonaId;
  onUploaded: (rows: Delivery[]) => void;
  onClose: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const toast = useToast();
  const persona = PERSONAS[personaId];

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      toast("Please select image files");
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    const uploaded: Delivery[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const row = await API.uploadBeforePhoto({
          personaId,
          file: files[i],
        });
        uploaded.push(row);
        setProgress({ done: i + 1, total: files.length });
      }
      onUploaded(uploaded);
      toast(
        `Uploaded ${uploaded.length} before photo${uploaded.length === 1 ? "" : "s"}`,
      );
      onClose();
    } catch (e) {
      if (uploaded.length > 0) onUploaded(uploaded);
      toast(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Sheet
      open={true}
      onClose={busy ? () => {} : onClose}
      desktopMaxWidth={460}
      ariaLabel="Upload before photos"
    >
        <div
          className="serif"
          style={{
            fontSize: 22,
            fontWeight: 400,
            fontStyle: "italic",
            marginBottom: 6,
            letterSpacing: "-0.01em",
          }}
        >
          Upload before photos
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--ink-3)",
            marginBottom: 18,
          }}
        >
          Adding before photos for{" "}
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>
            {persona.avatar} {persona.name}
          </span>
          . You can select multiple files at once.
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: "none" }}
        />

        <div
          onClick={busy ? undefined : () => inputRef.current?.click()}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "28px 20px",
            border: `2px dashed ${busy ? "var(--line)" : "var(--line-2)"}`,
            borderRadius: 12,
            cursor: busy ? "wait" : "pointer",
            background: "var(--surface-2)",
            marginBottom: 18,
            transition: "background 120ms ease",
          }}
        >
          <Icons.Upload size={28} stroke="var(--ink-2)" />
          <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>
            {busy && progress
              ? `Uploading ${progress.done} of ${progress.total}…`
              : "Click to choose image files"}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
            JPG, PNG, WebP, or GIF
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
    </Sheet>
  );
}
