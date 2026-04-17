"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const params = useSearchParams();
  const presetError = params.get("error") === "not_allowed"
    ? "That email isn't on the allow list."
    : null;

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(presetError);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const next = params.get("next") ?? "/";
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-4 rounded-lg bg-brand-50 border border-brand-200 p-3 text-sm text-brand-800">
        Magic link sent. Check <span className="font-medium">{email}</span> and click
        the link to finish signing in.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Email</span>
        <div className="mt-1 relative">
          <Mail className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
          />
        </div>
      </label>
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <button type="submit" disabled={sending} className="btn-primary w-full">
        {sending ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}
