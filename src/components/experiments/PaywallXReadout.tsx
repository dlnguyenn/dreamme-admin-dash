"use client";

/**
 * Paywall X test readout (Experiments › Paywall X test,
 * `?tab=experiments&readout=paywall_close_x`). Everyone exposed, per arm,
 * split by who assigned the arm (RevenueCat or the app's own split) and by
 * platform: trial starts, auto-renew off, conversion, refunds and revenue per
 * exposed user, with a split check and a 95% range for each difference.
 *
 * Data: GET /api/experiment-readouts/paywall-close-x. Rules:
 * src/lib/paywall-x/readout.ts. Counts and rates only; no p-value theatre.
 */
import * as React from "react";
import { PageHeader } from "../Shell";
import { Button } from "../ui";
import { Icons } from "../Icons";
import { Card, ErrorBanner, InfoWell, Segmented, StatStrip, StatusPill, thStyle } from "../porcelain";
import { int, pct, tableCard, tdStyle, usd } from "../plan/format";
import { useIsMobile } from "@/lib/useIsMobile";
import type { PaywallXResponse } from "@/lib/paywall-x/data";
import type { ArmStats, DiffRead, Money, PaywallXReadout as Readout, Rate, SegmentRead, UserStatus } from "@/lib/paywall-x/readout";
import {
  PAYWALL_X_KEY,
  PLATFORM_LABELS,
  SOURCE_LABELS,
  type PaywallXArm,
  type PaywallXPlatform,
  type PaywallXSource,
} from "@/lib/paywall-x/shared";

type Payload = PaywallXResponse & { ok: true; demo?: string };

