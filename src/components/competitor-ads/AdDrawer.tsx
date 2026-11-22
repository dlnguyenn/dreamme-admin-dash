"use client";

/**
 * One competitor ad: the archived video (or cover), its delivery rank over
 * time, the signals behind its confidence, where the click lands, the first
 * seconds on screen, the transcript, and save / copy-a-brief actions.
 * Loads /api/competitor-ads/ad/:id on open.
 */

import * as React from "react";
import { SideDrawer } from "../SideDrawer";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { useIsMobile } from "@/lib/useIsMobile";
import { briefFromAd, cppUrl, type AdView } from "@/lib/competitor-ads-tab/logic";
import type { AdDetail } from "@/lib/competitor-ads-tab/read";
import { RankLine, adHeadline, mediaLabel, num, rankText, shortDay } from "./parts";

const label: React.CSSProperties = { font: "600 12px var(--font-ui)", color: "var(--ink-3)", margin: "22px 0 8px" };
const body: React.CSSProperties = { font: "400 13.5px/1.55 var(--font-ui)", color: "var(--ink)", margin: 0 };

export function AdDrawer({
  ad,
  saved,
  onClose,
  onSave,
  onUnsave,
}: {
  ad: AdView | null;
  saved: { note: string } | null;
  onClose: () => void;
  onSave: (ad: AdView, note: string) => Promise<void>;
  onUnsave: (ad: AdView) => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [detail, setDetail] = React.useState<AdDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setNote(saved?.note ?? "");
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

  if (!ad) return null;

  const transcript = detail?.archive?.timed?.length ? null : detail?.archive?.transcript || detail?.storyboard?.transcript || null;
  const timed = detail?.archive?.timed ?? null;
  const opening = (detail?.storyboard?.beats ?? [])
    .filter((b) => b.start < 3 && b.onScreen)
    .filter((b, i, all) => i === 0 || all[i - 1].onScreen !== b.onScreen);
  const firstSpoken = timed?.[0]?.text ?? transcript?.split(/(?<=[.!?])\s/)[0] ?? null;
  const storePage = ad.landing.cpp && ad.landing.appId ? cppUrl(ad.landing.appId, ad.landing.cpp) : null;

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(briefFromAd(ad, firstSpoken));
      toast("Brief copied");
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

  return (
    <SideDrawer open onClose={onClose} ariaLabel="Competitor ad" desktopWidth={640}>
      <div style={{ height: "100%", overflowY: "auto", padding: isMobile ? "18px 16px 40px" : "22px 26px 48px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ font: "650 17px/1.35 var(--font-ui)", margin: 0, color: "var(--ink)" }}>{adHeadline(ad)}</h2>
            <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)", marginTop: 6 }}>
              {ad.brand} · runs as {ad.identity}
              {ad.isPartnership ? " (partnership ad)" : ""} · {mediaLabel(ad.mediaType)}
              {ad.videoSeconds ? ` · ${ad.videoSeconds} s` : ""}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={<Icons.Close />} onClick={onClose} title="Close">
            {isMobile ? undefined : "Close"}
          </Button>
        </div>

        <div style={{ marginTop: 16, display: "flex", justifyContent: "center", background: "var(--bg-2)", borderRadius: 12, overflow: "hidden" }}>
          {ad.video ? (
            <video src={ad.video} poster={ad.thumb ?? undefined} controls playsInline preload="metadata" style={{ display: "block", width: "100%", maxHeight: isMobile ? 420 : 520, background: "var(--bg-2)" }} />
          ) : ad.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.thumb} alt="" style={{ display: "block", maxWidth: "100%", maxHeight: 460, objectFit: "contain" }} />
          ) : (
            <div style={{ padding: "40px 16px", font: "400 13px var(--font-ui)", color: "var(--ink-3)", textAlign: "center" }}>
              No creative captured yet. Meta often shows none for an ad's first day; the next scrape usually fills it in.
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          <Button size="sm" variant={saved ? "secondary" : "primary"} icon={saved ? <Icons.BookmarkFilled /> : <Icons.Bookmark />} onClick={toggleSave} disabled={busy}>
            {saved ? "Remove from saved" : "Save ad"}
          </Button>
          <Button size="sm" variant="secondary" icon={<Icons.Copy />} onClick={copyBrief}>
            Copy a brief
          </Button>
          <a href={ad.adLibraryUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <Button size="sm" variant="ghost" icon={<Icons.Link />}>
              Open in Ad Library
            </Button>
          </a>
        </div>
        <textarea
          aria-label="Note for the saved ad"
          placeholder="Note, saved with the ad"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (saved && note !== saved.note) void onSave(ad, note);
          }}
          rows={2}
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

        <div style={label}>Delivery rank</div>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, margin: 0 }}>
          {[
            ["Today", rankText(ad.rank.now)],
            ["7 days ago", rankText(ad.rank.ago7)],
            ["14 days ago", rankText(ad.rank.ago14)],
            ["Best seen", rankText(ad.rankPeak ?? ad.rank.best)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{k}</dt>
              <dd style={{ margin: "2px 0 0", font: "600 18px var(--font-ui)", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{v}</dd>
            </div>
          ))}
        </dl>
        <div style={{ marginTop: 12 }}>
          {detail ? <RankLine points={detail.ranks} /> : <div style={{ height: 120, background: "var(--bg-2)", borderRadius: 8, opacity: 0.6 }} />}
        </div>

        <div style={label}>
          Signals: {ad.confidence.met} of {ad.confidence.of} agree
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {ad.confidence.signals.map((s) => (
            <li key={s.key} style={{ display: "flex", gap: 8, alignItems: "baseline", font: "400 13px var(--font-ui)", color: "var(--ink)" }}>
              <span style={{ color: s.met ? "var(--success-text)" : "var(--ink-3)", fontWeight: 600, minWidth: 30 }}>{s.met ? "Yes" : "No"}</span>
              {s.label}
            </li>
          ))}
        </ul>
        <p style={{ ...body, color: "var(--ink-2)", fontSize: 12.5, marginTop: 8 }}>
          Live {num(ad.runDays)} days since {shortDay(ad.startedAt)}, {ad.copies} live {ad.copies === 1 ? "copy" : "copies"} of this creative
          {ad.euReach != null ? `, EU reach ${num(ad.euReach)}` : ""}.
        </p>

        <div style={label}>Where the click goes</div>
        <p style={body}>
          {ad.landing.kind === "none" && "No link captured for this ad."}
          {ad.landing.kind === "play" && "Google Play."}
          {ad.landing.kind === "web" && "A web page."}
          {ad.landing.kind === "app_store" && !ad.landing.cpp && "The default App Store page."}
          {storePage && (
            <>
              Custom Product Page <code style={{ font: "400 12.5px var(--font-mono)" }}>{ad.landing.cpp!.slice(0, 8)}</code>.{" "}
              <a href={storePage} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>
                Open the page
              </a>
            </>
          )}
        </p>

        {opening.length > 0 && (
          <>
            <div style={label}>On screen in the first 3 seconds</div>
            {opening.map((b, i) => (
              <p key={i} style={{ ...body, marginBottom: 6 }}>
                <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{b.start.toFixed(1)} s </span>
                {b.onScreen}
              </p>
            ))}
          </>
        )}

        {(timed || transcript) && (
          <>
            <div style={label}>
              Transcript
              {detail?.archive?.productMentionS != null ? `, app first mentioned at ${detail.archive.productMentionS.toFixed(1)} s` : ""}
            </div>
            {timed ? (
              <div style={{ display: "grid", gap: 4 }}>
                {timed.map((s, i) => (
                  <p key={i} style={{ ...body, display: "grid", gridTemplateColumns: "44px 1fr", gap: 8 }}>
                    <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{s.start.toFixed(1)} s</span>
                    <span>{s.text}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p style={body}>{transcript}</p>
            )}
          </>
        )}

        {detail?.storyboard?.whyItWorks && (
          <>
            <div style={label}>Storyboard note</div>
            <p style={body}>{detail.storyboard.whyItWorks}</p>
          </>
        )}

        {ad.body && (
          <>
            <div style={label}>Ad copy</div>
            <p style={{ ...body, whiteSpace: "pre-wrap" }}>{ad.body}</p>
          </>
        )}

        {(ad.angle || ad.theme || ad.format) && (
          <>
            <div style={label}>Tags from Outlier</div>
            <p style={{ ...body, color: "var(--ink-2)" }}>{[ad.format, ad.theme, ad.angle].filter(Boolean).join(" · ")}</p>
          </>
        )}

        {detailError && <p style={{ ...body, color: "var(--danger-text)", marginTop: 16 }}>Couldn&apos;t load the transcript and rank history: {detailError}</p>}
        {detail && !timed && !transcript && (
          <p style={{ ...body, color: "var(--ink-3)", marginTop: 18, fontSize: 12.5 }}>
            {detail.archive ? "No transcript: Foreplay has this ad but didn't transcribe it." : "No transcript: this ad isn't in the Foreplay pull and has no storyboard yet."}
          </p>
        )}
      </div>
    </SideDrawer>
  );
}
