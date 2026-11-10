/**
 * DAD: render a trial-email variant with sample data (no real user, no PII).
 *   GET ?list=1      -> JSON list of variants
 *   GET ?v=<index>   -> the HTML email
 *   GET ?v=<index>&format=text -> the plain-text part
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { allVariants } from "@/lib/trial-emails/content";
import { trialEndLabel } from "@/lib/trial-emails/core";
import { render } from "@/lib/trial-emails/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const variants = allVariants();
  if (url.searchParams.get("list")) {
    return NextResponse.json({ ok: true, variants: variants.map((v, i) => ({ index: i, label: v.label })) });
  }
  const v = variants[Number(url.searchParams.get("v") ?? 0)] ?? variants[0];
  const { email } = render(
    {
      kind: v.kind,
      cta: v.cta,
      cancelled: v.cancelled,
      aboutToStart: v.aboutToStart,
      firstName: "Jamie",
      fish: "Sushi",
      trialEnd: trialEndLabel(new Date().toISOString()),
      platform: "ios",
    },
    "preview",
    url.origin,
  );
  if (url.searchParams.get("format") === "text") {
    return new Response(`Subject: ${email.subject}\nPreview: ${email.preview}\n\n${email.text}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (url.searchParams.get("format") === "meta") {
    return NextResponse.json({ ok: true, subject: email.subject, preview: email.preview, label: v.label });
  }
  return new Response(email.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
