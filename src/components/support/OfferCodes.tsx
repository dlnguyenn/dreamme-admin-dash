"use client";

/**
 * Support Inbox — "Offer codes" sub tab: the pools of one-time App Store
 * codes, one per offer (Yearly Special $39.99/yr, Pearl Pack of 550
 * pearls). Codes are handed out from a thread with one click (see
 * OfferCodeCard in ThreadDetail); this tab is the ledger:
 * who got which code, how many are left, and a manual used/free toggle for
 * codes sent outside the dash.
 */
import * as React from "react";
import { Button, useCopy, useToast } from "../ui";
import {
  CategoryTag,
  ErrorBanner,
  FilterPill,
  Segmented,
  SourceTag,
  StatStrip,
} from "../porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  PEARL_PACK,
  PEARL_PACK_PEARLS,
  YEARLY_SPECIAL,
  YEARLY_SPECIAL_PRICE,
  type OfferCodeRow,
  type OfferName,
} from "@/lib/support/offer-codes";
import { fetchOfferCodes, markOfferCode, timeAgo } from "./api";

type CodeFilter = "free" | "used" | "all";

/** Don't render 480 free rows at once; the next free ones are what matter. */
const PAGE = 60;

const OFFER_BLURB: Record<OfferName, { stat: string; how: React.ReactNode }> = {
  [YEARLY_SPECIAL]: {
    stat: `Yearly Special, ${YEARLY_SPECIAL_PRICE}/yr`,
    how: (
      <>
        Hand one out from a thread with <strong>Insert Yearly Special code</strong> (shown
        when an iPhone user asks for a discount).
      </>
    ),
  },
  [PEARL_PACK]: {
    stat: `${PEARL_PACK_PEARLS} pearls, free`,
    how: (
      <>
        Thank someone for their feedback from a thread with <strong>Add Pearl Pack</strong>,
        which adds the code to the reply you are writing.
      </>
    ),
  },
};

export function OfferCodes({ onOpenThread }: { onOpenThread: (id: string) => void }) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [allCodes, setAllCodes] = React.useState<OfferCodeRow[] | null>(null);
  const [offer, setOffer] = React.useState<OfferName>(YEARLY_SPECIAL);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<CodeFilter>("used");
  const [q, setQ] = React.useState("");
  const [shown, setShown] = React.useState(PAGE);
  const [busyCode, setBusyCode] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const r = await fetchOfferCodes();
      setAllCodes(r.codes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const codes = React.useMemo(
    () => (allCodes ?? []).filter((c) => c.offer_name === offer),
    [allCodes, offer],
  );
  const counts = React.useMemo(() => {
    if (!allCodes) return null;
    const used = codes.filter((c) => c.used_at).length;
    return { total: codes.length, used, free: codes.length - used };
  }, [allCodes, codes]);

  const visible = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = codes.filter((c) =>
      filter === "all" ? true : filter === "used" ? !!c.used_at : !c.used_at,
    );
    // Used: newest hand-out first. Free: next to go first.
    if (filter === "used") {
      rows.sort((a, b) => (b.used_at ?? "").localeCompare(a.used_at ?? "") || b.position - a.position);
    }
    if (!needle) return rows;
    return rows.filter((c) =>
      [c.code, c.used_by_email, c.used_by_name, c.note]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [codes, filter, q]);

  const nextFree = codes.find((c) => !c.used_at) ?? null;

  const toggle = async (c: OfferCodeRow) => {
    setBusyCode(c.code);
    try {
      await markOfferCode(c.code, !c.used_at);
      toast(c.used_at ? `${c.code} is free again` : `${c.code} marked used`);
      await load();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div>
        <Segmented
          size="sm"
          options={[YEARLY_SPECIAL, PEARL_PACK].map((o) => ({ value: o, label: o }))}
          value={offer}
          onChange={(v) => {
            setOffer(v as OfferName);
            setShown(PAGE);
          }}
        />
      </div>

      <StatStrip
        minColWidth={isMobile ? 100 : 150}
        stats={[
          {
            label: "Available",
            value: counts ? counts.free : "…",
            note: nextFree ? `next up: #${nextFree.position}` : counts ? "pool is empty" : undefined,
          },
          { label: "Used", value: counts ? counts.used : "…" },
          { label: "Total", value: counts ? counts.total : "…", note: OFFER_BLURB[offer].stat },
        ]}
      />

      <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        One-time App Store codes. {OFFER_BLURB[offer].how} A code counts as used the moment
        it is assigned to a thread.
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: isMobile ? "nowrap" : "wrap",
          overflowX: isMobile ? "auto" : undefined,
          alignItems: "center",
        }}
      >
        {(
          [
            { id: "used", label: "Used", count: counts?.used },
            { id: "free", label: "Available", count: counts?.free },
            { id: "all", label: "All", count: counts?.total },
          ] as const
        ).map((f) => (
          <FilterPill
            key={f.id}
            label={f.label}
            count={f.count}
            selected={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              setShown(PAGE);
            }}
          />
        ))}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code, name or email…"
          aria-label="Search offer codes"
          style={{
            marginLeft: isMobile ? 0 : "auto",
            minWidth: isMobile ? 200 : 240,
            padding: "7px 12px",
            borderRadius: 10,
            border: "1px solid var(--line-2)",
            background: "var(--surface)",
            color: "var(--ink)",
            font: `400 ${isMobile ? 16 : 13}px var(--font-ui)`,
            outline: "none",
          }}
        />
      </div>

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 20 }}>Loading codes…</div>
      ) : visible.length === 0 ? (
        <div
          style={{
            color: "var(--ink-3)",
            fontSize: 13,
            padding: "28px 16px",
            textAlign: "center",
            border: "1px dashed var(--line-2)",
            borderRadius: 16,
          }}
        >
          {q.trim() ? `No codes match "${q.trim()}"` : "No codes here."}
        </div>
      ) : (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            boxShadow: "var(--shadow-card)",
            overflow: "hidden",
          }}
        >
          {visible.slice(0, shown).map((c, i) => (
            <CodeRow
              key={c.code}
              row={c}
              first={i === 0}
              isMobile={isMobile}
              busy={busyCode === c.code}
              onToggle={() => toggle(c)}
              onOpenThread={onOpenThread}
            />
          ))}
        </div>
      )}
      {visible.length > shown && (
        <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
        </Button>
      )}
    </div>
  );
}

