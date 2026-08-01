/**
 * Support Inbox — AI triage. Classifies a thread, judges spam, and writes two
 * alternative reply drafts in Dan's voice.
 *
 * Hard guards applied AFTER the model, regardless of output:
 *  - no em/en dashes anywhere in a draft (Dan's rule for his-voice email)
 *  - sign-off "Dan, co-founder of DreamMe" is always present
 * A static sender deny-list short-circuits BEFORE spending tokens.
 */
import { callClaude, firstJson, anthropicConfigured } from "@/lib/anthropic";
import { messageText } from "./email-text";
import type {
  SupportMessageRow,
  ThreadCategory,
  TriageResult,
  UserContext,
} from "./types";

const MODEL = "claude-sonnet-4-6";

const CATEGORIES: ThreadCategory[] = [
  "refund_request",
  "cancel_trial",
  "question",
  "feedback",
  "other",
];

// ---------------------------------------------------------------------------
// Spam / non-user deny-list (checked before the Anthropic call)

const DENY_SENDERS = [
  "mailer-daemon@",
  "postmaster@",
  "noreply@email.apple.com",
  "no_reply@email.apple.com",
  "no-reply@testflight.apple.com",
  "noreply@testflight.apple.com",
  "@tv.apple.com",
  "no-reply@accounts.google.com",
  "noreply@github.com",
  "@linkedin.com",
  "@substack.com",
  "@mailchimp.com",
  "@sendgrid.net",
];

const DENY_SUBJECTS = [
  "delivery status notification",
  "is now available to test",
  "testflight",
  "your invoice",
  "security alert",
];

/** Dan's own addresses — ingested normally but tagged internal. */
const INTERNAL_SENDERS = ["dan@dreamme.life", "dlnguyenn@gmail.com"];

export function isDeniedSender(
  fromEmail: string | null,
  subject: string | null,
): boolean {
  const from = (fromEmail ?? "").toLowerCase();
  const subj = (subject ?? "").toLowerCase();
  if (DENY_SENDERS.some((d) => from.includes(d))) return true;
  if (DENY_SUBJECTS.some((d) => subj.includes(d))) return true;
  return false;
}

export function isInternalSender(fromEmail: string | null): boolean {
  const from = (fromEmail ?? "").toLowerCase();
  return INTERNAL_SENDERS.some((s) => from === s);
}

/**
 * The in-app feedback notifier mails feedback@ → itself with subject
 * "[Bug Report] New feedback from X"; the feedback TABLE leg already
 * ingests the same item, so the email mirror is a duplicate and lands as
 * status 'ignored'. Keyed on the RAW From (the notifier sets Reply-To to
 * the user, so the effective sender is no longer feedback@) and excluding
 * "Re:" so a real user replying on a mirror thread still reopens it.
 * Pure — unit-tested.
 */
export function isFeedbackMirror(
  rawFromEmail: string | null,
  subject: string | null,
): boolean {
  const from = (rawFromEmail ?? "").toLowerCase();
  const subj = (subject ?? "").trim();
  return (
    from === "feedback@dreamme.life" &&
    /new feedback from/i.test(subj) &&
    !/^re:/i.test(subj)
  );
}

// ---------------------------------------------------------------------------
// Draft post-processing guards (pure — unit-testable)

const SIGNOFF = "Dan, co-founder of DreamMe";

/**
 * Warm closers used to rescue an off-brand draft. Chosen per variant so
 * the two drafts don't end identically, and worded to sit correctly after
 * an apology (which is exactly where the model tends to go flat).
 */
const WARM_CLOSERS = [
  "Thanks so much for bearing with me!",
  "Thanks so much for giving DreamMe a try!",
];

/** DreamMe's voice is bubbly: a reply with no exclamation mark is off-brand. */
export function hasEnthusiasm(text: string): boolean {
  return text.includes("!");
}

/**
 * Guarantee the brand voice. The model reliably drops all enthusiasm on
 * refund/apology replies even when the prompt forbids it, so if a draft
 * still arrives flat we add a warm closing line above the sign-off rather
 * than shipping an off-brand reply. Pure — unit-tested.
 */
export function ensureEnthusiasm(text: string, variant = 0): string {
  if (hasEnthusiasm(text)) return text;
  const closer = WARM_CLOSERS[variant % WARM_CLOSERS.length];
  const idx = text.toLowerCase().lastIndexOf(SIGNOFF.toLowerCase());
  if (idx === -1) return `${text.replace(/\s+$/, "")}\n\n${closer}`;
  const bodyPart = text.slice(0, idx).replace(/\s+$/, "");
  const signPart = text.slice(idx);
  return `${bodyPart}\n\n${closer}\n\n${signPart}`;
}

export function cleanDraft(raw: string, variant = 0): string {
  let text = raw.trim();
  // No em/en dashes in Dan-voice email. Spaced dash reads as a pause →
  // comma; unspaced (word—word) → comma+space.
  text = text
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ", ")
    .replace(/,\s*,/g, ",");
  if (!text.toLowerCase().includes(SIGNOFF.toLowerCase())) {
    text = `${text.replace(/\s+$/, "")}\n\n${SIGNOFF}`;
  }
  return ensureEnthusiasm(text, variant);
}

