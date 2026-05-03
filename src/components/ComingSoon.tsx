"use client";

import * as React from "react";
import { Chip, PersonaChip } from "./ui";
import { PageHeader, type NavItem } from "./Shell";
import { Icons } from "./Icons";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "@/lib/personas";
import { PERSONA_TIKTOK_PROFILES } from "@/lib/apify";
import { SUPABASE_ANON, SUPABASE_URL } from "@/lib/supabase";

interface ScrapedRow {
  persona: PersonaId;
  view_count: number | null;
  slide_count: number | null;
  posted_at: string | null;
}

interface PersonaStats {
  totalViews: number;
  totalPosts: number;
  transformationViews: number;
  transformationCount: number;
  singleViews: number;
  singleCount: number;
  unclassifiedViews: number;
  unclassifiedCount: number;
}

const EMPTY_STATS: PersonaStats = {
  totalViews: 0,
  totalPosts: 0,
  transformationViews: 0,
  transformationCount: 0,
  singleViews: 0,
  singleCount: 0,
  unclassifiedViews: 0,
  unclassifiedCount: 0,
};

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

interface PayPeriod {
  start: Date; // inclusive, UTC midnight
  end: Date; // exclusive, UTC midnight
}

// Pay periods: 1st–15th and 16th–end of month (UTC).
// Boundaries are UTC midnight; posts whose UTC timestamp lands inside [start, end)
// belong to that period. Local-tz posts near midnight may slip ±1 period — flagged
// in the UI hint. Internal payout sanity check, not source of truth.
function getPayPeriod(at: Date): PayPeriod {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  if (d <= 15) {
    return {
      start: new Date(Date.UTC(y, m, 1)),
      end: new Date(Date.UTC(y, m, 16)),
    };
  }
  return {
    start: new Date(Date.UTC(y, m, 16)),
    end: new Date(Date.UTC(y, m + 1, 1)),
  };
}

function shiftPayPeriod(period: PayPeriod, dir: -1 | 1): PayPeriod {
  const y = period.start.getUTCFullYear();
  const m = period.start.getUTCMonth();
  const d = period.start.getUTCDate();
  if (dir === -1) {
    if (d === 16) {
      return {
        start: new Date(Date.UTC(y, m, 1)),
        end: new Date(Date.UTC(y, m, 16)),
      };
    }
    return {
      start: new Date(Date.UTC(y, m - 1, 16)),
      end: new Date(Date.UTC(y, m, 1)),
    };
  }
  if (d === 1) {
    return {
      start: new Date(Date.UTC(y, m, 16)),
      end: new Date(Date.UTC(y, m + 1, 1)),
    };
  }
  return {
    start: new Date(Date.UTC(y, m + 1, 1)),
    end: new Date(Date.UTC(y, m + 1, 16)),
  };
}

function samePayPeriod(a: PayPeriod, b: PayPeriod): boolean {
  return a.start.getTime() === b.start.getTime();
}

function formatPeriodLabel(p: PayPeriod): string {
  // "May 1 – 15, 2026" or "May 16 – 31, 2026"
  const startMonth = p.start.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const startDay = p.start.getUTCDate();
  // end is exclusive — last day of period is end - 1 day
  const lastDay = new Date(p.end.getTime() - 24 * 60 * 60 * 1000);
  const endDay = lastDay.getUTCDate();
  const year = p.start.getUTCFullYear();
  return `${startMonth} ${startDay} – ${endDay}, ${year}`;
}

