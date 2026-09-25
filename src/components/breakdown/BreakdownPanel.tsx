"use client";

/**
 * Ad breakdown panel: numbers, the hook strip (3 fps over 0-3 s), where
 * viewers leave (Meta's retention intervals with the frames and words from
 * each), the listen pass, the Motion-rubric pre-flight and Claude's verdict.
 * Frames are captured in the browser from the re-hosted video (one decode
 * pass for the whole panel); the server never touches ffmpeg.
 */

import * as React from "react";
import { useVideoFrames, frameKey, type FrameCapture } from "@/lib/ad-breakdown/useVideoFrames";
import type { BreakdownRow } from "@/lib/ad-breakdown/pipeline";
import { CRITERION_KEYS, hookBand, holdBand, type FrameTime, type Interval } from "@/lib/ad-breakdown/rubric";
import { MarkdownLite, fmtUSD, fmtInt, fmtPct } from "../growth/shared";

const MONO = "var(--font-geist-mono), var(--font-mono), monospace";

export function BreakdownPanel({
  adId,
  uploadPath,
  name,
  initialRow,
  compact = false,
}: {
  adId?: string;
  uploadPath?: string;
  name?: string;
  initialRow?: BreakdownRow | null;
  compact?: boolean;
}) {
  const [row, setRow] = React.useState<BreakdownRow | null>(initialRow ?? null);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "running" | "error">(initialRow ? "idle" : "loading");
  const [error, setError] = React.useState<string | null>(null);
  const query = adId ? `ad_id=${adId}` : uploadPath ? `upload_path=${encodeURIComponent(uploadPath)}` : "";

  React.useEffect(() => {
    if (initialRow) {
      setRow(initialRow);
      setPhase("idle");
      return;
    }
    if (!query) return;
    let alive = true;
    setPhase("loading");
    fetch(`/api/ad-breakdown?${query}`)
      .then((r) => (r.ok ? (r.json() as Promise<BreakdownRow | null>) : null))
      .then((r) => {
        if (!alive) return;
        setRow(r && r.status === "done" ? r : null);
        setPhase("idle");
      })
      .catch(() => alive && setPhase("idle"));
    return () => {
      alive = false;
    };
  }, [query, initialRow]);

  const run = async (force: boolean) => {
    setPhase("running");
    setError(null);
    try {
      const res = await fetch("/api/ad-breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adId ? { ad_id: adId, name, force } : { upload_path: uploadPath, name, force }),
      });
      const body = (await res.json()) as BreakdownRow & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRow(body);
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const frames = React.useMemo(() => (row?.status === "done" ? row.frames ?? [] : []), [row]);
  const capture = useVideoFrames(row?.status === "done" ? row.video_url : null, frames.map((f) => f.t), 300);

  if (phase === "loading") return <Muted>checking for a saved breakdown…</Muted>;

  if (!row || row.status !== "done") {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {phase === "running" ? (
          <Muted pulse>downloading, watching, grading… about 45 s</Muted>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <RunButton onClick={() => void run(false)}>✦ Break down this {adId ? "ad" : "video"}</RunButton>
            <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
              frames + transcript + Gemini listen + Motion rubric{adId ? ", aligned to Meta retention" : ""}
            </span>
          </div>
        )}
        {phase === "error" && error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );
  }

  const m = row.metrics;
  const listen = row.listen;
  const pf = row.preflight;
  const sc = row.scores;
  const intervals = row.retention?.intervals ?? [];
  const biggest = intervals.length ? intervals.reduce((a, b) => (b.lost > a.lost ? b : a)) : null;
  const hookFrames = frames.filter((f) => f.kind === "hook");
  const bodyFrames = frames.filter((f) => f.kind !== "hook");
  const thumbW = compact ? 88 : 104;

  return (
    <div style={{ display: "grid", gap: compact ? 16 : 22 }}>
      {/* header */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {row.video_url && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={row.video_url}
            controls
            preload="metadata"
            playsInline
            style={{ width: compact ? 132 : 160, aspectRatio: "9 / 16", background: "#000", borderRadius: 10, border: "1px solid var(--line)" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: MONO }}>
            {row.duration_s ? `${Number(row.duration_s).toFixed(1)}s` : ""}
            {row.ad ? ` · ${row.ad.campaign} · ${row.ad.adset} · ${row.ad.status}` : " · uploaded pre-flight"}
            {" · "}
            {fmtDate(row.updated_at)}
          </div>
          {row.ad?.primary_text && (
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, maxHeight: 84, overflowY: "auto" }}>
              {row.ad.primary_text}
            </div>
          )}
          {m ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8 }}>
              <Stat label="Spend" value={fmtUSD(m.spend)} />
              <Stat label="Impr" value={fmtInt(m.impressions)} />
              <Stat label="Hook · 3s" value={fmtPct(m.hook_rate)} sub={hookBand(m.hook_rate)} tone={bandTone(hookBand(m.hook_rate))} />
              <Stat label="Hold" value={fmtPct(m.hold_rate)} sub={holdBand(m.hold_rate)} tone={bandTone(holdBand(m.hold_rate))} />
              <Stat label="50%" value={fmtPct(m.p50_rate)} />
              <Stat label="100%" value={fmtPct(m.completion_rate)} />
              <Stat label="CTR" value={`${m.ctr.toFixed(2)}%`} />
              <Stat label="Trials" value={`${fmtInt(m.trials)}`} sub={m.cpt != null ? `${fmtUSD(m.cpt)} each` : undefined} />
            </div>
          ) : (
            <Muted>no Meta numbers: this is a pre-flight of an unaired video</Muted>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => void run(true)} disabled={phase === "running"} style={ghostBtn}>
              {phase === "running" ? "Re-running…" : "↻ Re-run"}
            </button>
            {row.video_url && (
              <a href={`${row.video_url}?download=1`} style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                download video
              </a>
            )}
            {!capture.done && <span style={{ fontSize: 11, color: "var(--ink-4)" }}>capturing frames…</span>}
          </div>
          {phase === "error" && error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </div>

      {/* verdict */}
      {row.verdict && (
        <Section label="Verdict">
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line)", fontSize: 13, lineHeight: 1.55 }}>
            <MarkdownLite text={row.verdict} />
          </div>
        </Section>
      )}

      {/* hook strip */}
      <Section label="Hook · first 3 seconds at 3 fps">
        <FrameGrid frames={hookFrames} capture={capture} videoUrl={row.video_url} width={thumbW} />
        {listen && (
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 8 }}>
            {listen.hook_first_3s}{" "}
            <span style={{ color: "var(--ink-4)" }}>(Gemini hook score {listen.hook_score_1_5}/5: {listen.hook_reasoning})</span>
          </div>
        )}
      </Section>

      {/* where viewers leave */}
      {intervals.length > 0 && (
        <Section label={`Where viewers leave · Meta's nine retention points${biggest ? ` · biggest drop ${biggest.from} → ${biggest.to} (${fmtPct(biggest.share_of_total_loss)} of all loss)` : ""}`}>
          <div style={{ display: "grid", gap: 8 }}>
            {intervals.map((iv) => (
              <IntervalRow key={`${iv.from}-${iv.to}`} iv={iv} frames={frames} capture={capture} videoUrl={row.video_url} isBiggest={iv === biggest} width={compact ? 54 : 64} />
            ))}
          </div>
        </Section>
      )}

      {/* body frames */}
      <Section label="Cuts and milestones">
        <FrameGrid frames={bodyFrames} capture={capture} videoUrl={row.video_url} width={thumbW} />
      </Section>

      {/* pre-flight */}
      {pf && sc && (
        <Section label={`Pre-flight vs Motion's winning-ad formula · ${sc.formula.score}/${sc.formula.max}`}>
          <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>
            <b>{pf.hook_tactic_primary}</b> hook{pf.hook_tactic_secondary ? ` (${pf.hook_tactic_secondary})` : ""} · thumbstop: {pf.thumbstop_type} · format: {pf.visual_format} · asset: {pf.asset_type} · stage: {pf.awareness_stage}
            <br />
            persona × pain: {pf.persona_pain}
            <br />
            pacing ({sc.pacing.source}): {sc.pacing.cuts} cuts, median gap {sc.pacing.median_gap_s}s, longest static {sc.pacing.longest_static_s}s
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
            <BandChip label="predicted hook" band={sc.bands.hook} tone={bandTone(sc.bands.hook)} sub={`${sc.bands.hook_points}/6 pts`} />
            <BandChip label="predicted hold" band={sc.bands.hold} tone={bandTone(sc.bands.hold)} sub={`${sc.bands.hold_points}/12 pts`} />
            {m && (
              <>
                <BandChip label="actual hook" band={hookBand(m.hook_rate)} tone={bandTone(hookBand(m.hook_rate))} sub={fmtPct(m.hook_rate)} />
                <BandChip label="actual hold" band={holdBand(m.hold_rate)} tone={bandTone(holdBand(m.hold_rate))} sub={fmtPct(m.hold_rate)} />
              </>
            )}
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
            {CRITERION_KEYS.map((k, i) => {
              const c = sc.criteria[k];
              return (
                <div key={k} style={{ display: "grid", gridTemplateColumns: compact ? "22px 1fr" : "22px 150px 1fr", gap: 10, padding: "7px 10px", alignItems: "start", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 12 }}>
                  <ScoreDot score={c.score} max={k === "x_factor" ? 1 : 2} />
                  {!compact && <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>{k.replace(/_/g, " ")}</span>}
                  <span style={{ color: "var(--ink-3)", lineHeight: 1.45 }}>
                    {compact && <b style={{ color: "var(--ink-2)" }}>{k.replace(/_/g, " ")}: </b>}
                    {c.evidence}
                  </span>
                </div>
              );
            })}
            <div style={{ display: "grid", gridTemplateColumns: compact ? "22px 1fr" : "22px 150px 1fr", gap: 10, padding: "7px 10px", borderTop: "1px solid var(--line)", fontSize: 12 }}>
              <ScoreDot score={sc.pacing.score} max={2} />
              {!compact && <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>pacing (measured)</span>}
              <span style={{ color: "var(--ink-3)" }}>{compact && <b style={{ color: "var(--ink-2)" }}>pacing: </b>}median cut gap {sc.pacing.median_gap_s}s; Motion wants a change about every 2 s, single-take yappers excepted</span>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 10 }}>
            <b>Likely leak:</b> {pf.predicted_leak}
            <br />
            <span style={{ color: "var(--ink-3)" }}>{pf.prediction_reasoning} (Gemini's own bands: hook {pf.predicted_hook_band}, hold {pf.predicted_hold_band}.)</span>
          </div>
          {pf.missing_from_formula?.length > 0 && <List title="Missing from the formula" items={pf.missing_from_formula} />}
          {pf.hook_alternatives?.length > 0 && (
            <List
              title="Hook variations to shoot"
              items={pf.hook_alternatives.map((h) => `[${h.tactic}] on screen: “${h.on_screen_text}” · spoken: “${h.spoken}”`)}
            />
          )}
        </Section>
      )}

      {/* listen pass */}
      {listen && (
        <Section label="Listen pass · Gemini">
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
            speech: {listen.speech_type}{listen.speech_delivery ? `, ${listen.speech_delivery}` : ""} · music: {listen.music?.present ? `${listen.music.genre_mood} (energy ${listen.music.energy_1_5}/5)` : "none"}
            {listen.captions_style ? ` · captions: ${listen.captions_style}` : ""} · app first shown: {listen.app_first_shown_s >= 0 ? `${listen.app_first_shown_s}s` : "never"} · CTA: {listen.cta || "none"}
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginTop: 8 }}>
            {listen.scenes.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 10, padding: "7px 10px", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 12 }}>
                <span style={{ fontFamily: MONO, color: "var(--ink-3)", fontSize: 11 }}>{fmtT(s.start_s)}–{fmtT(s.end_s)}s</span>
                <span style={{ lineHeight: 1.45 }}>
                  {s.visual}
                  {s.on_screen_text && <span style={{ color: "var(--accent)" }}> “{s.on_screen_text}”</span>}
                  <span style={{ color: "var(--ink-4)" }}> · {s.audio}</span>
                </span>
              </div>
            ))}
          </div>
          {listen.claims_or_compliance_flags?.length > 0 && <List title="Claims / compliance" items={listen.claims_or_compliance_flags} />}
          {listen.weaknesses?.length > 0 && <List title="Weaknesses" items={listen.weaknesses} />}
          {listen.testable_improvements?.length > 0 && <List title="Testable improvements" items={listen.testable_improvements} />}
        </Section>
      )}

      {/* transcript */}
      <Section label="Transcript · verbatim">
        {listen?.transcript?.length ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)", maxHeight: 220, overflowY: "auto", padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10 }}>
            {listen.transcript.map((s, i) => (
              <div key={i}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--ink-4)" }}>[{fmtT(s.start_s).padStart(4, "0")}]</span> {s.text}
              </div>
            ))}
          </div>
        ) : (
          <Muted>no speech detected: music-only or silent ad</Muted>
        )}
      </Section>
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

