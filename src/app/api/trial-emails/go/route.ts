/**
 * Public: the button in a trial email. GET shows a hand-off page that opens
 * the app; the page's script POSTs back here to count the click, so link
 * scanners that prefetch with GET are not counted. Signed token only.
 */
import { NextResponse } from "next/server";
import { readToken } from "@/lib/trial-emails/core";
import { getAssignment, patchAssignment } from "@/lib/trial-emails/db";
import { badLinkPage, goPage } from "@/lib/trial-emails/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t");
  const tok = readToken(t);
  if (!tok || tok.purpose === "unsub") return badLinkPage();
  return goPage(t!);
}

export async function POST(req: Request) {
  const tok = readToken(new URL(req.url).searchParams.get("t"));
  if (!tok || tok.purpose === "unsub") return NextResponse.json({ ok: false }, { status: 400 });
  const row = await getAssignment(tok.originalTransactionId).catch(() => null);
  if (row) {
    const first = tok.purpose === "day0" ? "day0_first_click_at" : "day1_first_click_at";
    await patchAssignment(tok.originalTransactionId, {
      clicks: (row.clicks ?? 0) + 1,
      ...(row[first] ? {} : { [first]: new Date().toISOString() }),
    }).catch(() => {});
  }
  return new NextResponse(null, { status: 204 });
}
