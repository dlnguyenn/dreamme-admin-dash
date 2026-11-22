"use client";

/**
 * Errors tab: DreamMe's own error tracker (replaces sentry.io). The app's
 * Sentry SDK sends to the DAD (/api/<project>/envelope/); issues are grouped
 * on ingest (src/lib/errors/). The list puts what needs a look first: new
 * this week, came back after a resolve, or spiking today.
 */
import * as React from "react";
import { PageHeader } from "../Shell";
import { Button } from "../ui";
import { Icons } from "../Icons";
import { ErrorBanner, FilterPill, InfoWell, Segmented, StatStrip, StatusPill, thStyle } from "../porcelain";
import { controlStyle, Select } from "../competitor-ads/parts";
import { useIsMobile } from "@/lib/useIsMobile";
import type { IssueRow } from "@/lib/errors/store";
import type { Connection, IssueView } from "@/lib/errors/view";
import { ago, Bars, Flag, n, PLATFORM_LABEL, shortRelease } from "./shared";
import { IssueDrawer } from "./IssueDrawer";

interface Payload {
  now: string;
  configured: boolean;
  projectId: string;
  connection: Connection;
  views: IssueView<IssueRow>[];
}

type Filter = "attention" | "unresolved" | "resolved" | "ignored";
type Sort = "last_seen" | "week" | "users" | "first_seen";
type Platform = "all" | "javascript" | "cocoa" | "java";

const needsLook = (v: IssueView<IssueRow>) => v.issue.status === "unresolved" && (v.isNew || v.regressed || v.spiking);

function flags(v: IssueView<IssueRow>) {
  return (
    <>
      {v.crash && <Flag kind="danger">Crash</Flag>}
      {v.spiking && <Flag kind="danger">Spiking</Flag>}
      {v.regressed && <Flag kind="warning">Came back</Flag>}
      {v.isNew && <Flag kind="info">New</Flag>}
      {v.issue.status === "resolved" && <Flag kind="neutral">Resolved</Flag>}
      {v.issue.status === "ignored" && <Flag kind="neutral">Ignored</Flag>}
    </>
  );
}

function ConnectionLine({ data }: { data: Payload }) {
  const c = data.connection;
  if (!data.configured) {
    return (
      <InfoWell style={{ marginBottom: 16 }}>
        Not switched on for this deployment yet: set <code>ERRORS_DSN_PUBLIC_KEY</code> (and optionally <code>ERRORS_PROJECT_ID</code>, default 1) in
        Vercel. Until then the endpoint accepts nothing.
      </InfoWell>
    );
  }
  if (c.state === "waiting") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <StatusPill kind="neutral">Waiting for the app</StatusPill>
        <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
          No errors received yet. They start once an app version with the DAD's DSN ships.
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
      {c.state === "receiving" ? <StatusPill kind="running">Receiving</StatusPill> : <StatusPill kind="danger">Gone quiet</StatusPill>}
      <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
        Last error {ago(c.lastEventAt)}
        {c.state === "quiet" && ". Usually the app stopped sending, not that errors stopped."}
      </span>
    </div>
  );
}

