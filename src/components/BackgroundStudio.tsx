"use client";

/**
 * Background Studio: purchasable home-screen backgrounds for Sushi.
 *
 * Library of saved backgrounds, each previewed on a phone mock of the home
 * screen where tapping anywhere makes Sushi swim there — the same rule the
 * art has to pass (Sushi can be anywhere, so the whole picture must be
 * underwater). Plus: generate a new one from a theme, or revise one with a
 * short instruction. Server side: /api/background-studio/{generate,items}.
 */
import * as React from "react";
import { Button, useToast } from "./ui";
import { PageHeader } from "./Shell";
import { Icons } from "./Icons";
import { Card, ErrorBanner, InfoWell } from "./porcelain";
import { ConfirmDialog } from "./ConfirmDialog";
import { useIsMobile } from "@/lib/useIsMobile";
import { useElementWidth } from "@/lib/useElementWidth";
import { slugify } from "@/lib/accessory-studio-shared";
import { SUSHI_CUTOUT_PATH, resizedUrl, type BackgroundRow, type BgModelKey } from "@/lib/background-studio-shared";

type Draft = { imageUrl: string; name: string; theme: string; model: string | null };

const label: React.CSSProperties = { font: "600 12px var(--font-ui)", color: "var(--ink-3)", marginBottom: 6 };
const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--line-2)",
  background: "var(--surface)",
  color: "var(--ink)",
  font: "400 13px var(--font-ui)",
  boxSizing: "border-box",
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

async function downloadImage(url: string, name: string) {
  const blob = await (await fetch(url)).blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slugify(name) || "background"}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Phone-shaped mock of the home screen: background cropped like the app
 * (cover), the Level card, the glass stats panel, and Sushi. Tap anywhere
 * and Sushi swims there.
 */
