"use client";

/**
 * Top-of-Overview strip for urgent problems from anywhere in the DAD (see
 * src/lib/overview-alerts.ts for what qualifies). Not hideable from the
 * Sections menu on purpose: an urgent alert you've hidden isn't an alert.
 *
 * An item can be dismissed. The dismissal is keyed on the item's fingerprint,
 * so it comes back by itself when the problem changes (a new rejected ad, a
 * pipeline that breaks again after recovering).
 */

import * as React from "react";
import type { UrgentAlert } from "@/lib/overview-alerts";
import type { DashId } from "../Shell";
import { Icons } from "../Icons";
import { fam } from "../porcelain";

const DISMISSED_KEY = "dad.overview.dismissed.v1";

function readDismissed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function NeedsAttention({
  alerts,
  onNavigate,
}: {
  alerts: UrgentAlert[] | null;
  onNavigate: (id: DashId) => void;
}) {
  const [dismissed, setDismissed] = React.useState<Record<string, string>>({});
  const [showDismissed, setShowDismissed] = React.useState(false);
  React.useEffect(() => setDismissed(readDismissed()), []);

  if (alerts == null) return null;

  const isDismissed = (a: UrgentAlert) => dismissed[a.id] === a.fingerprint;
  const active = alerts.filter((a) => !isDismissed(a));
  const hidden = alerts.filter(isDismissed);
  const shown = showDismissed ? alerts : active;

  const setDismissal = (a: UrgentAlert, on: boolean) => {
    setDismissed((prev) => {
      const next = { ...prev };
      if (on) next[a.id] = a.fingerprint;
      else delete next[a.id];
      // Drop entries for alerts that no longer exist so the map can't grow forever.
      for (const id of Object.keys(next)) if (!alerts.some((x) => x.id === id)) delete next[id];
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      } catch {
        // not persisted; still applies this visit
      }
      return next;
    });
  };

  if (alerts.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "0 0 14px",
          font: "500 13px var(--font-ui)",
          color: fam("success").text,
        }}
      >
        <Icons.Check size={14} stroke="currentColor" />
        Nothing urgent. Pipelines, Meta, trials and support all look normal.
      </div>
    );
  }

  const criticalCount = active.filter((a) => a.level === "critical").length;

  return (
    <div style={{ margin: "0 0 18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "0 0 10px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: active.length ? fam(criticalCount ? "danger" : "warning").solid : fam("success").solid,
            color: fam(criticalCount ? "danger" : "warning").onSolid,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <Icons.TriAlert size={14} strokeWidth={2} />
        </span>
        <h3 style={{ font: "650 15px var(--font-ui)", margin: 0 }}>Needs attention</h3>
        <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
          {active.length === 0
            ? "nothing new"
            : criticalCount > 0
              ? `${criticalCount} urgent${active.length > criticalCount ? ` · ${active.length - criticalCount} to check` : ""}`
              : `${active.length} to check`}
        </span>
        {hidden.length > 0 && (
          <button
            onClick={() => setShowDismissed((s) => !s)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              padding: 0,
              minHeight: 0,
              font: "500 12.5px var(--font-ui)",
              color: "var(--ink-3)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {showDismissed ? "Hide dismissed" : `${hidden.length} dismissed`}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {shown.map((a) => {
          const f = fam(a.level === "critical" ? "danger" : "warning");
          const off = isDismissed(a);
          return (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "11px 14px",
                borderRadius: 12,
                background: f.soft,
                border: `1px solid ${a.level === "critical" ? f.solid : "transparent"}`,
                opacity: off ? 0.55 : 1,
              }}
            >
              <span
                style={{
                  flex: "none",
                  marginTop: 2,
                  font: "700 10px var(--font-ui)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: f.onSolid,
                  background: f.solid,
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                {a.level === "critical" ? "Urgent" : "Check"}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ font: "650 13.5px/1.35 var(--font-ui)", color: f.text, overflowWrap: "anywhere" }}>
                  {a.title}
                </div>
                <div
                  style={{
                    font: "400 12.5px/1.45 var(--font-ui)",
                    color: "var(--ink-2)",
                    marginTop: 2,
                    overflowWrap: "anywhere",
                  }}
                >
                  {a.detail}
                </div>
                {a.link && (
                  <div style={{ marginTop: 6 }}>
                    {"tab" in a.link ? (
                      <button
                        onClick={() => onNavigate((a.link as { tab: DashId }).tab)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          minHeight: 0,
                          font: "600 12.5px var(--font-ui)",
                          color: f.text,
                          cursor: "pointer",
                        }}
                      >
                        Open {a.link.label} →
                      </button>
                    ) : (
                      <a
                        href={a.link.href}
                        target="_blank"
                        rel="noreferrer"
                        style={{ font: "600 12.5px var(--font-ui)", color: f.text, textDecoration: "none" }}
                      >
                        Open {a.link.label} ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => setDismissal(a, !off)}
                title={off ? "Bring back" : "Dismiss until this changes"}
                aria-label={off ? "Bring back" : "Dismiss"}
                style={{
                  flex: "none",
                  background: "none",
                  border: "none",
                  padding: 2,
                  minHeight: 0,
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  font: "500 12px var(--font-ui)",
                }}
              >
                {off ? "Undo" : <Icons.Close size={14} stroke="currentColor" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
