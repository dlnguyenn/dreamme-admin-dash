/**
 * Trial emails — links and the mailer. Sends through the same Gmail SMTP
 * account as the Support Inbox (lib/support/mailer.ts): from "Dan at DreamMe"
 * <dan@dreamme.life>, replies to help@ so they land in the Support Inbox.
 * dreamme.life is cleared with Apple's private relay, so relay addresses
 * (41% of iOS trialists) receive it.
 */
import nodemailer from "nodemailer";
import { makeToken, type EmailKind } from "./core";
import { LIVE_THEME, renderEmail, type EmailAssets, type EmailInput, type EmailTheme, type RenderedEmail } from "./content";

const SMTP_USER = process.env.SUPPORT_IMAP_USER ?? "dan@dreamme.life";
const SMTP_PASS = process.env.DREAMME_SMTP_PASS ?? "";
const FROM_EMAIL = process.env.SUPPORT_FROM_EMAIL ?? "dan@dreamme.life";
const FROM_NAME = "Dan at DreamMe";
const REPLY_TO = "help@dreamme.life";

/** Public origin for links and the Sushi image. */
export function publicBase(): string {
  return (process.env.TRIAL_EMAIL_PUBLIC_URL || "https://dreamme-admin-dash.vercel.app").replace(/\/$/, "");
}

export function linksFor(otid: string, kind: EmailKind, base = publicBase(), theme: EmailTheme = LIVE_THEME) {
  return {
    ctaUrl: `${base}/api/trial-emails/go?t=${makeToken(otid, kind)}`,
    unsubscribeUrl: `${base}/api/trial-emails/unsubscribe?t=${makeToken(otid, "unsub")}`,
    assets: assetsFor(base, theme),
  };
}

export function assetsFor(base = publicBase(), theme: EmailTheme = LIVE_THEME): EmailAssets {
  return {
    heroDay0: `${base}/email/hero-day0-${theme}.gif`,
    heroDay1: `${base}/email/hero-day1-${theme}.gif`,
    icon: `${base}/email/app-icon.png`,
    moods: {
      great: `${base}/email/mood-great-${theme}.png`,
      okay: `${base}/email/mood-okay-${theme}.png`,
      rough: `${base}/email/mood-rough-${theme}.png`,
      tired: `${base}/email/mood-tired-${theme}.png`,
    },
    font: `${base}/email/jellee.ttf`,
  };
}

export const mailerReady = () => !!SMTP_USER && !!SMTP_PASS;

export async function sendEmail(
  to: string,
  email: RenderedEmail,
  unsubscribeUrl: string,
  attachments?: { filename: string; path: string; cid: string }[],
): Promise<string> {
  if (!mailerReady()) throw new Error("DREAMME_SMTP_PASS not set");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: { name: FROM_NAME, address: FROM_EMAIL },
    replyTo: REPLY_TO,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: {
      // RFC 8058 one-click unsubscribe (Gmail and Apple Mail show a button).
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    attachments,
  });
  return info.messageId;
}

export function render(
  input: Omit<EmailInput, "ctaUrl" | "unsubscribeUrl" | "assets">,
  otid: string,
  base?: string,
  assets?: Partial<EmailAssets>,
) {
  const links = linksFor(otid, input.kind, base, input.theme ?? LIVE_THEME);
  if (assets) links.assets = { ...links.assets, ...assets };
  return { email: renderEmail({ ...input, ...links }), links };
}