export function PaywallXReadout({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile();
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [source, setSource] = React.useState<"all" | PaywallXSource>("all");
  const [platform, setPlatform] = React.useState<"all" | PaywallXPlatform>("all");

  const load = React.useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (fresh) qs.set("fresh", "1");
      const demo = new URLSearchParams(window.location.search).get("demo");
      if (demo) qs.set("demo", demo);
      const res = await fetch(`/api/experiment-readouts/paywall-close-x${qs.size ? `?${qs}` : ""}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json as Payload);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const readout = data && data.configured ? data.readout : null;
  const seg = readout?.segments.find((s) => s.key === `${source}/${platform}`) ?? null;
  const hasOther = !!readout?.segments.some((s) => s.platform === "other");

  return (
    <div>
      <button onClick={onBack} style={backLink}>
        <Icons.ChevronLeft size={14} /> All experiments
      </button>
      <PageHeader
        eyebrow="Experiments · readout"
        title="Paywall X test"
        subtitle={
          <>
            Onboarding paywall. Control keeps the &ldquo;… or meet Sushi first!&rdquo; link; close_x replaces it with an X in the top
            corner. Key <code>{PAYWALL_X_KEY}</code>.
          </>
        }
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={() => load(true)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />

      {data?.demo && (
        <InfoWell style={{ marginBottom: 14 }}>
          Showing made-up {data.demo === "fixture" ? "fixture data" : `"${data.demo}" state`} (dev only, <code>?demo={data.demo}</code>).
        </InfoWell>
      )}
      {error && <ErrorBanner>Couldn&apos;t load the readout: {error}</ErrorBanner>}
      {data && !data.configured && <SetupMissing missing={data.setup.missing} />}
      {data?.configured && data.tableMissing && (
        <ErrorBanner>The consumer database has no experiment_assignments table, so nothing can be read.</ErrorBanner>
      )}
      {!data && !error && <Card>Loading…</Card>}

      {readout && <StatusLine r={readout} />}

      {readout && readout.state !== "no_data" && seg && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "18px 0 14px" }}>
            <Segmented
              size="sm"
              value={source}
              onChange={(v) => setSource(v as typeof source)}
              options={[
                { value: "all", label: "Both sources" },
                { value: "revenuecat", label: "RevenueCat" },
                { value: "split", label: "App split" },
              ]}
            />
            <Segmented
              size="sm"
              value={platform}
              onChange={(v) => setPlatform(v as typeof platform)}
              options={[
                { value: "all", label: "All platforms" },
                { value: "ios", label: "iOS" },
                { value: "android", label: "Android" },
                ...(hasOther ? [{ value: "other", label: "Other" }] : []),
              ]}
            />
          </div>

          <Headline seg={seg} isMobile={isMobile} />
          <ArmTable seg={seg} />
          <Breakdown r={readout} />
          <Checks r={readout} />
          <Recent r={readout} />
        </>
      )}

      <Definitions />
    </div>
  );
}

// ---- pieces -------------------------------------------------------------------

function SetupMissing({ missing }: { missing: string[] }) {
  return (
    <Card style={{ marginBottom: 16, borderColor: "var(--warning-soft)" }}>
      <div style={{ font: "650 14px var(--font-ui)", marginBottom: 6 }}>The readout can&apos;t reach its data here</div>
      <div style={{ font: "400 13px/1.55 var(--font-ui)", color: "var(--ink-2)" }}>
        Exposures live in the consumer database (<code>experiment_assignments</code>) and outcomes in DreamMe Internal (
        <code>rc_events</code>). This deployment is missing:{" "}
        {missing.map((m, i) => (
          <React.Fragment key={m}>
            {i > 0 && ", "}
            <code>{m}</code>
          </React.Fragment>
        ))}
        . Add them in Vercel (Production) and redeploy.
      </div>
    </Card>
  );
}

function StatusLine({ r }: { r: Readout }) {
  const pill =
    r.state === "no_data"
      ? { kind: "neutral" as const, label: "NOT STARTED" }
      : r.state === "collecting"
        ? { kind: "neutral" as const, label: "TOO EARLY" }
        : { kind: "running" as const, label: "READING" };
  const uneven = r.segments.find((s) => s.key === "all/all")?.srm.state === "uneven";
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusPill kind={uneven ? "danger" : pill.kind}>{uneven ? "UNEVEN SPLIT" : pill.label}</StatusPill>
        <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {r.firstExposure
            ? `${int(r.exposed)} exposed since ${fmtDay(r.firstExposure)} · newest ${fmtTime(r.lastExposure!)}`
            : "No exposures yet"}
          {` · computed ${fmtTime(r.generatedAt)}`}
        </span>
      </div>
      <div style={{ font: "450 14px/1.55 var(--font-ui)", color: "var(--ink)" }}>{r.message}</div>
      {r.need2pt != null && (
        <div style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>
          Spotting a 2-point difference in the 7-day trial rate takes about {int(r.need2pt)} users per arm.
        </div>
      )}
    </Card>
  );
}

function Headline({ seg, isMobile }: { seg: SegmentRead; isMobile: boolean }) {
  const c = seg.arms.control;
  const x = seg.arms.close_x;
  const vs = (m: (a: ArmStats) => Rate) => `${pct(m(c).rate)} vs ${pct(m(x).rate)}`;
  return (
    <StatStrip
      minColWidth={isMobile ? 150 : 190}
      stats={[
        { label: "Exposed", value: `${int(c.exposed)} / ${int(x.exposed)}`, note: "control / close_x" },
        {
          label: "Split",
          value: seg.srm.share == null ? "—" : `${(seg.srm.share * 100).toFixed(1)}% X`,
          note: seg.srm.state === "too_few" ? "too few to check" : seg.srm.state === "uneven" ? "uneven, check assignment" : "even",
        },
        { label: "Trial within 24 h", value: vs((a) => a.trial24h), note: diffNote(seg.diffs.trial24h) },
        { label: "Trial within 7 days", value: vs((a) => a.trial7d), note: diffNote(seg.diffs.trial7d) },
      ]}
    />
  );
}

function diffNote(d: DiffRead): string {
  if (!d.ci) return "too few to read";
  const range = `${signedPts(d.ci.low)} to ${signedPts(d.ci.high)}`;
  return d.verdict === "unclear" ? `no clear difference (${range})` : `close_x ${d.verdict} (${range})`;
}

const signedPts = (x: number) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)}`;

function RateCell({ r }: { r: Rate }) {
  return (
    <td style={tdStyle()}>
      <div>{r.n ? pct(r.rate) : "too early"}</div>
      <div style={sub}>
        {int(r.x)} of {int(r.n)}
        {r.tooRecent > 0 && ` · ${int(r.tooRecent)} too recent`}
      </div>
    </td>
  );
}

function MoneyCell({ m, days }: { m: Money; days: number }) {
  return (
    <td style={tdStyle()}>
      <div>{m.n ? usd(m.perUser) : "too early"}</div>
      <div style={sub}>
        {m.n ? `${int(m.n)} users ${days}+ days in${m.n < 30 ? ", small sample" : ""}` : `nobody ${days} days past exposure yet`}
        {m.n > 0 && m.tooRecent > 0 && ` · ${int(m.tooRecent)} too recent`}
      </div>
    </td>
  );
}

function DiffCell({ d }: { d?: DiffRead }) {
  if (!d) return <td style={tdStyle()} />;
  if (!d.ci) return <td style={{ ...tdStyle(), color: "var(--ink-4)" }}>too few to read</td>;
  const color = d.verdict === "higher" ? "var(--success-text)" : d.verdict === "lower" ? "var(--danger-text)" : "var(--ink-2)";
  return (
    <td style={tdStyle()} title={d.text}>
      <div style={{ color }}>{signedPts(d.ci.diff)} pts</div>
      <div style={sub}>
        {signedPts(d.ci.low)} to {signedPts(d.ci.high)}
      </div>
    </td>
  );
}

function ArmTable({ seg }: { seg: SegmentRead }) {
  const c = seg.arms.control;
  const x = seg.arms.close_x;
  const rows: { label: string; hint: string; cells: React.ReactNode }[] = [
    {
      label: "Exposed users",
      hint: "experiment_assignments rows",
      cells: (
        <>
          <td style={tdStyle()}>{int(c.exposed)}</td>
          <td style={tdStyle()}>{int(x.exposed)}</td>
          <td style={{ ...tdStyle(), color: seg.srm.state === "uneven" ? "var(--danger-text)" : "var(--ink-3)" }} title={seg.srm.text}>
            {seg.srm.state === "too_few" ? "split: too few" : seg.srm.state === "uneven" ? "split: uneven" : "split: even"}
          </td>
        </>
      ),
    },
    ...(
      [
        ["Trial the same day", "same US/Eastern day as exposure", "trialSameDay"],
        ["Trial within 24 h", "of exposed users 24 h+ in", "trial24h"],
        ["Trial within 7 days", "of exposed users 7 days+ in", "trial7d"],
        ["Auto-renew off within 24 h", "of trialists 24 h+ into the trial", "renewOff24h"],
        ["Converted to paid", "paid within 14 days, of trialists 14 days+ in", "paid14"],
      ] as const
    ).map(([label, hint, k]) => ({
      label,
      hint,
      cells: (
        <>
          <RateCell r={c[k]} />
          <RateCell r={x[k]} />
          <DiffCell d={seg.diffs[k]} />
        </>
      ),
    })),
    {
      label: "Refunds so far",
      hint: "trialists refunded after the trial start",
      cells: (
        <>
          <td style={tdStyle()}>{int(c.refunded)}</td>
          <td style={tdStyle()}>{int(x.refunded)}</td>
          <td style={tdStyle()} />
        </>
      ),
    },
    {
      label: "Revenue per exposed user, 14 days",
      hint: "gross, refunds not deducted",
      cells: (
        <>
          <MoneyCell m={c.rev14} days={14} />
          <MoneyCell m={x.rev14} days={14} />
          <td style={tdStyle()} />
        </>
      ),
    },
    {
      label: "Revenue per exposed user, 30 days",
      hint: "gross, refunds not deducted",
      cells: (
        <>
          <MoneyCell m={c.rev30} days={30} />
          <MoneyCell m={x.rev30} days={30} />
          <td style={tdStyle()} />
        </>
      ),
    },
  ];
  return (
    <>
      <h3 style={h3}>By arm</h3>
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle("left")}>Metric</th>
              <th style={thStyle()}>Control</th>
              <th style={thStyle()}>close_x</th>
              <th style={thStyle()}>close_x − control (95% range)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={tdStyle("left")}>
                  <div>{r.label}</div>
                  <div style={sub}>{r.hint}</div>
                </td>
                {r.cells}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div style={foot}>
        Trialists so far: {int(c.trialists)} control, {int(x.trialists)} close_x. Revenue differences carry no range: a few yearly
        payers swing them, so read them as direction only.
      </div>
    </>
  );
}

function Breakdown({ r }: { r: Readout }) {
  const rows = r.segments.filter((s) => s.source !== "all" || s.platform !== "all").filter((s) => s.arms.control.exposed + s.arms.close_x.exposed > 0);
  const name = (s: SegmentRead) =>
    [s.source === "all" ? "Both sources" : SOURCE_LABELS[s.source], s.platform === "all" ? "all platforms" : PLATFORM_LABELS[s.platform]].join(" · ");
  return (
    <>
      <h3 style={h3}>By source and platform</h3>
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle("left")}>Group</th>
              <th style={thStyle()}>Exposed C / X</th>
              <th style={thStyle()}>Split</th>
              <th style={thStyle()}>24 h trial C / X</th>
              <th style={thStyle()}>7-day trial C / X</th>
              <th style={thStyle()}>7-day difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key}>
                <td style={tdStyle("left")}>{name(s)}</td>
                <td style={tdStyle()}>
                  {int(s.arms.control.exposed)} / {int(s.arms.close_x.exposed)}
                </td>
                <td style={{ ...tdStyle(), color: s.srm.state === "uneven" ? "var(--danger-text)" : undefined }} title={s.srm.text}>
                  {s.srm.state === "too_few" ? "too few" : `${(s.srm.share! * 100).toFixed(1)}% X${s.srm.state === "uneven" ? ", uneven" : ""}`}
                </td>
                <td style={tdStyle()}>
                  {pct(s.arms.control.trial24h.rate)} / {pct(s.arms.close_x.trial24h.rate)}
                </td>
                <td style={tdStyle()}>
                  {pct(s.arms.control.trial7d.rate)} / {pct(s.arms.close_x.trial7d.rate)}
                </td>
                <DiffCell d={s.diffs.trial7d} />
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Checks({ r }: { r: Readout }) {
  const c = r.checks;
  const items: { ok: boolean; text: string }[] = [
    ...r.segments
      .filter((s) => s.platform === "all")
      .map((s) => ({
        ok: s.srm.state !== "uneven",
        text: `${s.source === "all" ? "Both sources" : SOURCE_LABELS[s.source]}: ${s.srm.text}`,
      })),
    {
      ok: c.armMismatch === 0,
      text: `${int(c.tagged)} exposed users carry the RevenueCat arm attribute (only trialists and buyers do); ${int(c.armMismatch)} of them disagree with their exposure row.`,
    },
    { ok: c.sourceMismatch === 0, text: `${int(c.sourceMismatch)} exposed users have a RevenueCat source attribute that disagrees with the row's salt.` },
    {
      ok: c.tagOnly.control + c.tagOnly.close_x === 0,
      text: `${int(c.tagOnly.control + c.tagOnly.close_x)} users have the arm in RevenueCat but no exposure row (${int(c.tagOnly.control)} control, ${int(c.tagOnly.close_x)} close_x). They are not counted.`,
    },
    ...(c.unknownVariant ? [{ ok: false, text: `${int(c.unknownVariant)} exposure rows have a variant other than control or close_x and are left out.` }] : []),
  ];
  return (
    <>
      <h3 style={h3}>Data checks</h3>
      <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((i) => (
          <div key={i.text} style={{ display: "flex", gap: 8, font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)" }}>
            <span aria-hidden style={{ ...dot, background: i.ok ? "var(--success)" : "var(--warning)" }} />
            <span>{i.text}</span>
          </div>
        ))}
      </Card>
    </>
  );
}

const STATUS_LABEL: Record<UserStatus, string> = {
  no_trial: "No trial",
  trial: "In trial",
  auto_renew_off: "Trial, auto-renew off",
  paid: "Paid",
  refunded: "Refunded",
};

function Recent({ r }: { r: Readout }) {
  return (
    <>
      <h3 style={h3}>Newest exposed users</h3>
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["User", "Arm", "Source", "Platform", "Exposed", "Trial", "Now"].map((h, i) => (
                <th key={h} style={thStyle(i < 4 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.recent.map((u) => (
              <tr key={u.appUserId}>
                <td style={tdStyle("left")} title={u.appUserId}>
                  <code>{u.appUserId.slice(0, 8)}…</code>
                </td>
                <td style={tdStyle("left")}>
                  <ArmChip arm={u.arm} />
                </td>
                <td style={tdStyle("left")}>{u.source === "revenuecat" ? "RevenueCat" : "App split"}</td>
                <td style={tdStyle("left")}>{PLATFORM_LABELS[u.platform]}</td>
                <td style={tdStyle()}>{fmtTime(u.exposedAt)}</td>
                <td style={tdStyle()}>{u.trialHoursAfter == null ? "—" : hoursLabel(u.trialHoursAfter)}</td>
                <td style={tdStyle()}>{STATUS_LABEL[u.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div style={foot}>
        Newest {r.recent.length} of {int(r.exposed)}. The same arm shows as a chip on the Support Inbox user card.
      </div>
    </>
  );
}

/** The small arm chip, shared with the per-user flag. */
export function ArmChip({ arm, title, prefix }: { arm: PaywallXArm; title?: string; prefix?: string }) {
  const x = arm === "close_x";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        font: "600 11px var(--font-ui)",
        padding: "2px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: x ? "color-mix(in srgb, var(--cat-3) 14%, var(--surface))" : "var(--neutral-soft)",
        color: x ? "var(--cat-3)" : "var(--neutral-text)",
        border: x ? "1px solid color-mix(in srgb, var(--cat-3) 35%, var(--line))" : "1px solid transparent",
      }}
    >
      {prefix}
      {arm}
    </span>
  );
}

function Definitions() {
  return (
    <details style={{ margin: "26px 2px 40px", font: "400 12.5px/1.6 var(--font-ui)", color: "var(--ink-3)" }}>
      <summary style={{ cursor: "pointer", color: "var(--ink-2)", font: "600 13px var(--font-ui)" }}>How these numbers are counted</summary>
      <ul style={{ paddingLeft: 18, margin: "10px 0 0" }}>
        <li>
          <strong>Exposed</strong>: every <code>experiment_assignments</code> row with key <code>{PAYWALL_X_KEY}</code> in the consumer
          database. The app writes one per user when a non-subscriber sees the onboarding paywall while the test is on, whether or not
          they start a trial. Source is RevenueCat when the row&apos;s salt is <code>rc</code>, the app&apos;s 50/50 split otherwise.
        </li>
        <li>
          <strong>Trial starts</strong> come from <code>rc_events</code> (INITIAL_PURCHASE, period TRIAL, production) for the same user,
          starting no earlier than 1 hour before the exposure row. Same day = same US/Eastern date; 24 h = within 24 hours; 7 days = within
          168 hours. Each rate counts only users already that far past exposure; the rest show as &ldquo;too recent&rdquo;.
        </li>
        <li>
          <strong>Auto-renew off within 24 h</strong>: a cancellation (not a refund or billing error) within 24 hours of the trial start,
          out of trialists (trial within 7 days of exposure) at least 24 hours into it.
        </li>
        <li>
          <strong>Converted to paid</strong>: a paid subscription charge within 14 days of the trial start (the Value per trial payer
          rule), out of trialists at least 14 days in. <strong>Refunds</strong>: trialists with a customer-support refund so far.
        </li>
        <li>
          <strong>Revenue per exposed user</strong>: gross charges (renewals, initial and one-off purchases, refunds not deducted, as in
          Value per trial) from exposure to 14 or 30 days after, divided by every exposed user that old.
        </li>
        <li>
          <strong>Difference</strong>: close_x minus control with a 95% normal range, shown once both arms have 30 users old enough. A range
          that crosses zero means no clear difference yet. <strong>Split check</strong>: 50/50 expected; flagged when a binomial test gives
          p &lt; 0.001, once 100 users are in.
        </li>
      </ul>
    </details>
  );
}

// ---- format -------------------------------------------------------------------

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const hoursLabel = (h: number) => (h < 1 ? "< 1 h after" : h < 48 ? `${Math.round(h)} h after` : `${(h / 24).toFixed(1)} days after`);

const sub: React.CSSProperties = { font: "400 11px var(--font-ui)", color: "var(--ink-4)", marginTop: 2 };
const foot: React.CSSProperties = { font: "400 12px/1.55 var(--font-ui)", color: "var(--ink-4)", margin: "8px 2px 0" };
const h3: React.CSSProperties = { font: "650 15px var(--font-ui)", margin: "28px 0 10px" };
const dot: React.CSSProperties = { width: 8, height: 8, borderRadius: 999, marginTop: 6, flex: "none" };
const backLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: "none",
  padding: 0,
  margin: "0 0 10px",
  cursor: "pointer",
  font: "500 12.5px var(--font-ui)",
  color: "var(--ink-3)",
};
