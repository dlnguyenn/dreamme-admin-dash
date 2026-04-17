import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getContentItem } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { CopyButton } from "@/components/CopyButton";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getContentItem(id);
  if (!item) notFound();

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link
        href="/dashboards/daily-content"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4"
      >
        <ArrowLeft className="size-4" />
        Daily Content
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3">
          <div className="card overflow-hidden">
            <div className="relative aspect-[3/4] bg-slate-100">
              {item.image_url ? (
                <Image
                  src={item.image_url}
                  alt={`${item.persona.display_name} ${formatDate(item.created_at)}`}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
                  image unavailable
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs text-brand-600 font-medium">
                {item.persona.display_name}
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                {formatDate(item.created_at)}
              </h1>
            </div>
            {item.caption_id && (
              <Link
                href={`/dashboards/daily-content/captions?caption=${item.caption_id}`}
                className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
              >
                <FileText className="size-3.5" />
                In captions
              </Link>
            )}
          </div>

          {item.caption_text ? (
            <div className="card p-4 flex-1">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold">Caption</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {item.caption_text.length.toLocaleString()} chars
                  </span>
                  <CopyButton text={item.caption_text} />
                </div>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed max-h-[70vh] overflow-auto">
                {item.caption_text}
              </pre>
            </div>
          ) : (
            <div className="card p-4 text-sm text-slate-500">
              No caption linked to this item.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