function formatPayoutDate(p: PayPeriod): string {
  const lastDay = new Date(p.end.getTime() - 24 * 60 * 60 * 1000);
  return lastDay.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function aggregate(rows: ScrapedRow[]): Map<PersonaId, PersonaStats> {
  const out = new Map<PersonaId, PersonaStats>();
  for (const id of PERSONA_IDS) out.set(id, { ...EMPTY_STATS });
  for (const r of rows) {
    const s = out.get(r.persona);
    if (!s) continue;
    const views = Number(r.view_count ?? 0);
    s.totalViews += views;
    s.totalPosts += 1;
    if (r.slide_count == null) {
      s.unclassifiedViews += views;
      s.unclassifiedCount += 1;
    } else if (r.slide_count > 1) {
      s.transformationViews += views;
      s.transformationCount += 1;
    } else if (r.slide_count === 1) {
      s.singleViews += views;
      s.singleCount += 1;
    } else {
      // slide_count === 0 → not a slideshow, treat as unclassified
      s.unclassifiedViews += views;
      s.unclassifiedCount += 1;
    }
  }
  return out;
}

function useTrackedPostStats(
  enabled: boolean,
  period: PayPeriod,
): {
  stats: Map<PersonaId, PersonaStats> | null;
  error: string | null;
} {
  const [stats, setStats] = React.useState<Map<PersonaId, PersonaStats> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const startIso = period.start.toISOString();
  const endIso = period.end.toISOString();

  React.useEffect(() => {
    if (!enabled || !SUPABASE_URL || !SUPABASE_ANON) return;
    let cancelled = false;
    setStats(null);
    setError(null);
    (async () => {
      try {
        const url =
          `${SUPABASE_URL}/rest/v1/tiktok_posts` +
          `?select=persona,view_count,slide_count,posted_at` +
          `&posted_at=gte.${encodeURIComponent(startIso)}` +
          `&posted_at=lt.${encodeURIComponent(endIso)}` +
          `&limit=1000`;
        const res = await fetch(url, {
          headers: {
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${SUPABASE_ANON}`,
          },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (cancelled) return;
        const rows = (await res.json()) as ScrapedRow[];
        setStats(aggregate(rows));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, startIso, endIso]);

  return { stats, error };
}

const BULLETS: Record<string, string[]> = {
  analytics: [
    "Views and completion rate per video",
    "Follower growth by persona",
    "Best-performing posting times",
    "Weekly rollup email summary",
  ],
  comments: [
    "Unified inbox across Andrea, Emma, Olivia",
    "Flag high-intent replies (DM requests, product questions)",
    "Reply templates per persona voice",
    "Sentiment trend over time",
  ],
  hooks: [
    "First 3 seconds: retention breakdown",
    "Compare hook formats (question, stat, scene)",
    "Winning hooks library for the next workflow",
    "A/B hook scoring",
  ],
  poster: [
    "Queue from caption library → TikTok",
    "Schedule per persona time slots",
    "Auto-attach image + caption from pipeline",
    "Mirror to IG Reels",
  ],
};

const TINTS: Record<string, string> = {
  analytics: "var(--p-emma)",
  comments: "var(--p-olivia)",
  hooks: "var(--p-andrea)",
  poster: "var(--accent)",
};

export function ComingSoon({ item }: { item: NavItem }) {
  const IconComp = Icons[item.icon];
  const things = BULLETS[item.id] ?? [];
  const tint = TINTS[item.id] ?? "var(--accent)";
  const [period, setPeriod] = React.useState<PayPeriod>(() =>
    getPayPeriod(new Date()),
  );
  const currentPeriod = React.useMemo(() => getPayPeriod(new Date()), []);
  const isCurrent = samePayPeriod(period, currentPeriod);
  const { stats } = useTrackedPostStats(item.id === "analytics", period);

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard · coming soon"
        title={<span style={{ fontStyle: "italic" }}>{item.label}</span>}
        subtitle={
          item.desc +
          ". Designed but not wired up yet — scaffolded here so the team knows what's coming."
        }
        tint={`color-mix(in oklab, ${tint} 35%, transparent)`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 20,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 20,
            padding: 32,
            minHeight: 320,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -80,
              right: -80,
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: `radial-gradient(circle, color-mix(in oklab, ${tint} 40%, transparent), transparent 70%)`,
              filter: "blur(30px)",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: `color-mix(in oklab, ${tint} 15%, var(--surface-2))`,
                border: `1px solid color-mix(in oklab, ${tint} 30%, var(--line))`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <IconComp size={22} stroke={tint} />
            </div>
            <div
              className="serif"
              style={{
                fontSize: 28,
                fontWeight: 400,
                letterSpacing: "-0.02em",
                fontStyle: "italic",
                marginBottom: 10,
              }}
            >
              In the oven.
            </div>
            <p
              style={{
                color: "var(--ink-3)",
                fontSize: 14,
                lineHeight: 1.6,
                margin: 0,
                maxWidth: 440,
              }}
            >
              This dashboard is scaffolded and waiting for its data source.
              When it&apos;s ready, it&apos;ll show up here — same shell, same
              language, same feel.
            </p>
          </div>
          <div
            style={{
              position: "relative",
              display: "flex",
              gap: 8,
              marginTop: 24,
            }}
          >
            <Chip tone="accent">Planned</Chip>
            <Chip>Q2 2026</Chip>
          </div>
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 20,
            padding: 28,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--ink-4)",
              marginBottom: 16,
            }}
          >
            What goes here
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {things.map((t, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: "var(--ink-4)",
                    minWidth: 20,
                    paddingTop: 2,
                  }}
                >
                  0{i + 1}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                  }}
                >
                  {t}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {item.id === "analytics" && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 20,
            padding: 24,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--ink-4)",
              }}
            >
              Tracked TikTok accounts
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {
                PERSONA_IDS.filter((p) => PERSONA_TIKTOK_PROFILES[p]).length
              }{" / "}
              {PERSONA_IDS.length} active
            </div>
          </div>

          <PayPeriodNav
            period={period}
            isCurrent={isCurrent}
            onShift={(dir) => setPeriod((p) => shiftPayPeriod(p, dir))}
            onResetCurrent={() => setPeriod(currentPeriod)}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {PERSONA_IDS.map((pid) => {
              const persona = PERSONAS[pid];
              const handle = PERSONA_TIKTOK_PROFILES[pid];
              const tracked = !!handle;
              const s = stats?.get(pid);
              return (
                <div
                  key={pid}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: "12px 14px",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    minWidth: 0,
                    opacity: tracked ? 1 : 0.55,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <PersonaChip persona={persona} size="sm" />
                    {tracked ? (
                      <a
                        href={`https://www.tiktok.com/@${handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 12,
                          color: "var(--ink-2)",
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          minWidth: 0,
                        }}
                        title={`Open @${handle} on TikTok`}
                      >
                        @{handle}
                      </a>
                    ) : (
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 11,
                          color: "var(--ink-4)",
                          fontStyle: "italic",
                        }}
                      >
                        not yet tracked
                      </span>
                    )}
                  </div>
                  {tracked && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        paddingTop: 6,
                        borderTop: "1px solid var(--line)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          className="serif"
                          style={{
                            fontSize: 18,
                            color: "var(--ink)",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                          }}
                        >
                          {s ? formatViewCount(s.totalViews) : "—"}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--ink-4)",
                            fontFamily: "var(--font-geist-mono), monospace",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          views · pay period
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          fontSize: 11,
                          color: "var(--ink-3)",
                          fontFamily: "var(--font-geist-mono), monospace",
                          flexWrap: "wrap",
                        }}
                      >
                        <span title="Slideshow posts with more than one slide (transformation arcs, narrative)">
                          {s ? formatViewCount(s.transformationViews) : "—"}
                          <span style={{ color: "var(--ink-4)", marginLeft: 4 }}>
                            transformation ({s?.transformationCount ?? 0})
                          </span>
                        </span>
                        <span style={{ color: "var(--ink-4)" }}>·</span>
                        <span title="Single-slide photo posts with text overlay">
                          {s ? formatViewCount(s.singleViews) : "—"}
                          <span style={{ color: "var(--ink-4)", marginLeft: 4 }}>
                            single ({s?.singleCount ?? 0})
                          </span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div
        style={{
          background: "var(--surface-2)",
          border: "1px dashed var(--line-2)",
          borderRadius: 20,
          padding: 24,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--ink-4)",
            marginBottom: 16,
          }}
        >
          Preview — layout placeholder
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 12,
          }}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 120,
                background: "var(--surface)",
                borderRadius: 12,
                border: "1px solid var(--line)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            height: 240,
            background: "var(--surface)",
            borderRadius: 12,
            border: "1px solid var(--line)",
          }}
        />
      </div>
    </div>
  );
}

