"use client";

/**
 * Tiny client island on /clip/[token]: lets a clipper paste one of their own
 * video links. POSTs to the token-scoped public endpoint, then refreshes the
 * server-rendered page data. Inline styles (Tailwind isn't wired up).
 */
import * as React from "react";
import { useRouter } from "next/navigation";

const ACCENT = "#c96a4a";

export function SubmitVideoForm({ token }: { token: string }) {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || state === "busy") return;
    setState("busy");
    setMessage("");
    try {
      const res = await fetch("/api/clippers/submit-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, url: url.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setState("error");
        setMessage(data.error ?? "Something went wrong");
        return;
      }
      setState("done");
      setMessage("Added! Views update within a day.");
      setUrl("");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Network error — try again");
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          if (state !== "idle") setState("idle");
        }}
        placeholder="Paste a video link…"
        style={{
          width: 240,
          maxWidth: "100%",
          borderRadius: 8,
          border: "1px solid #d9d2c6",
          background: "#fff",
          padding: "8px 12px",
          fontSize: 14,
          color: "#1a1816",
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={state === "busy" || !url.trim()}
        style={{
          borderRadius: 8,
          border: "none",
          background: ACCENT,
          padding: "8px 14px",
          fontSize: 14,
          fontWeight: 600,
          color: "#fff",
          cursor: state === "busy" || !url.trim() ? "default" : "pointer",
          opacity: state === "busy" || !url.trim() ? 0.5 : 1,
        }}
      >
        {state === "busy" ? "Adding…" : "Add video"}
      </button>
      {message ? (
        <span style={{ fontSize: 12, color: state === "error" ? "#c0392b" : "#1e874b" }}>{message}</span>
      ) : null}
    </form>
  );
}
