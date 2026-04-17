import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCaptionWithItems, getCaptions } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { CopyButton } from "@/components/CopyButton";
import { SearchInput } from "./SearchInput";

export const dynamic = "force-dynamic";

export default async function CaptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; caption?: string }>;
}) {
  const sp = await searchParams;
  const captions = await getCaptions({ search: sp.q });
  const selectedId = sp.caption ?? captions[0]?.id ?? null;
  const selected = selectedId ? await getCaptionWithItems(selectedId) : null;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Link
        href="/dashboards/daily-content"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4"
      >
        <ArrowLeft className="size-4" />
        Daily Content
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-xs text-brand-600 font-medium">Bucket</div>
          <h1 className="text-2xl font-semibold tracking-tight">All captions</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every caption ever generated, searchable. Each caption also lives under
            its associated image.
          </p>
        </div>
        <SearchInput initial={sp.q ?? ""} />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <aside className="lg:col-span-2">
          <div className="card divide-y divide-slate-100 max-h-[75vh] overflow-auto">
            {captions.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No captions found.</div>
            ) : (
              captions.map((c) => {
                const active = c.id === selectedId;
                return (
                  <Link
                    key={c.id}
                    href={`/dashboards/daily-content/captions?${new URLSearchParams({
                      ...(sp.q ? { q: sp.q } : {}),
                      caption: c.id,
                    }).toString()}`}
                    className={`block p-4 hover:bg-slate-50 ${
                      active ? "bg-brand-50/60" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs text-slate-500">
                        {formatDate(c.created_at)}
                      </div>
                      <div className="text-xs text-slate-400">
                        {c.char_count.toLocaleString()} chars
                      </div>
                    </div>
                    <div className="text-sm text-slate-800 line-clamp-3">
                      {c.text}
                    </div>
                    {c.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <span key={t} className="chip bg-slate-100 text-slate-600">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        </aside>

        <section className="lg:col-span-3">
          {selected ? (
            <div className="flex flex-col gap-4">
              <div className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-xs text-slate-500">
                      {formatDate(selected.caption.created_at)}
                    </div>
                    <div className="text-lg font-semibold">Caption</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      {selected.caption.char_count.toLocaleString()} chars
                    </span>
                    <CopyButton text={selected.caption.text} />
                  </div>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed max-h-[55vh] overflow-auto">
                  {selected.caption.text}
                </pre>
              </div>

              {selected.items.length > 0 && (
                <div className="card p-5">
                  <div className="text-sm font-semibold mb-3">
                    Linked persona images
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {selected.items.map((item) => (
                      <Link
                        key={item.id}
                        href={`/dashboards/daily-content/item/${item.id}`}
                        className="group block"
                      >
                        <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-slate-100">
                          {item.image_url ? (
                            <Image
                              src={item.image_url}
                              alt={item.persona.display_name}
                              fill
                              className="object-cover group-hover:scale-[1.02] transition-transform"
                              sizes="(max-width: 1024px) 33vw, 15vw"
                              unoptimized
                            />
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-600 mt-1">
                          {item.persona.display_name}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card p-6 text-sm text-slate-500">
              Select a caption to view it.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
