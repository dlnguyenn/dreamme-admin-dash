"use client";

/**
 * Tiny client island on /clip/[token]: lets a clipper paste one of their own
 * video links. POSTs to the token-scoped public endpoint, then refreshes the
 * server-rendered page data.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

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
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          if (state !== "idle") setState("idle");
        }}
        placeholder="Paste a video link…"
        className="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-[#c96a4a] sm:w-72"
      />
      <button
        type="submit"
        disabled={state === "busy" || !url.trim()}
        className="rounded-lg bg-[#c96a4a] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === "busy" ? "Adding…" : "Add video"}
      </button>
      {message ? (
        <span
          className={`text-xs ${state === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          {message}
        </span>
      ) : null}
    </form>
  );
}
