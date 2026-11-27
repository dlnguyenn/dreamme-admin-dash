"use client";

/**
 * One competitor ad. Desktop: the creative on the left with the actions under
 * it, the facts on the right (rank, movement, days, copies first, then Details
 * and Transcript). Previous / Next (and the arrow keys) walk the list the ad
 * was opened from. Loads /api/competitor-ads/ad/:id for the rank history,
 * storyboard and transcript.
 */

import * as React from "react";
import { SideDrawer } from "../SideDrawer";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { Segmented } from "../porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import { briefFromAd, cppUrl, type AdView } from "@/lib/competitor-ads-tab/logic";
import type { AdDetail } from "@/lib/competitor-ads-tab/read";
import { MoveText, RankLine, adHeadline, mediaLabel, num, rankText, shortDay } from "./parts";

const label: React.CSSProperties = { font: "600 13px var(--font-ui)", color: "var(--ink)", margin: "24px 0 8px" };
const body: React.CSSProperties = { font: "400 13.5px/1.55 var(--font-ui)", color: "var(--ink)", margin: 0 };
const quiet: React.CSSProperties = { ...body, color: "var(--ink-2)", fontSize: 13 };

export function AdDrawer({
  ad,
  saved,
  position,
  onPrev,
  onNext,
  onClose,
  onSave,
  onUnsave,
}: {
  ad: AdView | null;
  saved: { note: string } | null;
  /** Where the ad sits in the list it was opened from, when there is one. */
  position: { index: number; total: number } | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  onSave: (ad: AdView, note: string) => Promise<void>;
  onUnsave: (ad: AdView) => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  // Two columns need about 1000 px; between the phone breakpoint and that, stack them.
  const [wide, setWide] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1000px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const stacked = isMobile || !wide;
  const [detail, setDetail] = React.useState<AdDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [tab, setTab] = React.useState<"details" | "transcript">("details");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setNote(saved?.note ?? "");
    scrollRef.current?.scrollTo({ top: 0 });
    if (!ad) return;
    let alive = true;
    fetch(`/api/competitor-ads/ad/${ad.adArchiveId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        if (!b.ok) throw new Error(b.error ?? "load failed");
        setDetail(b as AdDetail);
      })
      .catch((e) => alive && setDetailError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad?.adArchiveId]);

  // Arrow keys walk the list, except while typing a note.
  React.useEffect(() => {
    if (!ad) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "VIDEO")) return;
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ad, onPrev, onNext]);

  if (!ad) return null;

  const transcript = detail?.archive?.timed?.length ? null : detail?.archive?.transcript || detail?.storyboard?.transcript || null;
  const timed = detail?.archive?.timed?.length ? detail.archive.timed : null;
  const opening = (detail?.storyboard?.beats ?? [])
    .filter((b) => b.start < 3 && b.onScreen)
    .filter((b, i, all) => i === 0 || all[i - 1].onScreen !== b.onScreen);
  const firstSpoken = timed?.[0]?.text ?? transcript?.split(/(?<=[.!?])\s/)[0] ?? null;
  const storePage = ad.landing.cpp && ad.landing.appId ? cppUrl(ad.landing.appId, ad.landing.cpp) : null;
  const hasTranscript = !!(timed || transcript);

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast("Couldn't copy: the browser blocked the clipboard");
    }
  };
  const toggleSave = async () => {
    setBusy(true);
    try {
      if (saved) await onUnsave(ad);
      else await onSave(ad, note);
    } finally {
      setBusy(false);
    }
  };

  const nav = (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <Button size="sm" variant="ghost" icon={<Icons.ChevronLeft />} onClick={onPrev ?? undefined} disabled={!onPrev} title="Previous ad (left arrow)">
        {isMobile ? undefined : "Previous"}
      </Button>
      {position && (
        <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums", padding: "0 4px", whiteSpace: "nowrap" }}>
          {position.index + 1} of {position.total}
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={onNext ?? undefined} disabled={!onNext} title="Next ad (right arrow)">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {isMobile ? null : "Next"}
          <Icons.ChevronRight size={16} />
        </span>
      </Button>
    </div>
  );

  const creative = (
    <div style={{ display: "flex", justifyContent: "center", background: "var(--bg-2)", borderRadius: 12, overflow: "hidden" }}>
      {ad.video ? (
        <video key={ad.video} src={ad.video} poster={ad.thumb ?? undefined} controls playsInline preload="metadata" style={{ display: "block", width: "100%", maxHeight: isMobile ? 440 : "calc(100vh - 260px)", background: "var(--bg-2)" }} />
      ) : ad.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.thumb} alt="" style={{ display: "block", maxWidth: "100%", maxHeight: isMobile ? 440 : "calc(100vh - 260px)", objectFit: "contain" }} />
      ) : (
        <div style={{ padding: "48px 18px", font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)", textAlign: "center" }}>
          No creative captured yet. Meta often shows none on an ad&apos;s first day; the next scrape usually fills it in.
        </div>
      )}
    </div>
  );

  const actions = (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <Button size="sm" variant={saved ? "secondary" : "primary"} icon={saved ? <Icons.BookmarkFilled /> : <Icons.Bookmark />} onClick={toggleSave} disabled={busy}>
          {saved ? "Saved" : "Save ad"}
        </Button>
        <Button size="sm" variant="secondary" icon={<Icons.Copy />} onClick={() => void copy(briefFromAd(ad, firstSpoken), "Brief copied")}>
          Copy a brief
        </Button>
        <a href={ad.adLibraryUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <Button size="sm" variant="ghost" icon={<Icons.Link />}>
            Ad Library
          </Button>
        </a>
      </div>
      <textarea
        aria-label="Note for the saved ad"
        placeholder={saved ? "Note, saved with the ad" : "Note (saved when you save the ad)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (saved && note !== saved.note) void onSave(ad, note);
        }}
        rows={2}
        className="cad-focus"
        style={{
          width: "100%",
          marginTop: 10,
          boxSizing: "border-box",
          font: "400 13px/1.45 var(--font-ui)",
          padding: "8px 10px",
          border: "1px solid var(--line-2)",
          borderRadius: 10,
          background: "var(--surface)",
          color: "var(--ink)",
          resize: "vertical",
        }}
      />
    </>
  );

  const facts = (
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, margin: 0 }}>
      {[
        ["Rank today", rankText(ad.rank.now), <MoveText key="m" ad={ad} />],
        ["A week ago", rankText(ad.rank.ago7), ad.rank.ago14 != null ? `${rankText(ad.rank.ago14)} two weeks ago` : null],
        ad.endedAt
          ? ["Days it ran", num(ad.runDays), ad.startedAt ? `${shortDay(ad.startedAt)} to ${shortDay(ad.endedAt)}` : `stopped ${shortDay(ad.endedAt)}`]
          : ["Days live", num(ad.runDays), ad.startedAt ? `since ${shortDay(ad.startedAt)}` : null],
        ["Copies", num(ad.copies), ad.copies === 1 ? "this creative only" : ad.endedAt ? "copies of it" : "live copies of it"],
      ].map(([k, v, sub]) => (
        <div key={String(k)} style={{ minWidth: 0 }}>
          <dt style={{ font: "400 12px var(--font-ui)", color: "var(--ink-2)" }}>{k}</dt>
          <dd style={{ margin: "2px 0 0", font: "650 20px var(--font-ui)", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{v}</dd>
          {sub && <dd style={{ margin: "2px 0 0", font: "400 12px var(--font-ui)", color: "var(--ink-2)" }}>{sub}</dd>}
        </div>
      ))}
    </dl>
  );

  const details = (
    <>
      <div style={label}>Rank by day</div>
      {detail ? <RankLine points={detail.ranks} /> : <div style={{ height: 120, background: "var(--bg-2)", borderRadius: 8 }} />}

      {opening.length > 0 && (
        <>
          <div style={label}>On screen in the first 3 seconds</div>
          {opening.map((b, i) => (
            <p key={i} style={{ ...body, marginBottom: 6, display: "grid", gridTemplateColumns: "44px 1fr", gap: 8 }}>
              <span style={{ color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>{b.start.toFixed(1)} s</span>
              <span>{b.onScreen}</span>
            </p>
          ))}
        </>
      )}

      <div style={label}>
        Signals: {ad.confidence.met} of {ad.confidence.of} agree
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {ad.confidence.signals.map((s) => (
          <li key={s.key} style={{ display: "flex", gap: 8, alignItems: "baseline", font: "400 13px var(--font-ui)", color: "var(--ink)" }}>
            <span style={{ color: s.met ? "var(--success-text)" : "var(--ink-2)", fontWeight: 600, minWidth: 30 }}>{s.met ? "Yes" : "No"}</span>
            {s.label}
          </li>
        ))}
      </ul>

      <div style={label}>Where the click goes</div>
      <p style={body}>
        {ad.landing.kind === "none" && "No link captured for this ad."}
        {ad.landing.kind === "play" && "Google Play."}
        {ad.landing.kind === "web" && "A web page."}
        {ad.landing.kind === "app_store" && !ad.landing.cpp && "The default App Store page."}
        {storePage && (
          <>
            Custom Product Page {ad.landing.cpp!.slice(0, 8)}.{" "}
            <a href={storePage} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>
              Open the page
            </a>
          </>
        )}
      </p>

      {ad.body && (
        <>
          <div style={label}>Ad copy</div>
          <p style={{ ...body, whiteSpace: "pre-wrap" }}>{ad.body}</p>
        </>
      )}

      {detail?.storyboard?.whyItWorks && (
        <>
          <div style={label}>Storyboard note</div>
          <p style={body}>{detail.storyboard.whyItWorks}</p>
        </>
      )}

      {(ad.angle || ad.theme || ad.format) && (
        <>
          <div style={label}>Outlier&apos;s tags</div>
          <p style={quiet}>{[ad.format, ad.theme, ad.angle].filter(Boolean).join(", ")}</p>
        </>
      )}
      {ad.euReach != null && <p style={{ ...quiet, marginTop: 18 }}>EU reach {num(ad.euReach)}.</p>}
    </>
  );

  const transcriptTab = (
    <>
      {hasTranscript ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "18px 0 12px" }}>
            {detail?.archive?.productMentionS != null && (
              <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)" }}>App first mentioned at {detail.archive.productMentionS.toFixed(1)} s</span>
            )}
            <span style={{ marginLeft: "auto" }}>
              <Button size="sm" variant="secondary" icon={<Icons.Copy />} onClick={() => void copy(timed ? timed.map((s) => s.text).join(" ") : transcript ?? "", "Transcript copied")}>
                Copy transcript
              </Button>
            </span>
          </div>
          {timed ? (
            <div style={{ display: "grid", gap: 6 }}>
              {timed.map((s, i) => (
                <p key={i} style={{ ...body, display: "grid", gridTemplateColumns: "44px 1fr", gap: 8 }}>
                  <span style={{ color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>{s.start.toFixed(1)} s</span>
                  <span>{s.text}</span>
                </p>
              ))}
            </div>
          ) : (
            <p style={body}>{transcript}</p>
          )}
        </>
      ) : (
        <p style={{ ...quiet, marginTop: 18 }}>
          {!detail ? "Loading…" : detail.archive ? "Foreplay has this ad but didn't transcribe it." : "This ad isn't in the Foreplay pull and has no storyboard yet."}
        </p>
      )}
    </>
  );

  const info = (
    <>
      {facts}
      <div style={{ marginTop: 20 }}>
        <Segmented
          size="sm"
          value={tab}
          onChange={(v) => setTab(v as "details" | "transcript")}
          options={[
            { value: "details", label: "Details" },
            { value: "transcript", label: hasTranscript ? "Transcript" : "Transcript (none)" },
          ]}
        />
      </div>
      {tab === "details" ? details : transcriptTab}
      {detailError && <p style={{ ...body, color: "var(--danger-text)", marginTop: 16 }}>Couldn&apos;t load the rank history and transcript: {detailError}</p>}
    </>
  );

  return (
    <SideDrawer open onClose={onClose} ariaLabel="Competitor ad" desktopWidth={1040}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: isMobile ? "10px 10px 10px 16px" : "12px 18px 12px 26px", borderBottom: "1px solid var(--line)" }}>
        {nav}
        <span style={{ marginLeft: "auto" }}>
          <Button size="sm" variant="ghost" icon={<Icons.Close />} onClick={onClose} title="Close (Esc)">
            {isMobile ? undefined : "Close"}
          </Button>
        </span>
      </div>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? "16px 16px 40px" : "22px 26px 48px" }}>
        <h2 style={{ font: "650 18px/1.35 var(--font-ui)", margin: 0, color: "var(--ink)", maxWidth: 820 }}>{adHeadline(ad)}</h2>
        <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)", marginTop: 6 }}>
          {ad.brand}, {ad.isPartnership ? `runs as ${ad.identity}` : "brand page"} · {mediaLabel(ad.mediaType)}
          {ad.videoSeconds ? `, ${ad.videoSeconds} s` : ""}
        </div>
        {stacked ? (
          <div style={{ marginTop: 14, maxWidth: isMobile ? undefined : 560 }}>
            {creative}
            {actions}
            <div style={{ marginTop: 22 }}>{info}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 340px) minmax(0, 1fr)", gap: 30, marginTop: 18, alignItems: "start" }}>
            <div style={{ position: "sticky", top: 0 }}>
              {creative}
              {actions}
            </div>
            <div style={{ minWidth: 0 }}>{info}</div>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}