function CodeRow({
  row,
  first,
  isMobile,
  busy,
  onToggle,
  onOpenThread,
}: {
  row: OfferCodeRow;
  first: boolean;
  isMobile: boolean;
  busy: boolean;
  onToggle: () => void;
  onOpenThread: (id: string) => void;
}) {
  const { copied, copy } = useCopy();
  const who = row.used_by_name || row.used_by_email;
  return (
    <div
      style={{
        borderTop: first ? "none" : "1px solid var(--line)",
        padding: "10px 16px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "flex-start" : "center",
        gap: isMobile ? 6 : 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: isMobile ? 0 : 290 }}>
        <span
          style={{
            font: "500 11.5px var(--font-ui)",
            color: "var(--ink-4)",
            fontVariantNumeric: "tabular-nums",
            width: 34,
          }}
        >
          #{row.position}
        </span>
        <span
          style={{
            font: "600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            letterSpacing: "0.03em",
            color: row.used_at ? "var(--ink-3)" : "var(--ink)",
          }}
        >
          {row.code}
        </span>
        {row.used_at ? (
          <SourceTag size={9.5}>USED</SourceTag>
        ) : (
          <CategoryTag family="success" size={9.5}>
            AVAILABLE
          </CategoryTag>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          font: "400 12.5px var(--font-ui)",
          color: "var(--ink-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: isMobile ? "normal" : "nowrap",
        }}
      >
        {row.used_at && (
          <>
            {who ? (
              <>
                {row.thread_id ? (
                  <button
                    type="button"
                    onClick={() => onOpenThread(row.thread_id!)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "600 12.5px var(--font-ui)",
                      color: "var(--link)",
                      cursor: "pointer",
                    }}
                    title="Open the support thread"
                  >
                    {who}
                  </button>
                ) : (
                  <strong>{who}</strong>
                )}
                {row.used_by_name && row.used_by_email ? (
                  <span style={{ color: "var(--ink-3)" }}> · {row.used_by_email}</span>
                ) : null}
              </>
            ) : (
              <span style={{ color: "var(--ink-3)" }}>{row.note ?? "Used"}</span>
            )}
            <span style={{ color: "var(--ink-4)" }}> · {timeAgo(row.used_at)}</span>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <Button size="sm" variant="ghost" onClick={() => copy(row.redeem_url)}>
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onToggle} disabled={busy}>
          {row.used_at ? "Mark available" : "Mark used"}
        </Button>
      </div>
    </div>
  );
}
