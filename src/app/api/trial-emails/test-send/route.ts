/**
 * Send trial-email variants to Dan's own inbox (TEST_RECIPIENT, fixed in code;
 * the request cannot change the recipient). Bearer CRON_SECRET only.
 *   POST            -> the four main variants
 *   POST ?all=1     -> every variant
 *   POST ?v=0,3     -> chosen variants (indexes from /api/trial-emails/preview?list=1)
 * Links in test emails carry a "test" transaction id, so clicks and
 * unsubscribes from them change nothing.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { allVariants } from "@/lib/trial-emails/content";
import { TEST_RECIPIENT, trialEndLabel } from "@/lib/trial-emails/core";
import { mailerReady, render, sendEmail } from "@/lib/trial-emails/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAIN = [0, 2, 1, 6]; // day 0 shot, day 0 about-to-start, day 0 auto-renew off, day 1 how-I-feel

export async function POST(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!mailerReady()) return NextResponse.json({ ok: false, error: "DREAMME_SMTP_PASS not set" }, { status: 500 });
  const url = new URL(req.url);
  const variants = allVariants();
  const pick = url.searchParams.get("all")
    ? variants.map((_, i) => i)
    : url.searchParams.get("v")
      ? url.searchParams.get("v")!.split(",").map(Number).filter((i) => variants[i])
      : MAIN;
  // Embed Sushi when the file is on disk (local runs), so a test sent before
  // the deploy still shows the image; production sends use the hosted copy.
  const dir = path.join(process.cwd(), "public", "email");
  const inline = existsSync(path.join(dir, "sushi-waving.png"));
  const attachments = [
    { filename: "sushi.png", path: path.join(dir, "sushi-waving.png"), cid: "sushi-waving" },
    { filename: "dreamme.png", path: path.join(dir, "app-icon.png"), cid: "app-icon" },
  ];
  const sent: string[] = [];
  for (const i of pick) {
    const v = variants[i];
    const { email, links } = render(
      {
        kind: v.kind,
        cta: v.cta,
        cancelled: v.cancelled,
        aboutToStart: v.aboutToStart,
        firstName: "Dan",
        fish: "Sushi",
        trialEnd: trialEndLabel(new Date().toISOString()),
        platform: "ios",
      },
      "test",
      undefined,
      inline ? { sushi: "cid:sushi-waving", icon: "cid:app-icon" } : undefined,
    );
    await sendEmail(
      TEST_RECIPIENT,
      { ...email, subject: `[Test] ${email.subject}` },
      links.unsubscribeUrl,
      inline ? attachments : undefined,
    );
    sent.push(v.label);
  }
  return NextResponse.json({ ok: true, to: TEST_RECIPIENT, sent });
}
