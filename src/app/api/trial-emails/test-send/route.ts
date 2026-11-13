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
import { EMAIL_THEMES, LIVE_THEME, allVariants, type EmailTheme } from "@/lib/trial-emails/content";
import { TEST_RECIPIENT, trialEndLabel } from "@/lib/trial-emails/core";
import { mailerReady, render, sendEmail } from "@/lib/trial-emails/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAIN = [0, 2, 1, 6]; // day 0 food, day 0 shot (food done), day 0 food auto-renew off, day 1 food + mood row

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
  const t = url.searchParams.get("theme");
  const theme: EmailTheme = EMAIL_THEMES.includes(t as EmailTheme) ? (t as EmailTheme) : LIVE_THEME;
  const dir = path.join(process.cwd(), "public", "email");
  const inline = existsSync(path.join(dir, `hero-day0-${theme}.gif`));
  const attachments = (kind: "day0" | "day1") => [
    { filename: "sushi.gif", path: path.join(dir, `hero-${kind}-${theme}.gif`), cid: `hero-${kind}` },
    { filename: "dreamme.png", path: path.join(dir, "app-icon.png"), cid: "app-icon" },
    { filename: "stars.png", path: path.join(dir, `stars-${theme}.png`), cid: "stars" },
    ...(kind === "day1"
      ? (["great", "okay", "rough", "tired"] as const).map((m) => ({ filename: `${m}.png`, path: path.join(dir, `mood-${m}-${theme}.png`), cid: `mood-${m}` }))
      : []),
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
        theme,
      },
      "test",
      undefined,
      inline
        ? {
            heroDay0: "cid:hero-day0",
            heroDay1: "cid:hero-day1",
            icon: "cid:app-icon",
            stars: "cid:stars",
            moods: { great: "cid:mood-great", okay: "cid:mood-okay", rough: "cid:mood-rough", tired: "cid:mood-tired" },
          }
        : undefined,
    );
    await sendEmail(
      TEST_RECIPIENT,
      { ...email, subject: `[Test ${theme}] ${email.subject}` },
      links.unsubscribeUrl,
      inline ? attachments(v.kind) : undefined,
    );
    sent.push(v.label);
  }
  return NextResponse.json({ ok: true, to: TEST_RECIPIENT, theme, sent });
}
