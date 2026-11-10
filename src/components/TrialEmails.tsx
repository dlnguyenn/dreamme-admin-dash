"use client";

/**
 * Trial emails tab (?tab=trial-emails): the day-0 / day-1 trialist email test
 * with a 50% holdout. Shows whether it is running, how many trialists are in
 * each arm, what was sent or skipped, clicks and unsubscribes, and the read
 * that matters (paid within 14 days, email arm against holdout) with the
 * sample size beside it. Bottom: every email variant rendered at phone width.
 * Data: GET /api/trial-emails/summary. The on/off switch is deliberately not
 * here (see migration 0108).
 */

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button } from "./ui";
import { Icons } from "./Icons";
import { Card, ErrorBanner, HeroCard, InfoWell, Segmented, StatStrip, StatusPill } from "./porcelain";
import { int, pct, shortDate, tableCard, tdStyle } from "./plan/format";

interface ArmNums {
  assigned: number;
  emailOnFile: number;
  matured48h: number;
  cancelled48h: number;
  matured7d: number;
  cancelled7d: number;
  matured14d: number;
  paid14d: number;
  refunded14d: number;
}
interface Read {
  email: number;
  holdout: number;
  diff: number;
  low: number;
  high: number;
}
type Scope = "all" | "ios" | "android";
interface Summary {
  ok: boolean;
  error?: string;
  experiment: string;
  config: { enabled: boolean; started_at: string | null; stopped_at: string | null } | null;
  now: string;
  arms: Record<Scope, { email: ArmNums; holdout: ArmNums }>;
  reads: Record<Scope, { paid14d: Read | null; cancel48h: Read | null }>;
  sends: { kind: "day0" | "day1"; sent: number; clicked: number; skips: Record<string, number>; variants: Record<string, number> }[];
  unsubscribed: number;
  pace: { days: number; perArmPerDay: number | null; need5: number; need3: number; read5: string | null; read3: string | null; base: number };
}

const SKIP_LABEL: Record<string, string> = {
  converted: "Already paid",
  expired: "Trial already over",
  refunded: "Refunded",
  no_email: "No email on file",
  unsubscribed: "Unsubscribed earlier",
  not_english: "App not in English",
  activated: "Already did all three actions",
  window_missed: "Send window missed",
  error: "Send error",
};

const th = (align: "left" | "right" = "right"): React.CSSProperties => ({
  textAlign: align,
  padding: "10px 16px",
  font: "600 12.5px var(--font-ui)",
  color: "var(--ink-3)",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
});

const h2: React.CSSProperties = { font: "650 16px var(--font-ui)", color: "var(--ink)", margin: "32px 0 12px" };

