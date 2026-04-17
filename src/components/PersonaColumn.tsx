import Image from "next/image";
import Link from "next/link";
import type { ContentItemView, Persona } from "@/lib/queries";
import { formatDate } from "@/lib/utils";

const PERSONA_GRADIENT: Record<string, string> = {
  andrea: "from-rose-400 to-pink-600",
  emma: "from-sky-400 to-indigo-600",
  olivia: "from-amber-400 to-orange-600",
};

export function PersonaColumn({
  persona,
  items,
}: {
  persona: Persona;
  items: ContentItemView[];
}) {
  const gradient = PERSONA_GRADIENT[persona.slug] ?? "from-brand-400 to-brand-700";

  return (
    <section className="flex flex-col min-w-0">
      <header className="flex items-center gap-2 mb-3">
        <div
          className={`size-8 rounded-md bg-gradient-to-br ${gradient} text-white grid place-items-center text-sm font-semibold`}
        >
          {persona.display_name.charAt(0)}
        </div>
        <div>
          <h2 className="text-base font-semibold leading-none">
            {persona.display_name}
          </h2>
          <div className="text-xs text-slate-500 mt-0.5">
            {items.length} {items.length === 1 ? "item" : "items"}
          </div>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500 text-center">
          No content yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/dashboards/daily-content/item/${item.id}`}
              className="group card overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="relative aspect-[3/4] bg-slate-100">
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={`${persona.display_name} — ${formatDate(item.created_at)}`}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover group-hover:scale-[1.02] transition-transform"
                    unoptimized
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">
                    image unavailable
                  </div>
                )}
              </div>
              <div className="px-3 py-2 text-xs text-slate-500">
                {formatDate(item.created_at)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
