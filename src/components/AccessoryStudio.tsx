"use client";

/**
 * Accessory Studio: generate new companion-fish accessories (hats, glasses,
 * neckwear, plushies) in the lootbox 1-3 art style and export them as SVGs
 * on the same 1920x1080 frame as the shipped assets.
 *
 *   On Sushi:        Gemini draws it on Sushi -> Gemini deletes the fish
 *                    -> Recraft vectorize -> normalize (here, via getBBox)
 *   Match existing:  Gemini draws it standalone copying a reference
 *                    accessory's silhouette -> vectorize -> normalize
 *
 * Server side: /api/accessory-studio/{generate,vectorize,items}.
 */
import * as React from "react";
import { Button, useToast } from "./ui";
import { PageHeader } from "./Shell";
import { Icons } from "./Icons";
import { Card, ErrorBanner, InfoWell, Segmented } from "./porcelain";
import { ConfirmDialog } from "./ConfirmDialog";
import { useIsMobile } from "@/lib/useIsMobile";
import { useElementWidth } from "@/lib/useElementWidth";
import {
  ACCESSORY_SLOTS,
  BUILTIN_REFS,
  FRAME_H,
  FRAME_MARGIN,
  FRAME_W,
  SUSHI_REF_PATH,
  slugify,
  type AccessoryModelKey,
  type AccessoryRow,
  type AccessorySlot,
} from "@/lib/accessory-studio-shared";

type Mode = "fish" | "match";
type Stage = "onfish" | "extract" | "match" | "vectorize";
type MatchRef = { label: string; path?: string; url?: string };

const MODE_KEY = "dreamme.accessoryStudio.mode";

const STAGE_LABEL: Record<Stage, string> = {
  onfish: "Drawing it on Sushi",
  extract: "Removing Sushi",
  match: "Drawing from the reference",
  vectorize: "Vectorizing",
};

// Where the finished SVG frame sits over the 600px Sushi preview, per slot.
const OVERLAY_DEFAULTS: Record<AccessorySlot, { w: number; x: number; y: number }> = {
  hat: { w: 400, x: 150, y: 40 },
  glasses: { w: 420, x: 122, y: 150 },
  neck: { w: 380, x: 160, y: 290 },
  handheld: { w: 300, x: 190, y: 290 },
};