const signedPts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts`;

export function TrialEmails() {
  const [data, setData] = React.useState<Summary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [scope, setScope] = React.useState<Scope>("all");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trial-emails/summary", { cache: "no-store" });
      const body = (await res.json()) as Summary;
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div>
      <PageHeader
        title="Trial emails"
        subtitle="A day-0 and a day-1 email to new trialists, with half held back so we can see what they do to trial-to-paid"
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!data && !error && <InfoWell>Loading…</InfoWell>}
      {data && <Body d={data} scope={scope} setScope={setScope} />}
      <Previews />
    </div>
  );
}

function Status({ d }: { d: Summary }) {
  const c = d.config;
  const running = !!c?.enabled && !!c.started_at;
  const stopped = !running && !!c?.started_at;
  const pill = running ? (
    <StatusPill kind="running">Running</StatusPill>
  ) : stopped ? (
    <StatusPill kind="neutral">Stopped</StatusPill>
  ) : (
    <StatusPill kind="neutral">Off</StatusPill>
  );
  let line: React.ReactNode;
  if (running) {
    const day = Math.floor(d.pace.days) + 1;
    line = (
      <>
        Started {shortDate(c!.started_at!.slice(0, 10))}, day {day}.{" "}
        {d.pace.read5 ? `A 5-point lift can first be read around ${shortDate(d.pace.read5)}` : "The first read date shows after 2 days"}
        {d.pace.read3 ? `, a 3-point lift around ${shortDate(d.pace.read3)}.` : "."}
      </>
    );
  } else if (stopped) {
    line = `Ran ${shortDate(c!.started_at!.slice(0, 10))} to ${c?.stopped_at ? shortDate(c.stopped_at.slice(0, 10)) : "?"}. Nothing is being sent.`;
  } else {
    line = "The switch is off, so nothing is assigned or sent. It goes on only after Dan's yes.";
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      {pill}
      <span style={{ font: "400 13.5px var(--font-ui)", color: "var(--ink-2)" }}>{line}</span>
    </div>
  );
}

function Body({ d, scope, setScope }: { d: Summary; scope: Scope; setScope: (s: Scope) => void }) {
  const a = d.arms[scope];
  const r = d.reads[scope];
  const day0 = d.sends.find((s) => s.kind === "day0")!;
  const day1 = d.sends.find((s) => s.kind === "day1")!;
  const rate = (x: number, n: number) => (n ? pct(x / n) : "…");

  const hero = r.paid14d ? (
    <HeroCard
      label="Paid within 14 days, email against holdout"
      value={`${pct(r.paid14d.email)} vs ${pct(r.paid14d.holdout)}`}
      delta={signedPts(r.paid14d.diff)}
      deltaUp={r.paid14d.diff >= 0}
      note={`${
        r.paid14d.low > 0 ? "The emails are helping." : r.paid14d.high < 0 ? "The emails are hurting." : "No clear difference yet."
      } 95% range ${signedPts(r.paid14d.low)} to ${signedPts(r.paid14d.high)}, from ${int(a.email.matured14d)} and ${int(
        a.holdout.matured14d,
      )} trials old enough to count.`}
    />
  ) : (
    <HeroCard
      label="Paid within 14 days, email against holdout"
      value="Not yet"
      note={`Needs 30 trials per arm that are 14+ days old (now ${int(a.email.matured14d)} and ${int(a.holdout.matured14d)}). A fair read for a 5-point lift needs about ${int(d.pace.need5)} per arm.`}
    />
  );

  return (
    <>
      <Status d={d} />
      <div style={{ marginBottom: 16 }}>
        <Segmented
          size="sm"
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={[
            { value: "all", label: "All" },
            { value: "ios", label: "iOS" },
            { value: "android", label: "Android" },
          ]}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {hero}
        <StatStrip
          minColWidth={130}
          stats={[
            {
              label: "In the test",
              value: int(a.email.assigned + a.holdout.assigned),
              note: `${int(a.email.assigned)} vs ${int(a.holdout.assigned)} held out`,
            },
            { label: "Day-0 emails sent", value: int(day0.sent), note: `${int(day0.clicked)} clicked` },
            { label: "Day-1 emails sent", value: int(day1.sent), note: `${int(day1.clicked)} clicked` },
            { label: "Unsubscribed", value: int(d.unsubscribed), note: day0.sent ? `${pct(d.unsubscribed / day0.sent)} of emailed` : "opens aren't tracked" },
          ]}
        />
      </div>

      <h2 style={h2}>Each arm</h2>
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th("left")}>Arm</th>
              <th style={th()}>Trialists</th>
              <th style={th()}>Email on file</th>
              <th style={th()}>Cancelled in 48h</th>
              <th style={th()}>Cancelled in 7 days</th>
              <th style={th()}>Paid in 14 days</th>
              <th style={th()}>Refunded</th>
            </tr>
          </thead>
          <tbody>
            {(["email", "holdout"] as const).map((arm) => {
              const x = a[arm];
              return (
                <tr key={arm}>
                  <td style={tdStyle("left")}>
                    <strong>{arm === "email" ? "Emailed" : "Held out"}</strong>
                  </td>
                  <td style={tdStyle()}>{int(x.assigned)}</td>
                  <td style={tdStyle()}>{rate(x.emailOnFile, x.assigned)}</td>
                  <td style={tdStyle()}>
                    {rate(x.cancelled48h, x.matured48h)} <span style={{ color: "var(--ink-3)" }}>of {int(x.matured48h)}</span>
                  </td>
                  <td style={tdStyle()}>
                    {rate(x.cancelled7d, x.matured7d)} <span style={{ color: "var(--ink-3)" }}>of {int(x.matured7d)}</span>
                  </td>
                  <td style={tdStyle()}>
                    {rate(x.paid14d, x.matured14d)} <span style={{ color: "var(--ink-3)" }}>of {int(x.matured14d)}</span>
                  </td>
                  <td style={tdStyle()}>{x.paid14d ? rate(x.refunded14d, x.paid14d) : "…"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-3)", margin: "8px 2px 0" }}>
        Each rate counts only trials old enough for its window. Everyone assigned is counted in their arm, emailed or not.
        {r.cancel48h ? ` Cancelled in 48h: ${signedPts(r.cancel48h.diff)} for the emailed arm (95% ${signedPts(r.cancel48h.low)} to ${signedPts(r.cancel48h.high)}).` : ""}
      </p>

      <h2 style={h2}>Not sent, and why</h2>
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th("left")}>Reason</th>
              <th style={th()}>Day 0</th>
              <th style={th()}>Day 1</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(SKIP_LABEL)
              .filter((k) => day0.skips[k] || day1.skips[k])
              .map((k) => (
                <tr key={k}>
                  <td style={tdStyle("left")}>{SKIP_LABEL[k]}</td>
                  <td style={tdStyle()}>{int(day0.skips[k] ?? 0)}</td>
                  <td style={tdStyle()}>{int(day1.skips[k] ?? 0)}</td>
                </tr>
              ))}
            {!Object.values(day0.skips).some(Boolean) && !Object.values(day1.skips).some(Boolean) && (
              <tr>
                <td style={tdStyle("left")} colSpan={3}>
                  Nothing skipped yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Previews() {
  const [list, setList] = React.useState<{ index: number; label: string }[]>([]);
  const [v, setV] = React.useState(0);
  const [meta, setMeta] = React.useState<{ subject: string; preview: string } | null>(null);
  React.useEffect(() => {
    fetch("/api/trial-emails/preview?list=1")
      .then((r) => r.json())
      .then((b) => setList(b.variants ?? []))
      .catch(() => {});
  }, []);
  React.useEffect(() => {
    fetch(`/api/trial-emails/preview?v=${v}&format=meta`)
      .then((r) => r.json())
      .then((b) => setMeta(b.ok ? b : null))
      .catch(() => setMeta(null));
  }, [v]);
  if (!list.length) return null;
  return (
    <>
      <h2 style={h2}>The emails</h2>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <label style={{ display: "block", font: "500 13px var(--font-ui)", color: "var(--ink-2)", marginBottom: 6 }} htmlFor="te-variant">
            Version
          </label>
          <select
            id="te-variant"
            value={v}
            onChange={(e) => setV(Number(e.target.value))}
            style={{
              width: "100%",
              maxWidth: 360,
              font: "400 14px var(--font-ui)",
              padding: "9px 10px",
              borderRadius: 10,
              border: "1px solid var(--line-2)",
              background: "var(--surface)",
              color: "var(--ink)",
            }}
          >
            {list.map((x) => (
              <option key={x.index} value={x.index}>
                {x.label}
              </option>
            ))}
          </select>
          {meta && (
            <div style={{ marginTop: 16, font: "400 14px/1.5 var(--font-ui)", color: "var(--ink)" }}>
              <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>Subject</div>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>{meta.subject}</div>
              <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>Preview text</div>
              <div>{meta.preview}</div>
            </div>
          )}
          <p style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-3)", marginTop: 16, maxWidth: 360 }}>
            Sample data (Jamie, iOS). Real emails use the trialist&apos;s first name, their fish&apos;s name and their own trial end date.
          </p>
        </div>
        <Card pad={0} style={{ width: 375, maxWidth: "100%", overflow: "hidden", flex: "none" }}>
          <iframe
            title="Email preview at phone width"
            src={`/api/trial-emails/preview?v=${v}`}
            style={{ width: "100%", height: 760, border: 0, display: "block" }}
          />
        </Card>
      </div>
    </>
  );
}
