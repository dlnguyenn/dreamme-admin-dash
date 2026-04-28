"use client";

import * as React from "react";

interface FatiguedFamily {
  id: string;
  exemplar_text: string;
  category: string | null;
  fatigue_score: number;
  fatigue_reason: string | null;
  cooldown_until: string | null;
  last_use_at: string | null;
  member_count: number;
}

const REASON_LABEL: Record<string, string> = {
  recent_flops: "recent flops",
  recent_use: "used too recently",
  copycat_saturation: "cross-persona overlap",
};

function formatDays(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const days = Math.round((t - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "expired";
  if (days === 1) return "1d";
  return `${days}d`;
}

function daysSince(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const days = Math.round((now - t) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function FatiguePanel({
  supabaseUrl,
  supabaseAnon,
}: {
  supabaseUrl: string;
  supabaseAnon: string;
}) {
  const [rows, setRows] = React.useState<FatiguedFamily[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `${supabaseUrl}/rest/v1/hook_families?select=id,exemplar_text,category,fatigue_score,fatigue_reason,cooldown_until,last_use_at,member_count&fatigue_score=gt.0&order=fatigue_score.desc&limit=10`;
        const res = await fetch(url, {
          headers: {
            apikey: supabaseAnon,
            Authorization: `Bearer ${supabaseAnon}`,
          },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (cancelled) return;
        setRows((await res.json()) as FatiguedFamily[]);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabaseUrl, supabaseAnon]);

  if (error) {
    return (
      <div
        style={{
          padding: 14,
          fontSize: 12,
          color: "var(--ink-4)",
          border: "1px dashed var(--line-2)",
          borderRadius: 10,
        }}
      >
        Could not load fatigue data — {error}
      </div>
    );
  }

  if (rows == null) {
    return (
      <div
        style={{
          padding: 14,
          fontSize: 12,
          color: "var(--ink-4)",
          border: "1px dashed var(--line-2)",
          borderRadius: 10,
        }}
      >
        Loading fatigue signal…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 14,
          fontSize: 12,
          color: "var(--ink-4)",
          border: "1px dashed var(--line-2)",
          borderRadius: 10,
          textAlign: "center",
        }}
      >
        No fatigued families yet — system needs deployed hooks to start scoring.
      </div>
    );
  }

  const now = Date.now();

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {rows.map((f, i) => {
        const cooldown = formatDays(f.cooldown_until, now);
        const lastUse = daysSince(f.last_use_at, now);
        const reasonLabel = f.fatigue_reason
          ? REASON_LABEL[f.fatigue_reason] ?? f.fatigue_reason
          : null;
        const isCooled = cooldown && cooldown !== "expired";
        return (
          <div
            key={f.id}
            style={{
              padding: "12px 16px",
              borderBottom:
                i < rows.length - 1 ? "1px solid var(--line)" : "none",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 70px 90px 80px",
              alignItems: "center",
              gap: 12,
              minWidth: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                className="serif"
                style={{
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={f.exemplar_text}
              >
                {f.exemplar_text}
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: "var(--ink-4)",
                  marginTop: 2,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {f.category ?? "uncat"} · {f.member_count} members
                {reasonLabel && ` · ${reasonLabel}`}
              </div>
            </div>
            <div
              style={{
                fontSize: 14,
                fontFamily: "var(--font-geist-mono), monospace",
                color: f.fatigue_score > 0.6 ? "var(--accent)" : "var(--ink-3)",
                fontWeight: 600,
                textAlign: "right",
              }}
              title="Fatigue score (0–1)"
            >
              {f.fatigue_score.toFixed(2)}
            </div>
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                color: "var(--ink-4)",
                textAlign: "right",
              }}
              title="Last use"
            >
              {lastUse ?? "—"}
            </div>
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                color: isCooled ? "var(--accent)" : "var(--ink-4)",
                textAlign: "right",
              }}
              title="Cooldown remaining"
            >
              {cooldown ?? "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
