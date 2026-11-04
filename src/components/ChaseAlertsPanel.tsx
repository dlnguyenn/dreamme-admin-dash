"use client";

/**
 * Spend tab: Chase business accounts, from Chase's transaction alert emails
 * (src/lib/finance/chase-alerts-store.ts, /api/finance/chase-alerts).
 * Freshness first, because a quiet ingest and a broken one otherwise look
 * the same; then spend by category per month and the newest rows.
 */
import * as React from "react";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { Card, CategoryTag, ErrorBanner, InfoWell, SectionHeader, StatusPill, thStyle } from "./porcelain";
import type { ChaseSummary } from "@/lib/finance/chase-alerts-store";

/** A successful sync older than this means the daily cron stopped. */
const STALE_RUN_HOURS = 36;

function fmtUSD(n: number, cents = false): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents || Math.abs(n) < 100 ? 2 : 0,
  });
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type Health = { kind: "success" | "danger" | "neutral" | "attention"; label: string; text: string };

function healthOf(s: ChaseSummary): Health {
  const run = s.lastRun;
  if (!run) return { kind: "neutral", label: "NOT RUN YET", text: "The daily sync hasn't run yet. It runs at 12:00 UTC, or press Sync Chase." };
  if (!run.ok) {
    return {
      kind: "danger",
      label: "SYNC FAILING",
      text: `Last sync ${ago(run.ran_at)} failed: ${run.error ?? "unknown error"}. Last good sync ${ago(s.lastOkRun?.ran_at)}.`,
    };
  }
  const hours = (Date.now() - new Date(run.ran_at).getTime()) / 3_600_000;
  if (hours > STALE_RUN_HOURS) {
    return { kind: "attention", label: "STALE", text: `No sync for ${ago(run.ran_at).replace(" ago", "")}. The daily cron may have stopped.` };
  }
  if (s.emails.total === 0) {
    return {
      kind: "neutral",
      label: "WAITING FOR ALERTS",
      text: `Synced ${ago(run.ran_at)}, but no Chase email has reached dan@dreamme.life yet. Chase sends alerts to dlnguyenn@gmail.com, so that inbox needs a filter forwarding chase.com mail to dan@ (finance/SETUP-ALERTS.md).`,
    };
  }
  return {
    kind: "success",
    label: "LIVE",
    text: `Synced ${ago(run.ran_at)} · ${s.emails.total} alert emails (${s.emails.txn} transactions) · newest ${ago(s.emails.newestReceivedAt)}`,
  };
}