export function Errors() {
  const isMobile = useIsMobile();
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("attention");
  const [platform, setPlatform] = React.useState<Platform>("all");
  const [sort, setSort] = React.useState<Sort>("last_seen");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/errors", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Open the needs-a-look view only when there is something in it.
  const views = data?.views ?? [];
  const counts: Record<Filter, number> = {
    attention: views.filter(needsLook).length,
    unresolved: views.filter((v) => v.issue.status === "unresolved").length,
    resolved: views.filter((v) => v.issue.status === "resolved").length,
    ignored: views.filter((v) => v.issue.status === "ignored").length,
  };
  const firstLoad = React.useRef(true);
  React.useEffect(() => {
    if (data && firstLoad.current) {
      firstLoad.current = false;
      if (counts.attention === 0) setFilter("unresolved");
    }
  }, [data, counts.attention]);

  const q = query.trim().toLowerCase();
  const shown = views
    .filter((v) => (filter === "attention" ? needsLook(v) : v.issue.status === filter))
    .filter((v) => platform === "all" || v.issue.platform === platform)
    .filter((v) => !q || `${v.issue.title} ${v.issue.culprit ?? ""} ${v.issue.last_release ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sort === "week") return b.last7 - a.last7 || b.issue.last_seen.localeCompare(a.issue.last_seen);
      if (sort === "users") return b.issue.user_count - a.issue.user_count;
      if (sort === "first_seen") return b.issue.first_seen.localeCompare(a.issue.first_seen);
      return b.issue.last_seen.localeCompare(a.issue.last_seen);
    });

  const unresolved = views.filter((v) => v.issue.status === "unresolved");
  const today = unresolved.reduce((s, v) => s + v.today, 0);
  const week = unresolved.reduce((s, v) => s + v.last7, 0);
  const crashesWeek = unresolved.filter((v) => v.crash).reduce((s, v) => s + v.last7, 0);

  const onChanged = (issue: IssueRow) => {
    setData((d) => (d ? { ...d, views: d.views.map((v) => (v.issue.id === issue.id ? { ...v, issue: { ...v.issue, ...issue } } : v)) } : d));
  };

  return (
    <div>
      <style>{`.err-row{transition:background-color 120ms ease}.err-row:hover{background:var(--surface-2)}.err-focus:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`}</style>
      <PageHeader
        title="Errors"
        subtitle="Crashes and errors from the app, grouped into issues. The app's Sentry SDK sends them straight to the DAD."
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!data && !error && <InfoWell>Loading…</InfoWell>}

      {data && (
        <>
          <ConnectionLine data={data} />
          <StatStrip
            stats={[
              { label: "Unresolved issues", value: n(counts.unresolved), note: `${counts.attention} need a look` },
              { label: "Errors today", value: n(today), note: "since midnight UTC" },
              { label: "Errors in 7 days", value: n(week), note: `${n(crashesWeek)} of them crashes` },
              { label: "New issues in 7 days", value: n(views.filter((v) => v.isNew).length), note: "first seen this week" },
            ]}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "20px 0 12px" }}>
            <FilterPill label="Needs a look" count={counts.attention} attention={counts.attention > 0} selected={filter === "attention"} onClick={() => setFilter("attention")} />
            <FilterPill label="Unresolved" count={counts.unresolved} selected={filter === "unresolved"} onClick={() => setFilter("unresolved")} />
            <FilterPill label="Resolved" count={counts.resolved} selected={filter === "resolved"} onClick={() => setFilter("resolved")} />
            <FilterPill label="Ignored" count={counts.ignored} selected={filter === "ignored"} onClick={() => setFilter("ignored")} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <label style={{ position: "relative", flex: isMobile ? "1 1 100%" : "0 1 280px", minWidth: 0 }}>
              <span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)", pointerEvents: "none" }}>
                <Icons.Search size={17} />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search errors, screens, versions"
                aria-label="Search errors"
                className="err-focus"
                style={{ ...controlStyle, width: "100%", paddingLeft: 34 }}
              />
            </label>
            <div className={isMobile ? "mobile-hscroll" : undefined} style={isMobile ? { maxWidth: "100%", overflowX: "auto", flex: "1 1 100%" } : undefined}>
            <Segmented
              size="sm"
              value={platform}
              onChange={(v) => setPlatform(v as Platform)}
              options={[
                { value: "all", label: "All" },
                { value: "javascript", label: "JavaScript" },
                { value: "cocoa", label: "iOS native" },
                { value: "java", label: "Android native" },
              ]}
            />
            </div>
            <Select<Sort>
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: "last_seen", label: "Last seen" },
                { value: "week", label: "Most errors this week" },
                { value: "users", label: "Most users" },
                { value: "first_seen", label: "Newest issue" },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <InfoWell>
              {views.length === 0
                ? "No issues yet."
                : filter === "attention"
                  ? "Nothing new, nothing came back, nothing spiking."
                  : "No issues match these filters."}
            </InfoWell>
          ) : isMobile ? (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2 }}>
              {shown.map((v) => (
                <button
                  key={v.issue.id}
                  onClick={() => setOpenId(v.issue.id)}
                  className="err-row err-focus"
                  style={{ all: "unset", cursor: "pointer", display: "block", padding: "12px 4px", borderBottom: "1px solid var(--line)", boxSizing: "border-box", width: "100%", minWidth: 0 }}
                >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>{flags(v)}</div>
                  <div style={{ font: "600 14px/1.35 var(--font-ui)", color: "var(--ink)", overflowWrap: "anywhere" }}>{v.issue.title}</div>
                  <div style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.issue.culprit ?? PLATFORM_LABEL[v.issue.platform ?? ""] ?? v.issue.platform}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, font: "400 12.5px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
                    <Bars values={v.series} highlightLast={v.spiking} width={70} height={18} />
                    <span>{n(v.last7)} this week</span>
                    <span>{n(v.issue.user_count)} {v.issue.user_count === 1 ? "user" : "users"}</span>
                    <span style={{ color: "var(--ink-3)" }}>{ago(v.issue.last_seen)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle("left"), width: "100%" }}>Issue</th>
                    <th style={thStyle("left")}>14 days</th>
                    <th style={thStyle()}>This week</th>
                    <th style={thStyle()}>Users</th>
                    <th style={thStyle()}>Last seen</th>
                    <th style={thStyle("left")}>Latest version</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v) => (
                    <tr
                      key={v.issue.id}
                      className="err-row"
                      onClick={() => setOpenId(v.issue.id)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                    >
                      <td style={{ padding: "12px 16px", maxWidth: 0 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenId(v.issue.id);
                          }}
                          className="err-focus"
                          style={{ all: "unset", cursor: "pointer", display: "block", font: "600 14px/1.35 var(--font-ui)", color: "var(--ink)", overflowWrap: "anywhere" }}
                        >
                          {v.issue.title}
                        </button>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", marginTop: 3 }}>
                          {flags(v)}
                          <span
                            title={v.issue.culprit ?? undefined}
                            style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)", minWidth: 0, flex: "1 1 160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {v.issue.culprit ?? PLATFORM_LABEL[v.issue.platform ?? ""] ?? v.issue.platform}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <Bars values={v.series} highlightLast={v.spiking} />
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", font: "600 13.5px var(--font-ui)", color: "var(--ink)" }}>{n(v.last7)}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right", font: "400 13.5px var(--font-ui)", color: "var(--ink-2)" }}>{n(v.issue.user_count)}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right", font: "400 13px var(--font-ui)", color: "var(--ink-2)", whiteSpace: "nowrap" }}>{ago(v.issue.last_seen)}</td>
                      <td style={{ padding: "12px 16px", font: "400 13px var(--font-ui)", color: "var(--ink-2)", whiteSpace: "nowrap" }}>{shortRelease(v.issue.last_release)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ height: 16 }} />
          <InfoWell>
            Only app versions that send to the DAD show up here; older versions still report to sentry.io. JavaScript stack lines read as real
            file names once that build&rsquo;s source maps are uploaded (scripts/upload-error-sourcemaps.mjs). Samples are kept 60 days.
          </InfoWell>
        </>
      )}

      <IssueDrawer issueId={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />
    </div>
  );
}
