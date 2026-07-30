"use client";

/**
 * Client island on /clip/[token]: lets a clipper connect their own Facebook
 * page so we can find their clips automatically. Posts to the token-scoped
 * public endpoint, which saves the page AND scans it immediately, then
 * refreshes the server-rendered page data.
 *
 * Two shapes: a prominent card when nothing is connected, a one-line summary
 * with a "Change" affordance once it is. Inline styles (Tailwind isn't wired).
 */
import * as React from "react";
import { useRouter } from "next/navigation";

const ACCENT = "#c96a4a";
const MUTED = "#9a8f85";

function prettyPage(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

export function ConnectPage({
  token,
  pageUrl,
}: {
  token: string;
  pageUrl: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(pageUrl ?? "");
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || state === "busy") return;
    setState("busy");
    setMessage("");
    try {
      const res = await fetch("/api/clippers/connect-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pageUrl: value.trim() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        discovered?: number;
        scanError?: string;
      };
      if (!res.ok || !data.ok) {
        setState("error");
        setMessage(data.error ?? "Something went wrong");
        return;
      }
      setState("done");
      setMessage(
        data.scanError
          ? "Page saved. We'll pick up your videos on the next daily scan."
          : data.discovered
            ? `Connected — found ${data.discovered} video${data.discovered === 1 ? "" : "s"}.`
            : "Connected. We didn't spot any videos yet, but we'll keep checking daily.",
      );
      setEditing(false);
      router.refresh();
    } catch {
      setState("error");
      setMessage("Network error — try again");
    }
  }

  const input = (
    <form onSubmit={submit} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        type="text"
        inputMode="url"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (state !== "idle") setState("idle");
        }}
        placeholder="facebook.com/yourpage"
        style={{
          flex: "1 1 260px",
          minWidth: 0,
          borderRadius: 8,
          border: "1px solid #d9d2c6",
          background: "#fff",
          padding: "9px 12px",
          fontSize: 14,
          color: "#1a1816",
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={state === "busy" || !value.trim()}
        style={{
          borderRadius: 8,
          border: "none",
          background: ACCENT,
          padding: "9px 18px",
          fontSize: 14,
          fontWeight: 600,
          color: "#fff",
          cursor: state === "busy" || !value.trim() ? "default" : "pointer",
          opacity: state === "busy" || !value.trim() ? 0.5 : 1,
        }}
      >
        {state === "busy" ? "Connecting…" : "Connect"}
      </button>
      {pageUrl ? (
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(pageUrl);
            setState("idle");
            setMessage("");
          }}
          style={{
            border: "none",
            background: "none",
            padding: "9px 4px",
            fontSize: 13,
            color: MUTED,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      ) : null}
    </form>
  );

  const note = message ? (
    <div
      style={{
        marginTop: 8,
        fontSize: 13,
        color: state === "error" ? "#c0392b" : "#1e874b",
      }}
    >
      {message}
    </div>
  ) : null;

  // --- connected: compact summary -------------------------------------------
  if (pageUrl && !editing) {
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: MUTED,
        }}
      >
        <span>
          Tracking{" "}
          <a
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: ACCENT, textDecoration: "none", fontWeight: 500 }}
          >
            {prettyPage(pageUrl)}
          </a>{" "}
          · updates daily
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            border: "none",
            background: "none",
            padding: 0,
            fontSize: 13,
            color: MUTED,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Change
        </button>
        {note}
      </div>
    );
  }

  // --- not connected (or editing): full card --------------------------------
  return (
    <div
      style={{
        marginBottom: 20,
        borderRadius: 18,
        border: `1px solid ${ACCENT}44`,
        background: `${ACCENT}0f`,
        padding: "18px 20px",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1816" }}>
        Connect your Facebook page
      </div>
      <p style={{ margin: "4px 0 12px", fontSize: 13.5, lineHeight: 1.5, color: "#6b6159" }}>
        Paste your page link and we&apos;ll find your clips automatically — new posts get picked up
        and view counts refresh every day. No need to add videos one by one.
      </p>
      {input}
      {note}
    </div>
  );
}
