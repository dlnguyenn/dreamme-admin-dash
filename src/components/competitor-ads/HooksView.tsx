"use client";

/**
 * Hooks view: competitor on-screen hooks grouped by how they open, built for
 * writing the next ad brief. Each hook shows its frame, the first-screen text
 * as it appears, and proof in words (rank today, days live, copies). "Add to
 * brief" collects hooks; "Copy brief" turns them into a plain-text brief.
 * Logic in src/lib/competitor-ads-tab/hooks.ts.
 */

import * as React from "react";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { Segmented } from "../porcelain";
import type { AdView } from "@/lib/competitor-ads-tab/logic";
import type { HookView } from "@/lib/competitor-ads-tab/read";
import { APP_WORDS, evidence, groupHooks, hookBrief, mergeHooks, type HookItem } from "@/lib/competitor-ads-tab/hooks";
import { About, AdFrame, Empty, H2, shortDay } from "./parts";

type Scope = "all" | "live" | "lasting";
const BRIEF_KEY = "dreamme.competitorAds.hookBrief";
const SCOPE_KEY = "dreamme.competitorAds.hookScope";
const FIRST_ROWS = 5;

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function HooksView({
  ads,
  hooks,
  brand,
  source,
  isMobile,
  onOpen,
}: {
  ads: AdView[];
  hooks: HookView[];
  brand: string;
  source: string;
  isMobile: boolean;
  onOpen: (a: AdView, list: AdView[]) => void;
}) {
  const toast = useToast();
  const [scope, setScope] = React.useState<Scope>("all");
  const [picked, setPicked] = React.useState<string[]>([]);
  React.useEffect(() => {
    setPicked(readList(BRIEF_KEY));
    try {
      const s = localStorage.getItem(SCOPE_KEY);
      if (s === "all" || s === "live" || s === "lasting") setScope(s);
    } catch {}
  }, []);
  const savePicked = (next: string[]) => {
    setPicked(next);
    try {
      localStorage.setItem(BRIEF_KEY, JSON.stringify(next));
    } catch {}
  };
  const pickScope = (s: string) => {
    setScope(s as Scope);
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {}
  };

  const all = React.useMemo(() => mergeHooks(ads, hooks), [ads, hooks]);
  const mine = React.useMemo(() => (brand === "all" ? all : all.filter((h) => h.brand === brand)), [all, brand]);
  const counts = { all: mine.length, live: mine.filter((h) => h.liveAds > 0).length, lasting: mine.filter((h) => (h.days ?? 0) >= 21).length };
  const shown = mine.filter((h) => (scope === "live" ? h.liveAds > 0 : scope === "lasting" ? (h.days ?? 0) >= 21 : true));
  const groups = groupHooks(shown);
  const byKey = new Map(all.map((h) => [h.key, h]));
  const pickedItems = picked.map((k) => byKey.get(k)).filter((h): h is HookItem => !!h);

  // The finding that matters for a brief: the top hooks rarely name the app.
  const top = mine.filter((h) => h.liveRank != null && h.liveRank <= 20);
  const named = top.filter((h) => h.app === "named").length;
  const teased = top.filter((h) => h.app === "this").length;
  const archiveDay = /(\d{4}-\d{2}-\d{2})/.exec(hooks[0]?.source_file ?? "")?.[1] ?? null;

  const toggle = (h: HookItem) => savePicked(picked.includes(h.key) ? picked.filter((k) => k !== h.key) : [...picked, h.key]);
  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(hookBrief(pickedItems, new Date().toISOString().slice(0, 10)));
      toast(`Brief with ${pickedItems.length} ${pickedItems.length === 1 ? "hook" : "hooks"} copied`);
    } catch {
      toast("Couldn't copy: the browser blocked the clipboard");
    }
  };

  if (!all.length) {
    return (
      <div style={{ marginTop: 24 }}>
        <Empty title="No hooks yet">
          {source === "missing" ? "Live hooks appear once Outlier reads today's ads. The archive loads with scripts/import-competitor-archive.ts --hooks." : "Neither today's ads nor the archive have on-screen hooks."}
        </Empty>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: pickedItems.length ? (isMobile ? 90 : 76) : 0 }}>
      <H2>Competitor hooks by how they open</H2>
      {top.length > 0 && (
        <p style={{ font: "400 14px/1.5 var(--font-ui)", color: "var(--ink)", margin: "0 0 14px", maxWidth: 720 }}>
          Of today&apos;s top 20 {brand === "all" ? "in each brand" : `at ${brand}`}, {named} of {top.length} hooks name the app and {teased} call it &ldquo;this&rdquo;. The rest open on her GLP-1 moment.
        </p>
      )}
      <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto", marginBottom: 6 }}>
        <Segmented
          size="sm"
          value={scope}
          onChange={pickScope}
          options={[
            { value: "all", label: `All hooks ${counts.all}` },
            { value: "live", label: `Live today ${counts.live}` },
            { value: "lasting", label: `Ran 21+ days ${counts.lasting}` },
          ]}
        />
      </div>

      {groups.length === 0 && (
        <div style={{ marginTop: 18 }}>
          <Empty title="No hooks in this set">Try All hooks, or another brand.</Empty>
        </div>
      )}
      {groups.map((g) => (
        <PatternGroup key={g.pattern.id} title={g.pattern.title} about={g.pattern.about} items={g.items} showBrand={brand === "all"} isMobile={isMobile} picked={picked} onToggle={toggle} onOpen={onOpen} />
      ))}

      <About>
        <p style={{ margin: 0 }}>
          Live hooks are the on-screen text Outlier read from each ad running today; the rank is Meta&apos;s delivery order within the brand. The archive is the first 3 seconds of videos that ran 21+ days{archiveDay ? `, read from Foreplay on ${shortDay(archiveDay)}` : ""}.
        </p>
        <p style={{ margin: 0 }}>
          A hook shows once even when several ads or the archive use it: days is its longest run, copies the most ads using it at once. The patterns are keyword rules on the first screen, so check the frame before briefing from a line. Hooks added to the brief are kept in this browser.
        </p>
      </About>

      {pickedItems.length > 0 && (
        <div
          role="region"
          aria-label="Brief"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            // Above the 52 px mobile tab bar (MobileTabBar.tsx).
            bottom: isMobile ? "calc(52px + env(safe-area-inset-bottom) + 10px)" : 20,
            zIndex: 40,
            width: isMobile ? "calc(100% - 24px)" : "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 8px 8px 16px",
            borderRadius: 14,
            background: "var(--surface)",
            border: "1px solid var(--line-2)",
            boxShadow: "var(--shadow-md)",
            boxSizing: "border-box",
          }}
        >
          <span style={{ font: "500 13px var(--font-ui)", color: "var(--ink)", whiteSpace: "nowrap", marginRight: "auto" }}>
            {pickedItems.length} {pickedItems.length === 1 ? "hook" : "hooks"} in the brief
          </span>
          <Button size="sm" variant="ghost" onClick={() => savePicked([])}>
            Clear
          </Button>
          <Button size="sm" variant="primary" icon={<Icons.Copy />} onClick={() => void copyBrief()}>
            Copy brief
          </Button>
        </div>
      )}
    </div>
  );
}

