"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";

export function RunNowButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function trigger() {
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/run", { method: "POST" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed (${res.status})`);
      }
      setOk(true);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={trigger} disabled={isPending} className="btn-primary">
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        Run Now
      </button>
      {ok && <span className="text-xs text-emerald-600">Workflow triggered.</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