// ---------------------------------------------------------------------------

function describeUser(ctx: UserContext | null): string {
  if (!ctx || (ctx.noAccount && ctx.subscriptions.length === 0)) {
    return "No DreamMe account was found for this email address.";
  }
  if (ctx.noAccount) {
    // Stripe-search fallback: billing identity found, app account not.
    const subs = ctx.subscriptions
      .map(
        (s) =>
          `- STRIPE (web checkout) · ${s.isActive ? "ACTIVE" : "cancelled/inactive"}${s.isTrial ? " (TRIAL)" : ""}${s.expiresAt ? `, period ends ${s.expiresAt.slice(0, 10)}` : ""}`,
      )
      .join("\n");
    return [
      `No DreamMe app account matched this email, but Stripe DOES have a billing record for it (they subscribed via the website). Paid $${ctx.totalSpentUsd.toFixed(2)} total.`,
      `Subscriptions:\n${subs}`,
      "Dan CAN cancel/refund these directly. Note: $0.00 paid + inactive usually means their card was never successfully charged (failed payment), which is worth saying plainly if they're worried about a charge.",
    ].join("\n");
  }
  const subs = ctx.subscriptions
    .map((s) => {
      const state = s.isActive ? "ACTIVE" : "expired/inactive";
      const kind = s.isTrial
        ? `on TRIAL${s.plan ? ` of the ${s.plan} plan` : ""}`
        : `PAID ${s.plan ?? "unknown"} plan`;
      const exp = s.expiresAt ? `, ${s.isActive ? "renews/expires" : "expired"} ${s.expiresAt.slice(0, 10)}` : "";
      const since = s.startedAt ? `, subscriber since ${s.startedAt.slice(0, 10)}` : "";
      const renew =
        s.autoRenew === false && s.isActive ? ", auto-renew already OFF (cancelled, will lapse)" : "";
      return `- ${s.store} · ${kind} · ${state}${exp}${since}${renew} · paid $${s.totalPaidUsd.toFixed(2)} total`;
    })
    .join("\n");
  const age = ctx.accountCreatedAt
    ? ` Account created ${ctx.accountCreatedAt.slice(0, 10)}.`
    : "";
  return [
    `Account: ${ctx.name ?? "unnamed"} <${ctx.email ?? "?"}>, journey stage: ${ctx.journeyStage ?? "unknown"}.${age}`,
    ctx.subscriptions.length
      ? `Subscriptions:\n${subs}`
      : "No subscriptions on record.",
    ctx.sandboxOnly ? "NOTE: only sandbox purchases found (likely a tester)." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function storeGuidance(ctx: UserContext | null): string {
  const store = ctx?.subscriptions[0]?.store;
  if (store === "APP_STORE") {
    return `This user subscribed through Apple. Dan CANNOT cancel or refund Apple subscriptions himself. For cancel: Settings app > tap their name > Subscriptions > DreamMe > Cancel. For refunds they must use https://reportaproblem.apple.com and Apple decides. Drafts should explain the relevant steps warmly and apologize for the extra hoop.`;
  }
  if (store === "PLAY_STORE") {
    return `This user subscribed through Google Play. For cancel: Play Store app > profile > Payments & subscriptions > Subscriptions > DreamMe > Cancel. Dan CAN issue a refund from his side, so a refund draft can say the refund has been issued (Dan will click the refund button before sending).`;
  }
  if (store === "STRIPE") {
    return `This user subscribed via the website (Stripe). Dan CAN cancel the subscription and issue refunds directly, so drafts can say it has been taken care of (Dan will execute the action before sending).`;
  }
  return `Unknown store. If they ask about cancelling or refunds, ask which platform they subscribed on (App Store, Google Play, or the website) or explain the Apple/Google/website options briefly.`;
}

export async function triageThread(params: {
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  source: "email" | "feedback";
  messages: Pick<
    SupportMessageRow,
    "direction" | "body_text" | "body_html" | "sent_at"
  >[];
  userContext: UserContext | null;
}): Promise<{ triage: TriageResult; drafts: string[] }> {
  const internal = isInternalSender(params.fromEmail);

  if (isDeniedSender(params.fromEmail, params.subject)) {
    return {
      triage: {
        is_spam: true,
        classification: "other",
        urgency: "low",
        summary: "Automated / vendor mail (deny-list match)",
        internal,
        triaged_at: new Date().toISOString(),
      },
      drafts: [],
    };
  }
  if (!anthropicConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const history = params.messages
    .slice(-10)
    .map((m) => {
      const who = m.direction === "inbound" ? "USER" : "DAN";
      // Fall back to HTML-derived text: Apple Mail replies are often
      // HTML-only, and rows ingested before that fix have body_text null.
      const body = messageText(m.body_text, m.body_html).slice(0, 4000);
      return `[${who} · ${m.sent_at.slice(0, 16)}]\n${body}`;
    })
    .join("\n\n---\n\n")
    .slice(0, 20_000);

  const system = `You triage customer support for DreamMe, a GLP-1 weight-loss companion iOS/Android app with a subscription (7-day free trial). You classify the conversation and write TWO alternative reply drafts in the voice of Dan, the co-founder.

DreamMe's brand voice is BUBBLY, warm and genuinely enthusiastic. Write like a happy human who is glad to help, never like a support desk.

Dan's voice rules (strict):
- Be upbeat and use exclamation marks naturally, usually 1-3 per reply (the greeting, the "that's it!", the thank you). A reply with zero exclamation marks is off-brand.
- Never aim that energy AT someone's problem. No exclamation mark on an apology or on bad news ("Sorry you were charged twice!" reads as flippant). Be sincere and warm there, and put the brightness in the help, the reassurance, and the thanks.
- This still applies when someone is upset or owed a refund: apologise plainly, then close warm and bright ("Thanks so much for bearing with me!"). EVERY reply ends up with at least one exclamation mark somewhere. Zero is always wrong.
- Plain, conversational, short sentences. No corporate speak, no "we apologize for any inconvenience".
- Thank people warmly and let them feel like a person: we are a tiny team and it genuinely means a lot.
- NEVER use em dashes or en dashes.
- Sign off exactly: "${SIGNOFF}"
- Keep replies short: 2-6 sentences before the sign-off in most cases.
- Never promise features or timelines. Never give medical advice; suggest talking to their provider for dosing/medical questions.
- If the user asked a how-to question, answer it concretely.
- The two drafts should be genuinely different takes (e.g. one short and punchy, one that explains a little more), not paraphrases. BOTH must sound bubbly and upbeat, neither is the "flat" option.

This is the target voice, match this energy:
"Hi Jo! Great news, I've gone ahead and cancelled your trial, so you won't be charged on July 31. Thanks so much for giving DreamMe a try, and if you ever fancy jumping back in you are always welcome!"

Output STRICTLY JSON:
{"is_spam": boolean, "classification": "refund_request"|"cancel_trial"|"question"|"feedback"|"other", "urgency": "low"|"normal"|"high", "summary": string, "drafts": [string, string]}
"summary" is one line for Dan's queue. If is_spam is true (vendor pitch, newsletter, automated notification, obvious bot), set drafts to [].
IMPORTANT: an email whose body quotes our own billing/trial notification ("Your DreamMe free trial ends…", from billing@dreamme.life) is a REAL customer replying to that notification, never spam — even a one-line "please cancel my subscription" above the quote. Those emails invite replies ("a real person will help").`;

  const user = `SOURCE: ${params.source === "feedback" ? "in-app feedback form" : "email to help@dreamme.life"}
FROM: ${params.fromName ?? ""} <${params.fromEmail ?? "unknown"}>
SUBJECT: ${params.subject ?? "(none)"}

ACCOUNT CONTEXT:
${describeUser(params.userContext)}

PLATFORM GUIDANCE FOR CANCEL/REFUND ASKS:
${storeGuidance(params.userContext)}

CONVERSATION (oldest first):
${history || "(no body)"}

Classify and draft two replies now.`;

  type TriageJson = {
    is_spam?: unknown;
    classification?: unknown;
    urgency?: unknown;
    summary?: unknown;
    drafts?: unknown;
  };
  const ask = async (extra?: string): Promise<TriageJson> => {
    const raw = await callClaude({
      model: MODEL,
      system,
      content: [{ type: "text", text: extra ? `${user}\n\n${extra}` : user }],
      maxTokens: 2000,
    });
    return firstJson(raw) as TriageJson;
  };

  let parsed = await ask();

  // The model reliably strips ALL enthusiasm from refund/apology replies,
  // even though the prompt forbids that. Give it one corrective pass
  // before falling back to the mechanical closer in cleanDraft().
  const flat = (p: TriageJson) =>
    p.is_spam !== true &&
    Array.isArray(p.drafts) &&
    p.drafts.some((d) => typeof d === "string" && !hasEnthusiasm(d));
  if (flat(parsed)) {
    parsed = await ask(
      "REWRITE: at least one of those drafts had no exclamation mark, which is off-brand for DreamMe. Keep the apology sincere and exclamation-free, but make sure every draft ends on a warm, bright note that uses one. Return the same JSON shape.",
    ).catch(() => parsed);
  }

  const classification = CATEGORIES.includes(parsed.classification as ThreadCategory)
    ? (parsed.classification as ThreadCategory)
    : "other";
  const urgency =
    parsed.urgency === "low" || parsed.urgency === "high"
      ? parsed.urgency
      : "normal";
  const isSpam = parsed.is_spam === true;
  const drafts = isSpam
    ? []
    : (Array.isArray(parsed.drafts) ? parsed.drafts : [])
        .filter((d): d is string => typeof d === "string" && !!d.trim())
        .slice(0, 2)
        .map((d, i) => cleanDraft(d, i));

  return {
    triage: {
      is_spam: isSpam,
      classification,
      urgency,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "(no summary)",
      internal,
      model: MODEL,
      triaged_at: new Date().toISOString(),
    },
    drafts,
  };
}