function PhoneMock({ src, width }: { src: string; width: number }) {
  const height = Math.round(width * 2.17);
  const fish = Math.round(width * 0.36);
  const [pos, setPos] = React.useState({ x: (width - fish) / 2, y: height * 0.36, flip: false });
  React.useEffect(() => setPos({ x: (width - fish) / 2, y: height * 0.36, flip: false }), [src, width, height, fish]);

  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(width - fish, e.clientX - r.left - fish / 2));
    const y = Math.max(0, Math.min(height - fish, e.clientY - r.top - fish / 2));
    setPos((p) => ({ x, y, flip: x > p.x }));
  };

  const s = width / 300; // overlay sizes are tuned for a 300px-wide phone
  return (
    <div
      onClick={onTap}
      title="Tap anywhere: Sushi swims there"
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 28 * s,
        overflow: "hidden",
        cursor: "pointer",
        background: "var(--surface-2)",
        boxShadow: "var(--shadow-card)",
        userSelect: "none",
        flex: "0 0 auto",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resizedUrl(src, width * 2)}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
      <div
        style={{
          position: "absolute",
          top: 34 * s,
          left: 12 * s,
          right: 12 * s,
          padding: `${12 * s}px ${14 * s}px`,
          borderRadius: 22 * s,
          background: "rgba(52,196,184,.82)",
          border: "1px solid rgba(255,255,255,.35)",
          pointerEvents: "none",
        }}
      >
        <div style={{ color: "#fff", font: `700 ${15 * s}px var(--font-ui)` }}>Level 3</div>
        <div style={{ marginTop: 8 * s, height: 20 * s, borderRadius: 10 * s, background: "rgba(255,255,255,.35)", overflow: "hidden" }}>
          <div style={{ width: "87%", height: "100%", borderRadius: 10 * s, background: "#f48da0" }} />
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={SUSHI_CUTOUT_PATH}
        alt="Sushi"
        draggable={false}
        style={{
          position: "absolute",
          width: fish,
          left: pos.x,
          top: pos.y,
          transform: pos.flip ? "scaleX(-1)" : "none",
          transition: "left 900ms cubic-bezier(.45,.05,.3,1), top 900ms cubic-bezier(.45,.05,.3,1)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 12 * s,
          right: 12 * s,
          bottom: 18 * s,
          height: 128 * s,
          borderRadius: 22 * s,
          background: "rgba(20,40,50,.28)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,.35)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export function BackgroundStudio() {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const narrow = isMobile || (rootWidth > 0 && rootWidth < 820);

  const [items, setItems] = React.useState<BackgroundRow[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const [name, setName] = React.useState("");
  const [theme, setTheme] = React.useState("");
  const [model, setModel] = React.useState<BgModelKey>("pro");
  const [instruction, setInstruction] = React.useState("");
  const [busy, setBusy] = React.useState<"new" | "edit" | "save" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<BackgroundRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/background-studio/items", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        const msg: string = json.error ?? "failed";
        throw new Error(
          /PGRST205|Could not find the table/.test(msg)
            ? "The backgrounds table isn't created yet. Migration 0084 creates it when this deploys."
            : msg,
        );
      }
      setItems(json.items ?? []);
      setSelectedId((cur) => cur ?? json.items?.[0]?.id ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  // The preview shows an unsaved draft first, otherwise the selected background.
  const shown: Draft | null = draft ?? (selected ? { imageUrl: selected.image_url, name: selected.name, theme: selected.theme, model: selected.model } : null);

  async function generateNew() {
    setBusy("new");
    setError(null);
    try {
      const r = await postJson<{ imageUrl: string; model: string }>("/api/background-studio/generate", {
        mode: "new",
        name: name.trim(),
        theme: theme.trim(),
        model,
      });
      setDraft({ imageUrl: r.imageUrl, name: name.trim(), theme: theme.trim(), model: r.model });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revise() {
    if (!shown) return;
    setBusy("edit");
    setError(null);
    try {
      const r = await postJson<{ imageUrl: string; model: string }>("/api/background-studio/generate", {
        mode: "edit",
        sourceUrl: shown.imageUrl,
        instruction: instruction.trim(),
        model,
      });
      setDraft({ imageUrl: r.imageUrl, name: shown.name, theme: `${shown.theme} (edited: ${instruction.trim()})`, model: r.model });
      setInstruction("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy("save");
    try {
      const { item } = await postJson<{ item: BackgroundRow }>("/api/background-studio/items", draft);
      setItems((l) => [...l, item]);
      setSelectedId(item.id);
      setDraft(null);
      toast("Saved to backgrounds");
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(row: BackgroundRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/background-studio/items?id=${row.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setItems((l) => l.filter((r) => r.id !== row.id));
      if (selectedId === row.id) setSelectedId(null);
      toast("Deleted");
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const phoneWidth = narrow ? Math.min(300, Math.max(220, rootWidth - 40)) : 300;

  return (
    <div ref={rootRef}>
      <PageHeader
        eyebrow="Product"
        title="Backgrounds"
        subtitle="Home-screen backgrounds for Sushi. Sushi swims wherever the user taps, so every background has to be underwater from top to bottom. Tap the preview to try it."
      />

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "auto minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        {/* ---- Preview ---- */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: narrow ? "center" : "flex-start", gap: 10 }}>
          {shown ? (
            <PhoneMock src={shown.imageUrl} width={phoneWidth} />
          ) : (
            <div
              style={{
                width: phoneWidth,
                height: Math.round(phoneWidth * 2.17),
                borderRadius: 28,
                border: "1px dashed var(--line-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-4)",
                font: "400 13px var(--font-ui)",
              }}
            >
              No background selected
            </div>
          )}
          {draft && (
            <div style={{ font: "600 12px var(--font-ui)", color: "var(--accent-text)" }}>Unsaved draft</div>
          )}
        </div>

        {/* ---- Details, edit, new ---- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {error && <ErrorBanner>{error}</ErrorBanner>}

          {shown && (
            <Card>
              <div style={{ font: "650 17px var(--font-ui)", color: "var(--ink)" }}>{shown.name}</div>
              <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-3)", margin: "6px 0 14px" }}>{shown.theme}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                {draft ? (
                  <>
                    <Button variant="primary" onClick={saveDraft} disabled={busy !== null} icon={<Icons.Bookmark />}>
                      {busy === "save" ? "Saving…" : "Save to backgrounds"}
                    </Button>
                    <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy !== null}>
                      Discard
                    </Button>
                  </>
                ) : (
                  selected && (
                    <Button variant="ghost" onClick={() => setConfirmDelete(selected)} icon={<Icons.Trash />}>
                      Delete
                    </Button>
                  )
                )}
                <Button onClick={() => downloadImage(shown.imageUrl, shown.name)} icon={<Icons.Download />}>
                  Download PNG
                </Button>
              </div>
              <div style={label}>Revise it</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={input}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. flood the cabin all the way to the ceiling"
                />
                <Button onClick={revise} disabled={!instruction.trim() || busy !== null} icon={<Icons.Edit />}>
                  {busy === "edit" ? "Working…" : "Revise"}
                </Button>
              </div>
            </Card>
          )}

          <Card>
            <div style={{ font: "650 14px var(--font-ui)", color: "var(--ink)", marginBottom: 12 }}>New background</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={label}>Name</div>
                <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunken Observatory" />
              </div>
              <div>
                <div style={label}>Theme</div>
                <textarea
                  style={{ ...input, minHeight: 80, resize: "vertical" }}
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="a flooded brass observatory with a big telescope at the back, star charts on the walls, glowing orbs; dominant palette: navy, brass, soft gold"
                />
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ width: 170 }}>
                  <div style={label}>Model</div>
                  <select style={input} value={model} onChange={(e) => setModel(e.target.value as BgModelKey)}>
                    <option value="pro">Pro (best)</option>
                    <option value="flash">Flash (fast)</option>
                  </select>
                </div>
                <Button
                  variant="primary"
                  onClick={generateNew}
                  disabled={!name.trim() || !theme.trim() || busy !== null}
                  icon={<Icons.Sparkles />}
                >
                  {busy === "new" ? "Generating… (about a minute)" : "Generate"}
                </Button>
              </div>
              <InfoWell>
                The prompt already enforces the layout rule (fully underwater, open middle, scenery at the edges) and the
                storybook style. Describe the place and a dominant palette. Rooms and spaces work best.
              </InfoWell>
            </div>
          </Card>
        </div>
      </div>

      {/* ---- Library ---- */}
      <div style={{ marginTop: 32 }}>
        <div style={{ font: "650 16px var(--font-ui)", color: "var(--ink)", marginBottom: 12 }}>
          Library{items.length ? ` · ${items.length}` : ""}
        </div>
        {loadError && <ErrorBanner>{loadError}</ErrorBanner>}
        {!loadError && items.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center", border: "1px dashed var(--line-2)", borderRadius: 16, color: "var(--ink-3)" }}>
            <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>No backgrounds yet</div>
            <div style={{ font: "400 13px var(--font-ui)" }}>Generate one above and save it.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 104 : 132}px, 1fr))`, gap: 12 }}>
            {items.map((row) => {
              const sel = row.id === selectedId && !draft;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setSelectedId(row.id);
                    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  style={{ padding: 0, border: "none", background: "none", cursor: "pointer", textAlign: "left" }}
                >
                  <div
                    style={{
                      position: "relative",
                      aspectRatio: "9 / 19.5",
                      borderRadius: 14,
                      overflow: "hidden",
                      outline: sel ? "3px solid var(--accent)" : "1px solid var(--line)",
                      outlineOffset: sel ? 2 : 0,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resizedUrl(row.image_url, 320)}
                      alt={row.name}
                      loading="lazy"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                  <div style={{ marginTop: 6, font: "600 12.5px var(--font-ui)", color: "var(--ink)" }}>{row.name}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete background?"
          message={`“${confirmDelete.name}” will be removed from the library.`}
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onConfirm={() => doDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
