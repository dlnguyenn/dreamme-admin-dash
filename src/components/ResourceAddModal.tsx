"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, useToast } from "./ui";
import { API } from "@/lib/supabase";
import type { Resource, ResourceKind } from "@/lib/types";

export function ResourceAddModal({
  resource,
  onClose,
  onSaved,
}: {
  resource: Resource | null;
  onClose: () => void;
  onSaved: (row: Resource) => void;
}) {
  const toast = useToast();
  const isEdit = resource !== null;

  const [kind, setKind] = React.useState<ResourceKind>(
    resource?.kind ?? "link",
  );
  const [title, setTitle] = React.useState(resource?.title ?? "");
  const [description, setDescription] = React.useState(
    resource?.description ?? "",
  );
  const [linkUrl, setLinkUrl] = React.useState(resource?.linkUrl ?? "");
  const [tags, setTags] = React.useState<string[]>(resource?.tags ?? []);
  const [tagInput, setTagInput] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [filePreview, setFilePreview] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    if (tags.length >= 20) {
      setError("Max 20 tags per resource.");
      return;
    }
    if (t.length > 40) {
      setError("Tags are 40 characters max.");
      return;
    }
    setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  const onTagKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagInput && tags.length) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const save = async () => {
    setError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Title is required.");
      return;
    }
    // Flush any unsubmitted tag input.
    const pending = tagInput.trim().toLowerCase();
    const finalTags =
      pending && !tags.includes(pending) ? [...tags, pending] : tags;

    setSaving(true);
    try {
      if (isEdit) {
        const patch: {
          title?: string;
          description?: string | null;
          tags?: string[];
          linkUrl?: string;
        } = {
          title: cleanTitle,
          description: description.trim() || null,
          tags: finalTags,
        };
        if (resource!.kind === "link") {
          if (!linkUrl.trim()) {
            setError("Link URL is required.");
            setSaving(false);
            return;
          }
          patch.linkUrl = linkUrl.trim();
        }
        const saved = await API.updateResource(resource!.id, patch);
        toast("Resource updated");
        onSaved(saved);
      } else if (kind === "link") {
        if (!linkUrl.trim()) {
          setError("Link URL is required.");
          setSaving(false);
          return;
        }
        const saved = await API.createResourceLink({
          title: cleanTitle,
          description: description.trim() || undefined,
          linkUrl: linkUrl.trim(),
          tags: finalTags,
        });
        toast("Resource added");
        onSaved(saved);
      } else {
        if (!file) {
          setError("Pick an image file to upload.");
          setSaving(false);
          return;
        }
        const saved = await API.createResourceImage({
          title: cleanTitle,
          description: description.trim() || undefined,
          file,
          tags: finalTags,
        });
        toast("Resource added");
        onSaved(saved);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={() => !saving && onClose()}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklab, var(--ink) 30%, transparent)",
          backdropFilter: "blur(2px)",
          zIndex: 100,
          animation: "fadeIn 200ms ease",
        }}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 600,
          maxWidth: "92vw",
          background: "var(--surface)",
          boxShadow: "var(--shadow-drawer)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 280ms cubic-bezier(.4,0,.2,1)",
        }}
      >
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ font: "650 17px var(--font-ui)", color: "var(--ink)" }}>
            {isEdit ? "Edit resource" : "Add resource"}
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
            padding: "22px 26px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {!isEdit && (
            <Field label="Type">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <KindButton
                  active={kind === "link"}
                  onClick={() => setKind("link")}
                  icon={<Icons.Link size={16} />}
                  label="External link"
                  caption="Drive, Notion, Figma…"
                />
                <KindButton
                  active={kind === "image"}
                  onClick={() => setKind("image")}
                  icon={<Icons.Image size={16} />}
                  label="Image / asset"
                  caption="Upload a reference file"
                />
              </div>
            </Field>
          )}

          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Emma ref pack · vol. 3"
              style={inputStyle}
              maxLength={200}
            />
          </Field>

          <Field label="Description / how to use">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short caption for creators — when to reach for this, and any pitfalls."
              style={{
                ...inputStyle,
                minHeight: 120,
                resize: "vertical",
                lineHeight: 1.5,
              }}
              maxLength={4000}
            />
          </Field>

          {(isEdit ? resource!.kind === "link" : kind === "link") && (
            <Field label="URL">
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://drive.google.com/…"
                style={inputStyle}
                maxLength={2000}
              />
            </Field>
          )}

          {!isEdit && kind === "image" && (
            <Field label="Image file">
              <ImagePicker
                file={file}
                preview={filePreview}
                onChange={setFile}
              />
            </Field>
          )}

          {isEdit && resource!.kind === "image" && resource!.imageUrl && (
            <Field label="Current image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resource!.imageUrl}
                alt={resource!.title}
                style={{
                  width: "100%",
                  maxHeight: 220,
                  objectFit: "cover",
                  borderRadius: 10,
                  border: "1px solid var(--line)",
                }}
              />
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  marginTop: 4,
                }}
              >
                Replacing the image isn't supported here — delete and re-add if
                you need a new file.
              </div>
            </Field>
          )}

          <Field label="Tags">
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--surface)",
                minHeight: 42,
                alignItems: "center",
              }}
            >
              {tags.map((t) => (
                <span
                  key={t}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    font: "600 11.5px var(--font-ui)",
                    color: "var(--neutral-text)",
                    padding: "3px 4px 3px 9px",
                    borderRadius: 999,
                    background: "var(--neutral-soft)",
                  }}
                >
                  {t}
                  <button
                    onClick={() =>
                      setTags((prev) => prev.filter((x) => x !== t))
                    }
                    title={`Remove ${t}`}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: "none",
                      background: "transparent",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--ink-4)",
                      cursor: "pointer",
                    }}
                  >
                    <Icons.Close size={11} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKey}
                onBlur={addTag}
                placeholder={
                  tags.length === 0
                    ? "Type a tag and press Enter"
                    : "Add another…"
                }
                maxLength={40}
                style={{
                  flex: 1,
                  minWidth: 120,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--ink)",
                  fontSize: 13,
                  fontFamily: "inherit",
                  padding: "3px 2px",
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 4 }}>
              Press Enter or comma to add. Max 20 tags.
            </div>
          </Field>

          {error && (
            <div
              style={{
                padding: "9px 12px",
                font: "400 12.5px var(--font-ui)",
                color: "var(--danger-text)",
                background: "var(--danger-soft)",
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add resource"}
          </Button>
        </div>
      </aside>
    </>
  );
}

function KindButton({
  active,
  onClick,
  icon,
  label,
  caption,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  caption: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid",
        borderColor: active ? "var(--ink)" : "var(--line)",
        background: active ? "var(--surface-2)" : "var(--surface)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ink)",
        }}
      >
        {icon}
        {label}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{caption}</div>
    </button>
  );
}

function ImagePicker({
  file,
  preview,
  onChange,
}: {
  file: File | null;
  preview: string | null;
  onChange: (f: File | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      {preview ? (
        <div
          style={{
            position: "relative",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--line)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="preview"
            style={{
              width: "100%",
              maxHeight: 240,
              objectFit: "cover",
              display: "block",
            }}
          />
          <button
            onClick={() => onChange(null)}
            title="Remove"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink-2)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <Icons.Close size={14} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "30px 16px",
            border: "1px dashed var(--line-2)",
            borderRadius: 10,
            background: "var(--surface-2)",
            cursor: "pointer",
            color: "var(--ink-3)",
          }}
        >
          <Icons.Upload size={22} />
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            Click to choose an image
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-4)" }}>
            JPG, PNG, WEBP — auto-resized before upload
          </div>
        </button>
      )}
      {file && (
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {file.name} · {(file.size / 1024).toFixed(0)} KB
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--ink)",
  outline: "none",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          font: "650 10.5px var(--font-ui)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--ink-3)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