export function ChaseAlertsPanel() {
  const toast = useToast();
  const [summary, setSummary] = React.useState<ChaseSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/finance/chase-alerts", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSummary(body.summary);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/finance/chase-alerts", { method: "POST" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast(body.inserted ? `Chase: ${body.inserted} new alert email${body.inserted === 1 ? "" : "s"}` : "Chase: nothing new");
    } catch (e) {
      toast(`Chase sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
      load();
    }
  };

  const thisMonth = summary?.today.slice(0, 7);
  const mtd = summary?.months.find((m) => m.month === thisMonth)?.total ?? 0;

  return (
    <>
      <SectionHeader
        family="neutral"
        icon="CardOutline"
        title="Chase accounts"
        meta={summary ? `${fmtUSD(mtd)} MTD · from alert emails` : "from alert emails"}
        right={
          <Button size="sm" variant="secondary" icon={syncing ? undefined : <Icons.Refresh />} onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync Chase"}
          </Button>
        }
      />
      {error && <ErrorBanner>Chase alerts: {error}</ErrorBanner>}
      {!summary && !error && <InfoWell>Loading Chase alerts…</InfoWell>}
      {summary && <PanelBody s={summary} showAll={showAll} setShowAll={setShowAll} />}
    </>
  );
}

function PanelBody({ s, showAll, setShowAll }: { s: ChaseSummary; showAll: boolean; setShowAll: (v: boolean) => void }) {
  const health = healthOf(s);
  const problems: React.ReactNode[] = [];
  for (const l4 of s.unknownAccounts) {
    problems.push(
      <>Alerts for an unknown account <b>…{l4}</b> were skipped. If it's a business account, add it to BUSINESS_ACCOUNTS in src/lib/finance/chase-alerts.ts.</>,
    );
  }
  for (const u of s.unparsed) {
    problems.push(
      <>
        Couldn't read <b>{u.subject ?? "(no subject)"}</b> ({u.received_at ? shortDate(u.received_at.slice(0, 10)) : "?"}): {u.reason}. That
        transaction is <b>not counted</b>.
      </>,
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card pad="14px 18px">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <StatusPill kind={health.kind}>{health.label}</StatusPill>
          <span style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)", flex: "1 1 260px", minWidth: 0 }}>{health.text}</span>
        </div>
        {s.emails.total > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {s.accounts.map((a) => (
              <span
                key={a.last4}
                title={a.label}
                style={{
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                  font: "500 12px var(--font-ui)",
                  color: a.stale ? "var(--warning-text)" : "var(--ink-3)",
                  background: a.stale ? "var(--warning-soft)" : "var(--surface-2)",
                  padding: "4px 10px",
                  borderRadius: 999,
                }}
              >
                {a.label.replace(/^Chase /, "")}: {a.lastAlertDate ? `last alert ${shortDate(a.lastAlertDate)}` : "no alerts yet"}
              </span>
            ))}
          </div>
        )}
      </Card>

      {problems.length > 0 && (
        <Card pad="12px 18px" style={{ borderColor: "var(--warning)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {problems.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 8, font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)" }}>
                <Icons.TriAlert size={14} stroke="var(--warning-text)" style={{ flex: "none", marginTop: 2 }} />
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {s.months.length > 0 ? <MonthTable s={s} /> : null}
      {s.recent.length > 0 && <RecentTable rows={showAll ? s.recent : s.recent.slice(0, 12)} more={s.recent.length > 12 && !showAll} onMore={() => setShowAll(true)} />}

      <InfoWell>
        Spend = money out of checking 5289, Ink 3314 and card 0352 (employee card 0360 included), minus card payments and
        internal transfers. Alerts show the amount when a charge is approved, so tips and holds can differ from the statement,
        and Chase sends no alert for fees or statement credits.
        {s.personalSkipped.length > 0 && ` Personal accounts skipped: ${s.personalSkipped.join(", ")}.`}
      </InfoWell>
    </div>
  );
}

function MonthTable({ s }: { s: ChaseSummary }) {
  const months = s.months.map((m) => m.month);
  const cats = new Map<string, Record<string, number>>();
  for (const m of s.months) {
    for (const c of m.categories) cats.set(c.category, { ...(cats.get(c.category) ?? {}), [m.month]: c.total });
  }
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const rows = [...cats.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
  const td = (align: "left" | "right" = "right"): React.CSSProperties => ({
    textAlign: align,
    padding: "9px 16px",
    font: "400 13px var(--font-ui)",
    fontVariantNumeric: "tabular-nums",
    borderBottom: "1px solid var(--line)",
    whiteSpace: "nowrap",
  });
  return (
    <Card pad={0} style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle("left")}>Category</th>
            {months.map((m) => (
              <th key={m} style={thStyle()}>
                {monthLabel(m)}
                {m === s.today.slice(0, 7) ? " (MTD)" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([cat, byMonth]) => (
            <tr key={cat}>
              <td style={{ ...td("left"), color: "var(--ink-2)" }}>
                {cat}
                {cat.includes("VERIFY") && (
                  <span style={{ marginLeft: 8 }}>
                    <CategoryTag family="warning" size={9}>
                      CHECK
                    </CategoryTag>
                  </span>
                )}
              </td>
              {months.map((m) => (
                <td key={m} style={{ ...td(), color: byMonth[m] ? "var(--ink)" : "var(--ink-4)" }}>
                  {byMonth[m] ? fmtUSD(byMonth[m]) : "–"}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td style={{ ...td("left"), font: "650 13px var(--font-ui)", borderBottom: "none" }}>Total</td>
            {s.months.map((m) => (
              <td key={m.month} style={{ ...td(), font: "650 13px var(--font-ui)", borderBottom: "none" }}>
                {fmtUSD(m.total)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function RecentTable({ rows, more, onMore }: { rows: ChaseSummary["recent"]; more: boolean; onMore: () => void }) {
  const td = (align: "left" | "right" = "left"): React.CSSProperties => ({
    textAlign: align,
    padding: "8px 16px",
    font: "400 12.5px var(--font-ui)",
    fontVariantNumeric: "tabular-nums",
    borderBottom: "1px solid var(--line)",
    whiteSpace: "nowrap",
  });
  return (
    <Card pad={0} style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle("left")}>Date</th>
            <th style={thStyle("left")}>Description</th>
            <th style={thStyle("left")}>Category</th>
            <th style={thStyle("left")}>Account</th>
            <th style={thStyle()}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.messageId}>
              <td style={{ ...td(), color: "var(--ink-3)" }}>{shortDate(r.date)}</td>
              <td style={{ ...td(), color: "var(--ink)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }} title={r.description}>
                {r.description}
              </td>
              <td style={{ ...td(), color: "var(--ink-3)" }}>{r.category === "~transfer" ? "Transfer (excluded)" : r.amount > 0 ? "Money in" : r.category}</td>
              <td style={{ ...td(), color: "var(--ink-3)" }}>…{r.last4}</td>
              <td style={{ ...td("right"), color: r.amount > 0 ? "var(--success-text)" : "var(--ink)" }}>
                {r.amount > 0 ? "+" : ""}
                {fmtUSD(r.amount, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more && (
        <div style={{ padding: "10px 16px" }}>
          <Button size="sm" variant="ghost" onClick={onMore}>
            Show all
          </Button>
        </div>
      )}
    </Card>
  );
}