async function toBase64(path: string): Promise<{ base64: string; mimeType: "image/png" }> {
  const blob = await (await fetch(path)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return { base64: dataUrl.split(",")[1] ?? "", mimeType: "image/png" };
}

/**
 * Re-center a Recraft SVG on the 1920x1080 frame with the lootbox 2/3
 * margin. Needs a live DOM for getBBox, which is why this runs here and
 * not on the server.
 */
function normalizeSvg(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new Error("vectorizer did not return an SVG");
  const inner = root.innerHTML;
  const viewBox = root.getAttribute("viewBox") ?? "0 0 2048 2048";
  const NS = "http://www.w3.org/2000/svg";
  const probe = document.createElementNS(NS, "svg");
  probe.setAttribute("viewBox", viewBox);
  probe.setAttribute("width", "200");
  probe.setAttribute("height", "200");
  probe.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden";
  const g = document.createElementNS(NS, "g");
  g.innerHTML = inner;
  probe.appendChild(g);
  document.body.appendChild(probe);
  let box: DOMRect;
  try {
    box = g.getBBox();
  } finally {
    probe.remove();
  }
  if (!box.width || !box.height) throw new Error("SVG is empty after cleanup");
  const s = Math.min((FRAME_W - 2 * FRAME_MARGIN) / box.width, (FRAME_H - 2 * FRAME_MARGIN) / box.height);
  const tx = (FRAME_W - box.width * s) / 2 - box.x * s;
  const ty = (FRAME_H - box.height * s) / 2 - box.y * s;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${FRAME_W} ${FRAME_H}">` +
    `<g transform="translate(${tx.toFixed(4)},${ty.toFixed(4)}) scale(${s.toFixed(6)})">${inner}</g></svg>\n`
  );
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function downloadSvg(svg: string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = `${name}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

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

function Frame({ src, alt, aspect = "1 / 1", children }: { src?: string | null; alt: string; aspect?: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: aspect,
        borderRadius: 12,
        border: "1px solid var(--line)",
        background: "#fff",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : children}
    </div>
  );
}

function StageCard({
  title,
  src,
  aspect,
  busy,
  onRedo,
  canRedo,
}: {
  title: string;
  src: string | null;
  aspect?: string;
  busy: boolean;
  onRedo?: () => void;
  canRedo: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", minHeight: 30 }}>
        <div style={{ font: "650 13px var(--font-ui)", color: "var(--ink)", whiteSpace: "nowrap" }}>{title}</div>
        {onRedo && (
          <Button size="sm" variant="ghost" onClick={onRedo} disabled={!canRedo} icon={<Icons.Refresh />}>
            Redo
          </Button>
        )}
      </div>
      <Frame src={src} alt={title} aspect={aspect}>
        <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-4)" }}>{busy ? "Working…" : "Not run yet"}</div>
      </Frame>
    </div>
  );
}

export function AccessoryStudio() {
  const isMobile = useIsMobile();
  const toast = useToast();
  // The sidebar eats ~240px, so the viewport breakpoint alone leaves the
  // two-column layout crushed on mid-size windows. Stack on content width.
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const narrow = isMobile || (rootWidth > 0 && rootWidth < 900);

  const [mode, setModeState] = React.useState<Mode>("fish");
  const [item, setItem] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [slot, setSlot] = React.useState<AccessorySlot>("hat");
  const [model, setModel] = React.useState<AccessoryModelKey>("flash");
  const [matchRef, setMatchRef] = React.useState<MatchRef>({ label: BUILTIN_REFS[0].label, path: BUILTIN_REFS[0].path });

  const [onfishUrl, setOnfishUrl] = React.useState<string | null>(null);
  const [soloUrl, setSoloUrl] = React.useState<string | null>(null);
  const [svg, setSvg] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState<Stage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [overlay, setOverlay] = React.useState(OVERLAY_DEFAULTS.hat);

  const [library, setLibrary] = React.useState<AccessoryRow[]>([]);
  const [libError, setLibError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<AccessoryRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "fish" || m === "match") setModeState(m);
    } catch {
      /* private mode */
    }
  }, []);

  const setMode = (m: Mode) => {
    if (m !== mode) {
      setOnfishUrl(null);
      setSoloUrl(null);
      setSvg(null);
      setError(null);
      setSavedId(null);
    }
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  React.useEffect(() => setOverlay(OVERLAY_DEFAULTS[slot]), [slot]);

  const loadLibrary = React.useCallback(async () => {
    try {
      const res = await fetch("/api/accessory-studio/items", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        const msg: string = json.error ?? "failed";
        throw new Error(
          /PGRST205|Could not find the table/.test(msg)
            ? "The library table isn't created yet. Migration 0080 creates it when this deploys; generating and downloading still work."
            : msg,
        );
      }
      setLibrary(json.items ?? []);
      setLibError(null);
    } catch (e) {
      setLibError((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const ready = item.trim().length > 0 && subject.trim().length > 0 && !running;

  async function rasterStep(step: "onfish" | "extract" | "match", reference: unknown): Promise<string> {
    setRunning(step);
    const { imageUrl } = await postJson<{ imageUrl: string }>("/api/accessory-studio/generate", {
      step,
      item: item.trim(),
      subject: subject.trim(),
      slot,
      model,
      reference,
    });
    return imageUrl;
  }

  async function vectorizeStep(url: string) {
    setRunning("vectorize");
    const { svg: raw } = await postJson<{ svg: string }>("/api/accessory-studio/vectorize", { imageUrl: url });
    setSvg(normalizeSvg(raw));
  }

  /** Run the pipeline starting at `from`, reusing earlier stages. */
  async function run(from: Stage) {
    setError(null);
    setSavedId(null);
    try {
      if (mode === "fish") {
        let fishUrl = onfishUrl;
        let solo = soloUrl;
        if (from === "onfish") {
          setOnfishUrl(null);
          setSoloUrl(null);
          setSvg(null);
          fishUrl = await rasterStep("onfish", await toBase64(SUSHI_REF_PATH));
          setOnfishUrl(fishUrl);
        }
        if (from === "onfish" || from === "extract") {
          if (!fishUrl) throw new Error("run the Sushi step first");
          setSoloUrl(null);
          setSvg(null);
          solo = await rasterStep("extract", { url: fishUrl });
          setSoloUrl(solo);
        }
        if (!solo) throw new Error("no standalone image to vectorize");
        await vectorizeStep(solo);
      } else {
        let solo = soloUrl;
        if (from === "match") {
          setOnfishUrl(null);
          setSoloUrl(null);
          setSvg(null);
          const ref = matchRef.url ? { url: matchRef.url } : await toBase64(matchRef.path ?? BUILTIN_REFS[0].path);
          solo = await rasterStep("match", ref);
          setSoloUrl(solo);
        }
        if (!solo) throw new Error("no standalone image to vectorize");
        await vectorizeStep(solo);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  async function save() {
    if (!svg) return;
    setSaving(true);
    try {
      const { item: row } = await postJson<{ item: AccessoryRow }>("/api/accessory-studio/items", {
        item: item.trim(),
        subject: subject.trim(),
        slot,
        mode,
        model,
        onfishUrl: mode === "fish" ? onfishUrl : null,
        soloUrl,
        svg,
      });
      setSavedId(row.id);
      setLibrary((l) => [row, ...l]);
      toast("Saved to the accessory library");
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(row: AccessoryRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/accessory-studio/items?id=${row.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setLibrary((l) => l.filter((r) => r.id !== row.id));
      toast("Deleted");
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  function pickAsMatchRef(row: AccessoryRow) {
    if (!row.solo_url) return;
    setMode("match");
    setMatchRef({ label: row.item, url: row.solo_url });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function downloadSaved(row: AccessoryRow) {
    try {
      downloadSvg(await (await fetch(row.svg_url)).text(), row.slug);
    } catch (e) {
      toast(`Download failed: ${(e as Error).message}`);
    }
  }

  const fileName = slugify(item) || "accessory";
  const firstStage: Stage = mode === "fish" ? "onfish" : "match";

  return (
    <div ref={rootRef}>
      <PageHeader
        eyebrow="Product"
        title="Accessory Studio"
        subtitle="New fish accessories in the lootbox 1-3 style: Gemini draws it, Recraft vectorizes it, and it comes out as an SVG on the same 1920x1080 frame as the shipped ones."
      />

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "340px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        {/* ---- Composer ---- */}
        <Card>
          <div style={{ marginBottom: 16 }}>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={[
                { value: "fish", label: "On Sushi" },
                { value: "match", label: "Match existing" },
              ]}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={label}>Item</div>
              <input style={input} value={item} onChange={(e) => setItem(e.target.value)} placeholder="santa hat" />
            </div>
            <div>
              <div style={label}>{mode === "fish" ? "Description" : "What's different from the reference"}</div>
              <textarea
                style={{ ...input, minHeight: 88, resize: "vertical" }}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={
                  mode === "fish"
                    ? "red santa hat with a white fluffy brim and a white pompom; the hat MUST be bright red"
                    : "no ears; bright red with thin dark red web lines and two big white teardrop eye lenses"
                }
              />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={label}>Slot</div>
                <select style={input} value={slot} onChange={(e) => setSlot(e.target.value as AccessorySlot)}>
                  {ACCESSORY_SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={label}>Model</div>
                <select style={input} value={model} onChange={(e) => setModel(e.target.value as AccessoryModelKey)}>
                  <option value="flash">Flash (fast)</option>
                  <option value="pro">Pro (closer shapes)</option>
                </select>
              </div>
            </div>

            {mode === "match" && (
              <div>
                <div style={label}>Reference: {matchRef.label}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {BUILTIN_REFS.map((r) => {
                    const sel = matchRef.path === r.path && !matchRef.url;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        title={r.label}
                        onClick={() => setMatchRef({ label: r.label, path: r.path })}
                        style={{
                          padding: 0,
                          aspectRatio: "1 / 1",
                          borderRadius: 8,
                          overflow: "hidden",
                          cursor: "pointer",
                          background: "#fff",
                          border: sel ? "2px solid var(--accent)" : "1px solid var(--line)",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.path} alt={r.label} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      </button>
                    );
                  })}
                </div>
                {matchRef.url && (
                  <InfoWell style={{ marginTop: 8 }}>Using saved accessory “{matchRef.label}” as the reference.</InfoWell>
                )}
              </div>
            )}

            <Button
              variant="primary"
              onClick={() => run(firstStage)}
              disabled={!ready}
              icon={<Icons.Sparkles />}
            >
              {running ? `${STAGE_LABEL[running]}…` : "Generate"}
            </Button>
            <InfoWell>
              {mode === "fish"
                ? "Uses your Gemini prompt with Sushi as the reference, then asks Gemini to delete the fish. Pin colors that matter (“MUST be red”), or the prompt pushes it toward contrast with coral."
                : "Draws the item on its own, copying the reference's silhouette and angle. Use it for licensed characters (Gemini refuses to edit them off Sushi) and for “like X but Y”."}
            </InfoWell>
          </div>
        </Card>

        {/* ---- Stages + result ---- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Card>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : mode === "fish" ? "1fr 1fr 1.6fr" : "1fr 1.6fr",
                gap: 14,
              }}
            >
              {mode === "fish" && (
                <StageCard
                  title="1 · On Sushi"
                  src={onfishUrl}
                  busy={running === "onfish"}
                  onRedo={() => run("onfish")}
                  canRedo={ready}
                />
              )}
              <StageCard
                title={mode === "fish" ? "2 · Standalone" : "1 · Standalone"}
                src={soloUrl}
                busy={running === "extract" || running === "match"}
                onRedo={() => run(mode === "fish" ? "extract" : "match")}
                canRedo={ready && (mode === "match" || !!onfishUrl)}
              />
              <div style={{ gridColumn: isMobile ? "1 / -1" : undefined, minWidth: 0 }}>
                <StageCard
                  title={mode === "fish" ? "3 · SVG" : "2 · SVG"}
                  src={svg ? svgDataUrl(svg) : null}
                  aspect="16 / 9"
                  busy={running === "vectorize"}
                  onRedo={() => run("vectorize")}
                  canRedo={!running && !!soloUrl}
                />
              </div>
            </div>
          </Card>

          {svg && (
            <Card>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 300px) 1fr", gap: 20, alignItems: "start" }}>
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 12,
                    border: "1px solid var(--line)",
                    background: "#fff",
                    overflow: "hidden",
                  }}
                >
                  {/* Sushi is a 600px square; overlay numbers are in that space. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={SUSHI_REF_PATH} alt="Sushi" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={svgDataUrl(svg)}
                    alt="accessory on Sushi"
                    style={{
                      position: "absolute",
                      width: `${(overlay.w / 600) * 100}%`,
                      left: `${(overlay.x / 600) * 100}%`,
                      top: `${(overlay.y / 600) * 100}%`,
                    }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ font: "650 14px var(--font-ui)", color: "var(--ink)" }}>Preview on Sushi</div>
                  {(["w", "x", "y"] as const).map((k) => (
                    <label key={k} style={{ display: "flex", alignItems: "center", gap: 10, font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>
                      <span style={{ width: 44 }}>{k === "w" ? "Size" : k === "x" ? "Left" : "Top"}</span>
                      <input
                        type="range"
                        min={k === "w" ? 100 : -200}
                        max={k === "w" ? 900 : 500}
                        value={overlay[k]}
                        onChange={(e) => setOverlay((o) => ({ ...o, [k]: Number(e.target.value) }))}
                        style={{ flex: 1 }}
                      />
                    </label>
                  ))}
                  <InfoWell>Only a preview. Real placement comes from the Rive file.</InfoWell>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button variant="primary" onClick={save} disabled={saving || !!savedId} icon={<Icons.Bookmark />}>
                      {savedId ? "Saved" : saving ? "Saving…" : "Save to library"}
                    </Button>
                    <Button onClick={() => downloadSvg(svg, fileName)} icon={<Icons.Download />}>
                      Download SVG
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ---- Library ---- */}
      <div style={{ marginTop: 32 }}>
        <div style={{ font: "650 16px var(--font-ui)", color: "var(--ink)", marginBottom: 12 }}>
          Library{library.length ? ` · ${library.length}` : ""}
        </div>
        {libError && <ErrorBanner>{libError}</ErrorBanner>}
        {!libError && library.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center", border: "1px dashed var(--line-2)", borderRadius: 16, color: "var(--ink-3)" }}>
            <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>No saved accessories yet</div>
            <div style={{ font: "400 13px var(--font-ui)" }}>Generate one above and hit Save to library.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 220}px, 1fr))`, gap: 12 }}>
            {library.map((row) => (
              <Card key={row.id} pad={10}>
                <Frame src={row.svg_url} alt={row.item} aspect="16 / 9" />
                <div style={{ marginTop: 8, font: "650 13px var(--font-ui)", color: "var(--ink)" }}>{row.item}</div>
                <div style={{ font: "400 11.5px var(--font-ui)", color: "var(--ink-4)", marginBottom: 8 }}>
                  {row.slot} · {row.mode === "fish" ? "on Sushi" : "matched"} · {new Date(row.created_at).toLocaleDateString()}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <Button size="sm" onClick={() => downloadSaved(row)} icon={<Icons.Download />} title="Download SVG" />
                  {row.solo_url && (
                    <Button size="sm" variant="ghost" onClick={() => pickAsMatchRef(row)} title="Use as Match reference">
                      Match
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(row)} icon={<Icons.Trash />} title="Delete" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete accessory?"
          message={`“${confirmDelete.item}” and its SVG will be removed from the library.`}
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
