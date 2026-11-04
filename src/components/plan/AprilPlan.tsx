"use client";

/**
 * April Plan tab: tracking for the April-2027 revenue plan (vault:
 * wiki/revenue-100k-question.md, Decision). Can DreamMe reach $100k gross in
 * April with Meta spend no higher than what its trials earn back in 12 months?
 *
 * Sub-views: Value per trial (what each channel can pay for an extra trial)
 * and Clippers (the pay-per-view clipper relaunch against its stop rule). The
 * Meta holdout lives on its own tab (Meta Switchback).
 */

import * as React from "react";
import { PageHeader } from "../Shell";
import { Button } from "../ui";
import { Segmented } from "../porcelain";
import { ValuePerTrial } from "./ValuePerTrial";
import { ClipperTracker } from "./ClipperTracker";
import type { SourceStatus } from "@/lib/revenue-plan/user-sources";

type View = "value" | "clippers";
const VIEW_KEY = "dreamme.aprilPlan.view";

export function AprilPlan() {
  const [view, setView] = React.useState<View>("value");
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "value" || saved === "clippers") setView(saved);
    } catch {}
  }, []);
  const pick = (v: string) => {
    setView(v as View);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Growth"
        title="April Plan"
        subtitle="Tracking for $100k gross in April 2027 with Meta spend no higher than what its trials earn back in 12 months. Net is gross x0.84 (Apple's real 15%), never RC proceeds."
        actions={
          <Segmented
            value={view}
            onChange={pick}
            options={[
              { value: "value", label: "Value per trial" },
              { value: "clippers", label: "Clippers" },
            ]}
          />
        }
      />
      <SourcesBanner onSynced={() => setRefreshKey((k) => k + 1)} />
      {view === "value" ? <ValuePerTrial key={`v${refreshKey}`} /> : <ClipperTracker key={`c${refreshKey}`} />}
    </div>
  );
}

/** Where the onboarding answers come from, and the backfill button until user_sources holds rows. */
function SourcesBanner({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = React.useState<SourceStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/plan/sources", { cache: "no-store" });
      const body = await res.json();
      if (body.ok) setStatus(body);
    } catch {}
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const backfill = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/plan/sources?full=1", { method: "POST" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMsg(`Copied ${body.read.toLocaleString("en-US")} users in ${Math.round(body.ms / 1000)}s.`);
      await load();
      onSynced();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  if (status.backend === "user_sources") {
    return (
      <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-4)", margin: "-12px 0 16px" }}>
        Sources: user_sources, {status.rows?.toLocaleString("en-US")} users
        {status.lastSyncedAt ? `, synced ${new Date(status.lastSyncedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}.
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 16,
        padding: "10px 14px",
        background: "var(--attention-soft)",
        color: "var(--attention-text)",
        borderRadius: 10,
        font: "400 13px var(--font-ui)",
      }}
    >
      <span style={{ flex: "1 1 320px" }}>
        {status.note} {msg}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={backfill}
        disabled={busy || status.rows == null}
        title={status.rows == null ? "Apply migration 0095 first" : "Copy every consumer user's onboarding answer now"}
      >
        {busy ? "Copying…" : "Backfill sources"}
      </Button>
    </div>
  );
}