function PatternGroup({
  title,
  about,
  items,
  showBrand,
  isMobile,
  picked,
  onToggle,
  onOpen,
}: {
  title: string;
  about: string;
  items: HookItem[];
  showBrand: boolean;
  isMobile: boolean;
  picked: string[];
  onToggle: (h: HookItem) => void;
  onOpen: (a: AdView, list: AdView[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rows = open ? items : items.slice(0, FIRST_ROWS);
  const live = items.filter((h) => h.liveAds > 0).length;
  const longest = Math.max(0, ...items.map((h) => h.days ?? 0));
  const openable = items.map((h) => h.ad).filter((a): a is AdView => !!a);
  return (
    <section style={{ marginTop: 30 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "4px 12px", flexWrap: "wrap" }}>
        <h3 style={{ font: "650 16px var(--font-ui)", color: "var(--ink)", margin: 0 }}>{title}</h3>
        <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
          {items.length} {items.length === 1 ? "hook" : "hooks"}
          {live ? `, ${live} live today` : ""}
          {longest ? `, longest ${longest} days` : ""}
        </span>
      </div>
      <p style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)", margin: "4px 0 8px", maxWidth: 680 }}>{about}</p>
      <div>
        {rows.map((h) => (
          <HookRowView key={h.key} h={h} showBrand={showBrand} isMobile={isMobile} picked={picked.includes(h.key)} onToggle={() => onToggle(h)} onOpen={h.ad ? () => onOpen(h.ad!, openable) : null} />
        ))}
      </div>
      {items.length > FIRST_ROWS && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="cad-focus"
          style={{ all: "unset", cursor: "pointer", font: "500 13px var(--font-ui)", color: "var(--link)", padding: "10px 0", minHeight: 24, borderRadius: 6 }}
        >
          {open ? "Show fewer" : `Show ${items.length - FIRST_ROWS} more`}
        </button>
      )}
    </section>
  );
}

function HookRowView({ h, showBrand, isMobile, picked, onToggle, onOpen }: { h: HookItem; showBrand: boolean; isMobile: boolean; picked: boolean; onToggle: () => void; onOpen: (() => void) | null }) {
  const [more, setMore] = React.useState(false);
  const frameW = isMobile ? 56 : 64;
  const box: React.CSSProperties = { display: "block", width: frameW, aspectRatio: "9 / 16", borderRadius: 8, background: "var(--bg-2)", objectFit: "contain" };
  const frame = <AdFrame src={h.frame} adArchiveId={h.ad?.adArchiveId ?? null} style={box} fallback={<span aria-hidden style={box} />} />;
  const proof = [showBrand ? h.brand : null, evidence(h), h.identity ? `as ${h.identity}` : null].filter(Boolean).join(" · ");
  const appWords = h.app ? APP_WORDS[h.app] : null;
  const action = (
    <button
      onClick={onToggle}
      aria-pressed={picked}
      className="cad-focus"
      style={{
        font: `${picked ? 600 : 500} 13px var(--font-ui)`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: isMobile ? 40 : 32,
        padding: "0 12px",
        borderRadius: 9,
        cursor: "pointer",
        border: `1px solid ${picked ? "var(--accent)" : "var(--line-2)"}`,
        background: picked ? "var(--accent-soft)" : "var(--surface)",
        color: picked ? "var(--accent-text)" : "var(--ink)",
        whiteSpace: "nowrap",
      }}
    >
      {picked ? <Icons.Check size={14} /> : <Icons.Plus size={14} />}
      {picked ? "In the brief" : "Add to brief"}
    </button>
  );
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? `${frameW}px minmax(0, 1fr)` : `${frameW}px minmax(0, 1fr) auto`,
        gap: isMobile ? "10px 12px" : "0 18px",
        alignItems: "start",
        padding: "14px 0",
        borderTop: "1px solid var(--line)",
      }}
    >
      {onOpen ? (
        // Mouse shortcut only: "Open the ad" below is the keyboard and screen-reader stop.
        <button onClick={onOpen} tabIndex={-1} aria-hidden className="cad-focus" style={{ all: "unset", cursor: "pointer", borderRadius: 8 }}>
          {frame}
        </button>
      ) : (
        frame
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "500 15px/1.4 var(--font-ui)", color: "var(--ink)", overflowWrap: "anywhere" }}>
          {h.lines.map((l, i) => (
            <span key={i} style={{ display: "block" }}>
              {l}
            </span>
          ))}
        </div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
          {proof}
          {appWords && (
            <>
              {" · "}
              <span style={{ color: h.app === "named" ? "var(--ink)" : "var(--accent-text)" }}>{appWords}</span>
            </>
          )}
        </div>
        {h.shot && <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)", marginTop: 2 }}>Opens on {h.shot}</div>}
        {h.later && (
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)", marginTop: 2 }}>
            <span style={more ? undefined : { display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>Then: {h.later}</span>
            {h.later.length > 70 && (
              <button onClick={() => setMore((v) => !v)} className="cad-focus" style={{ all: "unset", cursor: "pointer", color: "var(--link)", borderRadius: 4 }}>
                {more ? "Less" : "More"}
              </button>
            )}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginTop: 8 }}>
          {isMobile && action}
          {onOpen && (
            <button onClick={onOpen} className="cad-focus" style={{ all: "unset", cursor: "pointer", font: "500 13px var(--font-ui)", color: "var(--link)", borderRadius: 6, minHeight: isMobile ? 40 : 0, display: "inline-flex", alignItems: "center" }}>
              Open the ad
            </button>
          )}
          {!onOpen && h.adLibraryUrl && (
            <a href={h.adLibraryUrl} target="_blank" rel="noreferrer" className="cad-focus" style={{ font: "500 13px var(--font-ui)", color: "var(--link)", borderRadius: 6, minHeight: isMobile ? 40 : 0, display: "inline-flex", alignItems: "center" }}>
              Ad Library
            </a>
          )}
        </div>
      </div>
      {!isMobile && action}
    </div>
  );
}
