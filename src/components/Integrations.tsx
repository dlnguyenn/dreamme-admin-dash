"use client";

import * as React from "react";
import { PageHeader } from "./Shell";

interface MetaConnectionPublic {
  connected: boolean;
  fb_user_name?: string | null;
  token_expires_at?: string | null;
  scopes?: string | null;
  ad_accounts?: Array<{ id: string; name: string }> | null;
  default_ad_account_id?: string | null;
  status?: string;
  updated_at?: string;
}

export function Integrations() {
  const [adminPw, setAdminPw] = React.useState("");
  const [status, setStatus] = React.useState<MetaConnectionPublic | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Surface the ?meta=connected|error redirect result from the OAuth callback.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const meta = url.searchParams.get("meta");
    if (meta === "connected") setBanner({ kind: "ok", text: "Facebook account connected." });
    else if (meta === "error") {
      setBanner({ kind: "err", text: `Connection failed: ${url.searchParams.get("reason") ?? "unknown error"}` });
    }
    if (meta) {
      url.searchParams.delete("meta");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const loadStatus = React.useCallback(async (pw: string) => {
    if (!pw) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/meta?admin=${encodeURIComponent(pw)}`, { cache: "no-store" });
      if (res.status === 401) {
        setError("Wrong admin password.");
        setStatus(null);
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as MetaConnectionPublic);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const connect = () => {
    if (!adminPw) {
      setError("Enter the admin password first.");
      return;
    }
    window.location.href = `/api/oauth/meta/start?admin=${encodeURIComponent(adminPw)}`;
  };

  const disconnect = async () => {
    if (!adminPw) {
      setError("Enter the admin password first.");
      return;
    }
    if (!window.confirm("Disconnect the Meta account? The MCP will fall back to the env token (if any).")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/meta", {
        method: "DELETE",
        headers: { "x-admin-password": adminPw },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await loadStatus(adminPw);
      setBanner({ kind: "ok", text: "Disconnected." });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const expiry = status?.token_expires_at ? new Date(status.token_expires_at) : null;
  const daysLeft = expiry ? Math.round((expiry.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Integrations"
        title="Connections"
        subtitle="Connect your Meta (Facebook) account so the Ads MCP and syncs use a managed token instead of a hand-pasted one."
      />

      {banner && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            background: banner.kind === "ok" ? "color-mix(in oklab, green 12%, transparent)" : "color-mix(in oklab, red 12%, transparent)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
          }}
        >
          {banner.text}
        </div>
      )}

      <div
        style={{
          maxWidth: 640,
          padding: 20,
          borderRadius: 14,
          background: "var(--surface)",
          border: "1px solid var(--line)",
        }}
      >
        <div className="serif" style={{ fontSize: 22, marginBottom: 4 }}>
          Meta Ads
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>
          Login with Facebook to grant ads access. Token is stored server-side and auto-refreshed.
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <input
            type="password"
            placeholder="Admin password"
            value={adminPw}
            onChange={(e) => setAdminPw(e.target.value)}
            onBlur={() => loadStatus(adminPw)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: "var(--ink)",
              fontSize: 13,
              minWidth: 200,
            }}
          />
          <button
            onClick={() => loadStatus(adminPw)}
            style={btnStyle("ghost")}
            disabled={loading}
          >
            {loading ? "Checking…" : "Check status"}
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--danger, red)", fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        {status?.connected ? (
          <div style={{ marginBottom: 16 }}>
            <Row label="Status" value={status.status ?? "active"} />
            <Row label="Facebook user" value={status.fb_user_name || "—"} />
            <Row
              label="Token expires"
              value={
                expiry
                  ? `${expiry.toISOString().slice(0, 10)}${daysLeft != null ? ` (${daysLeft}d)` : ""}`
                  : "unknown"
              }
            />
            <Row label="Default ad account" value={status.default_ad_account_id || "—"} />
            <Row
              label="Ad accounts"
              value={
                status.ad_accounts && status.ad_accounts.length
                  ? `${status.ad_accounts.length}: ${status.ad_accounts.map((a) => a.name || a.id).slice(0, 5).join(", ")}${status.ad_accounts.length > 5 ? "…" : ""}`
                  : "—"
              }
            />
          </div>
        ) : status && !status.connected ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>
            No Meta account connected yet.
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={connect} style={btnStyle("primary")} disabled={loading}>
            {status?.connected ? "Reconnect Facebook" : "Connect Facebook"}
          </button>
          {status?.connected && (
            <button onClick={disconnect} style={btnStyle("ghost")} disabled={loading}>
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span style={{ color: "var(--ink-3)", minWidth: 150 }}>{label}</span>
      <span style={{ color: "var(--ink)", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function btnStyle(kind: "primary" | "ghost"): React.CSSProperties {
  return {
    padding: "9px 16px",
    borderRadius: 9,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid var(--line)",
    background: kind === "primary" ? "var(--ink)" : "var(--surface-2)",
    color: kind === "primary" ? "var(--surface)" : "var(--ink)",
  };
}
