/**
 * Support Inbox — outbound SMTP via Gmail (smtp.gmail.com:465, App Password).
 *
 * From-address strategy: SUPPORT_FROM_EMAIL (default dan@dreamme.life).
 * Gmail rewrites From: back to the authenticated account unless "Send mail
 * as" is configured for that address in the dan@ mailbox settings, so
 * help@dreamme.life only works after that one-time setup. Reply-To is always
 * help@ so user replies land on the support alias either way.
 *
 * Plain text only. Gmail auto-saves sent mail to the Sent folder, keeping the
 * mailbox itself a complete record of every conversation.
 */
import nodemailer from "nodemailer";

const SMTP_USER = process.env.SUPPORT_IMAP_USER ?? "dan@dreamme.life";
const SMTP_PASS = process.env.DREAMME_SMTP_PASS ?? "";
const FROM_EMAIL = process.env.SUPPORT_FROM_EMAIL ?? "dan@dreamme.life";
const FROM_NAME = "Dan at DreamMe";
const REPLY_TO = "help@dreamme.life";

export function mailerConfigured(): boolean {
  return !!SMTP_USER && !!SMTP_PASS;
}

export interface SendReplyParams {
  to: string;
  subject: string;
  bodyText: string;
  /** Message-ID of the inbound message being answered (with <>) */
  inReplyTo?: string | null;
  /** Full References chain for the thread, oldest first */
  references?: string[];
}

export interface SendReplyResult {
  /** our generated Message-ID (with <>) — store it for future threading */
  messageId: string;
  accepted: string[];
}

export async function sendSupportReply(
  params: SendReplyParams,
): Promise<SendReplyResult> {
  if (!mailerConfigured()) throw new Error("DREAMME_SMTP_PASS not set");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const references = [...(params.references ?? [])];
  if (params.inReplyTo && !references.includes(params.inReplyTo)) {
    references.push(params.inReplyTo);
  }

  const info = await transporter.sendMail({
    from: { name: FROM_NAME, address: FROM_EMAIL },
    replyTo: REPLY_TO,
    to: params.to,
    subject: params.subject,
    text: params.bodyText,
    inReplyTo: params.inReplyTo ?? undefined,
    references: references.length ? references : undefined,
  });

  return {
    messageId: info.messageId,
    accepted: (info.accepted ?? []).map(String),
  };
}

/**
 * Operational alert to Dan himself — not a customer reply, so no Reply-To
 * rewrite to help@ and no threading headers. Used when support ingestion
 * looks broken, where the whole point is that nothing else would surface it.
 */
export async function sendOperationalAlert(params: {
  subject: string;
  bodyText: string;
}): Promise<void> {
  if (!mailerConfigured()) throw new Error("DREAMME_SMTP_PASS not set");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporter.sendMail({
    from: { name: "DreamMe Dashboard", address: FROM_EMAIL },
    to: SMTP_USER,
    subject: `[dash] ${params.subject}`,
    text: params.bodyText,
  });
}

/** Prefix a subject with Re: unless it already has one (case-insensitive). */
export function replySubject(original: string | null): string {
  const base = (original ?? "").trim() || "your message to DreamMe";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}
