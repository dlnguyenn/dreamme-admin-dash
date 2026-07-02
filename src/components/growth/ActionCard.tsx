"use client";

/**
 * Growth AI · proposed-action card — renders a propose_action emitted by
 * the analyst as a confirm-gated card. Nothing touches Meta until the
 * user clicks Confirm (which POSTs /api/growth/act with confirm:true).
 * Card state persists on the chat message so a reload can't re-execute.
 */

import * as React from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { fmtUSD } from "./shared";

export type ActionState = "proposed" | "applied" | "dismissed" | "failed";

export interface ChatAction {
  kind: "pause_ad" | "activate_ad" | "set_adset_budget" | "set_campaign_budget" | "duplicate_adset";
  target_id: string;
  target_name: string;
  params: { daily_budget_cents?: number; target_campaign_id?: string };
  reason: string;
  state: ActionState;
  resultNote?: string;
}

const KIND_META: Record<
  ChatAction["kind"],
  { icon: string; verb: string; destructive: boolean }
> = {
  pause_ad: { icon: "⏸", verb: "Pause ad", destructive: true },
  activate_ad: { icon: "▶", verb: "Activate ad", destructive: false },
  set_adset_budget: { icon: "＄", verb: "Set ad set budget", destructive: false },
  set_campaign_budget: { icon: "＄", verb: "Set campaign budget", destructive: false },
  duplicate_adset: { icon: "⧉", verb: "Duplicate ad set", destructive: false },
};

export function actionDetail(a: ChatAction): string {
  if (a.kind === "set_adset_budget" || a.kind === "set_campaign_budget") {
    return `Daily budget → ${fmtUSD((a.params.daily_budget_cents ?? 0) / 100)}`;
  }
  if (a.kind === "duplicate_adset") {
    return a.params.target_campaign_id
      ? `Deep copy into campaign ${a.params.target_campaign_id} — lands PAUSED`
      : "Deep copy in place — lands PAUSED";
  }
  return a.kind === "pause_ad" ? "Stops delivery immediately" : "Resumes delivery";
}

export function ActionCard({
  action,
  onResolve,
}: {
  action: ChatAction;
  onResolve: (state: ActionState, resultNote?: string) => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const meta = KIND_META[action.kind];
  const settled = action.state !== "proposed";

  const execute = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      const res = await fetch("/api/growth/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: {
            kind: action.kind,
            target_id: action.target_id,
            target_name: action.target_name,
            params: action.params,
            reason: action.reason,
          },
          confirm: true,
          source: "analyst_chat",
        }),
      });
      const body = (await res.json()) as { error?: string; log_id?: string | null };
      if (!res.ok || body.error) {
        onResolve("failed", body.error ?? `HTTP ${res.status}`);
      } else {
        onResolve("applied", `${meta.verb} — ${action.target_name || action.target_id}`);
      }
    } catch (e) {
      onResolve("failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stateBadge =
    action.state === "applied"
      ? { label: "✓ Applied", tone: "var(--accent-2)" }
      : action.state === "failed"
        ? { label: "✕ Failed", tone: "var(--accent)" }
        : action.state === "dismissed"
          ? { label: "Dismissed", tone: "var(--ink-4)" }
          : null;

  return (
    <div
      style={{
        border: `1px solid ${settled ? "var(--line)" : "color-mix(in oklab, var(--accent) 30%, var(--line))"}`,
        borderLeft: `3px solid ${settled ? "var(--line-2)" : "var(--accent)"}`,
        borderRadius: 12,
        background: "var(--surface)",
        padding: "12px 14px",
        opacity: action.state === "dismissed" ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 15, lineHeight: "20px" }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {meta.verb}: {action.target_name || action.target_id}
            </span>
            {stateBadge && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "2px 8px",
                  borderRadius: 999,
                  color: `color-mix(in oklab, ${stateBadge.tone} 80%, var(--ink))`,
                  background: `color-mix(in oklab, ${stateBadge.tone} 14%, var(--surface))`,
                  border: `1px solid color-mix(in oklab, ${stateBadge.tone} 30%, var(--line))`,
                }}
              >
                {stateBadge.label}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{actionDetail(action)}</div>
          {action.reason && (
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: "var(--ink-4)",
                  marginRight: 6,
                }}
              >
                WHY
              </span>
              {action.reason}
            </div>
          )}
          {action.state === "failed" && action.resultNote && (
            <div style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 6 }}>{action.resultNote}</div>
          )}
        </div>
      </div>

      {action.state === "proposed" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
          <button
            onClick={() => onResolve("dismissed")}
            disabled={busy}
            style={{
              padding: "6px 14px",
              fontSize: 12.5,
              borderRadius: 9,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink-3)",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            style={{
              padding: "6px 16px",
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 9,
              border: "1px solid var(--ink)",
              background: busy ? "var(--surface-2)" : "var(--ink)",
              color: busy ? "var(--ink-4)" : "var(--surface)",
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? "Applying…" : "Confirm & apply"}
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`${meta.verb}?`}
          message={
            <>
              <strong>{action.target_name || action.target_id}</strong>
              <br />
              {actionDetail(action)}
              <br />
              <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                This hits the live Meta account immediately.
              </span>
            </>
          }
          confirmLabel="Apply to Meta"
          destructive={meta.destructive}
          onConfirm={() => void execute()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
