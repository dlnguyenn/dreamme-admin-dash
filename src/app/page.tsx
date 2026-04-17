import Link from "next/link";
import { ArrowRight, LayoutDashboard, Sparkles } from "lucide-react";

const DASHBOARDS = [
  {
    href: "/dashboards/daily-content",
    title: "Daily Content Pipeline",
    subtitle: "3 Personas · N8N",
    description:
      "Stored results from the DreamMe Daily Content Pipeline workflow, sorted by persona. Includes every caption in its own bucket.",
    accent: "from-brand-500 to-brand-700",
    icon: LayoutDashboard,
  },
];

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-brand-600 text-sm font-medium mb-2">
          <Sparkles className="size-4" />
          DreamMe Admin
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboards</h1>
        <p className="text-slate-500 mt-1">
          Tools to help DreamMe grow. Pick a dashboard to get started.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {DASHBOARDS.map(({ href, title, subtitle, description, accent, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group card p-5 hover:shadow-md transition-shadow"
          >
            <div
              className={`size-10 rounded-lg bg-gradient-to-br ${accent} grid place-items-center text-white mb-4`}
            >
              <Icon className="size-5" />
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{title}</h2>
              <ArrowRight className="size-4 text-slate-400 group-hover:text-brand-600 transition-colors" />
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
            <p className="text-sm text-slate-600 mt-3">{description}</p>
          </Link>
        ))}

        <div className="card p-5 border-dashed border-slate-300 bg-slate-50/60 grid place-items-center text-center">
          <div>
            <div className="text-sm font-medium text-slate-500">More soon</div>
            <p className="text-xs text-slate-400 mt-1">
              Analytics, TikTok insights, Telegram re-send…
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
