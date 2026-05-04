"use client";

import * as React from "react";
import { Button } from "./ui";

const PLAID_SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

interface ConnectedItem {
  item_id: string;
  institution_name: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

interface ItemsResponse {
  ok: boolean;
  configured: boolean;
  items: ConnectedItem[];
  error?: string;
}

declare global {
  interface Window {
    Plaid?: {
      create: (opts: {
        token: string;
        onSuccess: (
          public_token: string,
          metadata: { institution?: { name?: string } | null },
        ) => void;
        onExit?: (err: unknown) => void;
        onEvent?: (eventName: string) => void;
      }) => { open: () => void };
    };
  }
}

let scriptLoadPromise: Promise<void> | null = null;
function loadPlaidScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Plaid) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PLAID_SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () =>
      reject(new Error("failed to load Plaid Link script"));
    document.head.appendChild(s);
  });
  return scriptLoadPromise;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function PlaidConnect({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = React.useState<ConnectedItem[]>([]);
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [linking, setLinking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/plaid/items");
      const json = (await res.json()) as ItemsResponse;
      setConfigured(json.configured);
      setItems(json.items ?? []);
      if (!res.ok && json.error) setError(json.error);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const startLink = async () => {
    setError(null);
    setLinking(true);
    try {
      await loadPlaidScript();
      if (!window.Plaid) throw new Error("Plaid script did not load");
      const tokenRes = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.ok) {
        throw new Error(tokenJson.error ?? `HTTP ${tokenRes.status}`);
      }
      const handler = window.Plaid.create({
        token: tokenJson.link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            const exchangeRes = await fetch("/api/plaid/exchange-token", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                public_token,
                institution_name: metadata.institution?.name,
              }),
            });
            const exchangeJson = await exchangeRes.json();
            if (!exchangeRes.ok || !exchangeJson.ok) {
              throw new Error(
                exchangeJson.error ?? `HTTP ${exchangeRes.status}`,
              );
            }
            await refresh();
            onChange?.();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setLinking(false);
          }
        },
        onExit: (err) => {
          setLinking(false);
          if (err) setError(String(err));
        },
      });
      handler.open();
    } catch (e) {
      setError((e as Error).message);
      setLinking(false);
    }
  };

  if (configured === null) {
    return null;
  }

  if (!configured) {
    return (
      <div
        style={{
          padding: 12,
          border: "1px dashed var(--line)",
          borderRadius: 10,
          background: "var(--surface-2)",
          fontSize: 12,
          color: "var(--ink-3)",
          marginBottom: 20,
          lineHeight: 1.5,
        }}
      >
        <div style={{ marginBottom: 4, color: "var(--ink-2)", fontWeight: 500 }}>
          Bank linking unavailable
        </div>
        Set <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> in
        Vercel env to enable automatic Chase business-card sync. Until
        then, use Import CSV.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--surface)",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: items.length ? 10 : 0,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--ink-3)",
              marginBottom: 2,
            }}
          >
            Connected banks
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {items.length === 0
              ? "No bank linked. Connect your Chase business card to sync charges automatically."
              : `${items.length} linked · syncs hourly + on transaction events`}
          </div>
        </div>
        <Button onClick={startLink} disabled={linking}>
          {linking ? "Connecting…" : items.length ? "Link another" : "Connect bank"}
        </Button>
      </div>

      {items.length > 0 && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          {items.map((it) => (
            <div
              key={it.item_id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                padding: "6px 10px",
                background: "var(--surface-2)",
                borderRadius: 6,
              }}
            >
              <span style={{ color: "var(--ink)" }}>
                {it.institution_name ?? it.item_id}
              </span>
              <span
                style={{
                  color: it.last_sync_error
                    ? "var(--accent)"
                    : "var(--ink-3)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {it.last_sync_error
                  ? `error · ${timeAgo(it.last_sync_at)}`
                  : `synced ${timeAgo(it.last_sync_at)}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: "6px 10px",
            background:
              "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--accent)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