function PayPeriodNav({
  period,
  isCurrent,
  onShift,
  onResetCurrent,
}: {
  period: PayPeriod;
  isCurrent: boolean;
  onShift: (dir: -1 | 1) => void;
  onResetCurrent: () => void;
}) {
  const arrowBtn = (
    label: string,
    onClick: () => void,
    disabled = false,
  ): React.ReactNode => (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "1px solid var(--line)",
        borderRadius: 8,
        color: disabled ? "var(--ink-4)" : "var(--ink-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 14,
        fontFamily: "inherit",
        opacity: disabled ? 0.5 : 1,
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 12px",
        marginBottom: 16,
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        Pay period
      </div>
      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        {arrowBtn("‹", () => onShift(-1))}
        <div
          className="serif"
          style={{
            fontSize: 14,
            color: "var(--ink)",
            minWidth: 150,
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatPeriodLabel(period)}
        </div>
        {arrowBtn("›", () => onShift(1), isCurrent)}
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
        title="Pay periods close on the 15th and the last day of each month (UTC)."
      >
        Payout · {formatPayoutDate(period)}
      </div>
      {!isCurrent && (
        <button
          onClick={onResetCurrent}
          style={{
            marginLeft: "auto",
            padding: "4px 10px",
            fontSize: 11,
            fontFamily: "inherit",
            background: "transparent",
            border: "1px solid var(--line)",
            borderRadius: 6,
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          Today
        </button>
      )}
    </div>
  );
}