function FrameGrid({ frames, capture, videoUrl, width }: { frames: FrameTime[]; capture: FrameCapture; videoUrl: string | null; width: number }) {
  if (frames.length === 0) return <Muted>no frames</Muted>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${width}px, 1fr))`, gap: 8 }}>
      {frames.map((f) => (
        <FrameCell key={`${f.t}-${f.kind}`} f={f} capture={capture} videoUrl={videoUrl} />
      ))}
    </div>
  );
}

function FrameCell({ f, capture, videoUrl }: { f: FrameTime; capture: FrameCapture; videoUrl: string | null }) {
  const src = capture.frames[frameKey(f.t)];
  const milestone = f.kind.startsWith("@");
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ aspectRatio: "9 / 16", background: "var(--surface-2)", borderRadius: 8, overflow: "hidden", border: `1px solid ${milestone ? "var(--ink-3)" : "var(--line)"}` }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : capture.mode === "native" && videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={`${videoUrl}#t=${f.t}`} preload="metadata" muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : null}
      </div>
      <figcaption style={{ font: `500 10px ${MONO}`, color: milestone ? "var(--ink)" : "var(--ink-4)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {f.t.toFixed(2)}s {f.kind}
      </figcaption>
    </figure>
  );
}

function IntervalRow({ iv, frames, capture, videoUrl, isBiggest, width }: { iv: Interval; frames: FrameTime[]; capture: FrameCapture; videoUrl: string | null; isBiggest: boolean; width: number }) {
  const mine = frames.filter((f) => iv.frames?.includes(f.t)).slice(0, 5);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "118px 1fr", gap: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${isBiggest ? "var(--danger-text)" : "var(--line)"}`, background: isBiggest ? "var(--danger-soft)" : "var(--surface)" }}>
      <div style={{ fontSize: 11.5, lineHeight: 1.45 }}>
        <div style={{ fontWeight: 600 }}>{iv.from} → {iv.to}</div>
        <div style={{ fontFamily: MONO, color: "var(--ink-3)", fontSize: 10.5 }}>{iv.t0.toFixed(1)}–{iv.t1.toFixed(1)}s</div>
        <div style={{ color: "var(--ink-2)" }}>lost {fmtPct(iv.lost_pct_of_impr)} · {fmtPct(iv.share_of_total_loss)} of loss</div>
        <div style={{ color: "var(--ink-4)", fontSize: 10.5 }}>{fmtPct(iv.lost_pct_per_sec)}/s</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {mine.map((f) => (
            <div key={f.t} style={{ width }}>
              <FrameCell f={f} capture={capture} videoUrl={videoUrl} />
            </div>
          ))}
        </div>
        {iv.spoken && <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.45 }}>“{iv.spoken}”</div>}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: MONO, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--ink-3)", marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--line)" }}>
      <div style={{ fontSize: 9, fontFamily: MONO, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-3)", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 14.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: tone ? toneFg(tone) : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{sub}</div>}
    </div>
  );
}

function BandChip({ label, band, tone, sub }: { label: string; band: string; tone: Tone; sub?: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", padding: "4px 10px", borderRadius: 999, background: toneBg(tone), color: toneFg(tone), fontSize: 11.5 }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      <b>{band}</b>
      {sub && <span style={{ opacity: 0.75, fontFamily: MONO, fontSize: 10.5 }}>{sub}</span>}
    </span>
  );
}

function ScoreDot({ score, max }: { score: number; max: number }) {
  const tone: Tone = score >= max ? "good" : score > 0 ? "warn" : max === 1 ? "neutral" : "bad";
  return (
    <span style={{ width: 20, height: 20, borderRadius: 999, display: "inline-grid", placeItems: "center", background: toneBg(tone), color: toneFg(tone), font: `700 11px ${MONO}` }}>
      {score}
    </span>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Muted({ children, pulse }: { children: React.ReactNode; pulse?: boolean }) {
  return <div style={{ fontSize: 12, color: "var(--ink-4)", animation: pulse ? "pulse 1.6s ease-in-out infinite" : undefined }}>{children}</div>;
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: "var(--danger-text)", lineHeight: 1.5 }}>{children}</div>;
}

function RunButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid var(--ink)", background: "var(--ink)", color: "var(--surface)", cursor: "pointer" }}>
      {children}
    </button>
  );
}

const ghostBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  background: "var(--surface-2)",
  color: "var(--ink-3)",
  cursor: "pointer",
};

type Tone = "good" | "warn" | "bad" | "neutral";

function bandTone(band: string): Tone {
  return band === "strong" ? "good" : band === "solid" || band === "average" ? "warn" : "bad";
}
function toneBg(t: Tone) {
  return t === "good" ? "var(--success-soft)" : t === "warn" ? "var(--warning-soft)" : t === "bad" ? "var(--danger-soft)" : "var(--neutral-soft)";
}
function toneFg(t: Tone) {
  return t === "good" ? "var(--success-text)" : t === "warn" ? "var(--warning-text)" : t === "bad" ? "var(--danger-text)" : "var(--neutral-text)";
}
function fmtT(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Header + scrollable body for a SideDrawer hosting the panel. */
export function DrawerFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
        <div className="serif" style={{ fontSize: 18, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <button onClick={onClose} aria-label="Close" style={{ ...ghostBtn, fontSize: 13, padding: "4px 10px" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>{children}</div>
    </>
  );
}
