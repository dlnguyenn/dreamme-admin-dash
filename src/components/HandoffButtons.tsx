"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { ROADMAP_OWNERS } from "@/lib/roadmap";

/**
 * Posts this record to #handoffs in Discord and pings the person picked. The
 * DAD can't tell who's logged in, so the post says it's from the other person.
 */
export function HandoffButtons({
  kind,
  id,
  blockedReason,
}: {
  kind: "roadmap" | "request";
  id: string;
  /** Why it can't be sent right now, e.g. unsaved edits the post wouldn't include. */
  blockedReason?: string | null;
}) {
  const toast = useToast();
  const [sending, setSending] = React.useState<string | null>(null);
  const [posted, setPosted] = React.useState<{ to: string; url?: string } | null>(null);

  const send = async (to: string) => {
    setSending(to);
    try {
      const res = await fetch("/api/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, to }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPosted({ to, url: json.url });
      toast(`Handed off to ${to}`);
    } catch (e) {
      toast(`Couldn't hand off: ${(e as Error).message}`);
    } finally {
      setSending(null);
    }
  };

  if (posted) {
    return (
      <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
        Handed off to {posted.to} in Discord.{" "}
        {posted.url && (
          <a href={posted.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            Open the post
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Hand off to</span>
      {ROADMAP_OWNERS.map((person) => (
        <Button
          key={person}
          size="sm"
          variant="secondary"
          onClick={() => send(person)}
          disabled={!!sending || !!blockedReason}
        >
          {sending === person ? "Posting…" : person}
        </Button>
      ))}
      {blockedReason && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{blockedReason}</span>}
    </div>
  );
}
