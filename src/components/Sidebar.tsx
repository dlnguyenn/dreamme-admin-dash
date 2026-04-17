"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutDashboard, LogOut, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  {
    href: "/dashboards/daily-content",
    label: "Daily Content",
    icon: LayoutDashboard,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  // Hide the sidebar on the login page for a cleaner look.
  if (pathname?.startsWith("/login")) return null;

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside className="hidden md:flex md:w-56 shrink-0 flex-col border-r border-slate-200 bg-white/70 backdrop-blur px-3 py-4">
      <Link
        href="/"
        className="flex items-center gap-2 px-2 py-2 mb-4 rounded-lg hover:bg-slate-50"
      >
        <div className="size-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white">
          <Sparkles className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-none">DreamMe</div>
          <div className="text-xs text-slate-500 mt-0.5">Admin</div>
        </div>
      </Link>

      <nav className="flex-1 flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || (href !== "/" && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-700 hover:bg-slate-100",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={signOut}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
      >
        <LogOut className="size-4" />
        Sign out
      </button>
    </aside>
  );
}
