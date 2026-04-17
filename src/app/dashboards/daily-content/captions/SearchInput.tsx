"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function SearchInput({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim());
    startTransition(() => {
      router.push(`/dashboards/daily-content/captions?${params.toString()}`);
    });
  }

  return (
    <form onSubmit={submit} className="relative">
      <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search captions…"
        className="rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
      />
      {isPending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
          …
        </span>
      )}
    </form>
  );
}
