/**
 * Trial emails — the copy. Written as Dan (co-founder), bubbly with "!", never
 * exclaiming at a problem, no em dashes. Approved draft + the five changes from
 * the vault best-practice check (wiki/trial-email-test.md): Sushi image, CTA
 * twice, the user's fish name, a status-aware version for trialists who already
 * turned auto-renew off, and the CTA swapping to the next action not yet done.
 *
 * In-app paths quoted in the copy were checked against davngu28/DreamMe
 * origin/main 00eea3b: the "+" button (FloatingActionButton) opens the action
 * menu with "Log a Shot", "Log Side Effect" and "Log Weight"; the home screen
 * shows a "Set up your shot schedule" card with a "Set schedule" button
 * (ShotDayCard) until a schedule exists.
 */
import type { Cta, EmailKind, Platform } from "./core";

export interface EmailInput {
  kind: EmailKind;
  cta: Cta;
  /** auto-renew already off: the status-aware version */
  cancelled: boolean;
  aboutToStart: boolean;
  firstName: string; // "there" when unknown
  fish: string; // "Sushi" unless renamed
  trialEnd: string; // "Tuesday, Nov 17"
  platform: Platform;
  ctaUrl: string;
  unsubscribeUrl: string;
  imageUrl: string;
}

export interface RenderedEmail {
  subject: string;
  preview: string;
  html: string;
  text: string;
}

/** A paragraph: plain strings and bold runs. */
type Run = string | { b: string };
type Para = Run[];

const STORE: Record<Platform, string> = { ios: "Apple", android: "Google Play" };

const BUTTON: Record<Cta, string> = {
  shot: "Log my shot",
  shot_day: "Set my shot day",
  side_effect: "Log how I feel",
  weight: "Log my weight",
};

const TODAY: Record<Cta, string> = {
  shot: "log your most recent shot",
  shot_day: "set your shot day",
  side_effect: `a quick "how I feel" check-in`,
  weight: "log your weight",
};

/** The ask itself: bold action, how to do it in the app, why it matters. */
function ask(cta: Cta, fish: string, kind: EmailKind): { action: string; rest: string } {
  switch (cta) {
    case "shot":
      return {
        action: "log your most recent shot.",
        rest: ` It takes about 30 seconds (tap the + button, then Log a Shot), and it's what lets ${fish} keep your shot schedule, remind you on shot day and line up how you feel with where you are in your week.`,
      };
    case "shot_day":
      return {
        action: `tell ${fish} when your first shot is.`,
        rest: ` On your home screen, tap Set schedule on the "Set up your shot schedule" card. Then when shot day comes, your reminder, your checklist and a place to log how you feel are all ready and waiting.`,
      };
    case "side_effect":
      return kind === "day1"
        ? {
            action: "take 20 seconds to log it.",
            rest: " Tap the + button, then Log Side Effect. After a few check-ins you start to see your own pattern (which days after your shot feel rough and which feel easy), and that's something you can plan around and show your doctor.",
          }
        : {
            action: "log how you feel today.",
            rest: " Tap the + button, then Log Side Effect. Nausea, low appetite, tired, or nothing at all, it takes about 20 seconds, and after a few check-ins you start to see your own pattern.",
          };
    case "weight":
      return {
        action: "log your weight today.",
        rest: " Tap the + button, then Log Weight. It becomes your starting point, so every weigh-in after this has something to compare against.",
      };
  }
}

/** Short acknowledgement when the usual first ask is already done. */
function doneNote(kind: EmailKind, cta: Cta): string | null {
  if (kind === "day0" && cta === "side_effect") return "I see you've already logged your shot, nice work!";
  if (kind === "day0" && cta === "weight") return "I see you've already logged your shot and how you feel, nice work!";
  if (kind === "day1" && (cta === "shot" || cta === "shot_day")) return "I see you've already logged how you feel, nice work!";
  if (kind === "day1" && cta === "weight") return "I see you've already logged your shot and how you feel, nice work!";
  return null;
}

function subjectFor(i: EmailInput): { subject: string; preview: string } {
  const named = i.firstName !== "there";
  if (i.cancelled) {
    return {
      subject: named ? `Your free week is still on, ${i.firstName}!` : "Your free week is still on!",
      preview: `You won't be charged. Here's one quick thing to try before ${i.trialEnd}.`,
    };
  }
  if (i.kind === "day0") {
    return {
      subject: `Your first step with ${i.fish} (30 seconds!)`,
      preview: "One quick thing to do today, plus the exact date your free trial ends.",
    };
  }
  if (i.cta === "side_effect") {
    return {
      subject: named ? `How are you feeling today, ${i.firstName}?` : "How are you feeling today?",
      preview: "A quick check-in today helps the rest of your week make sense.",
    };
  }
  return {
    subject: `Day 2 with ${i.fish}: a 20-second check-in`,
    preview: "One quick thing today helps the rest of your week make sense.",
  };
}

interface Body {
  intro: Para[];
  askPara: Para;
  after: Para[];
  list?: { title: string; items: string[] };
  closing: Para[];
  signoff: string;
}

function bodyFor(i: EmailInput): Body {
  const store = STORE[i.platform];
  const a = ask(i.cta, i.fish, i.kind);
  const note = doneNote(i.kind, i.cta);
  const reply: Para = ["Stuck on anything? Just reply to this email. I read every reply myself."];
  const turnBackOn: Para = [
    `If DreamMe earns a spot in your week, you can turn your subscription back on in your ${store} subscriptions any time before ${i.trialEnd}, and everything you've logged stays put.`,
  ];

  if (i.kind === "day0") {
    const intro: Para[] = i.cancelled
      ? [
          ["Dan here, co-founder of DreamMe. Thank you for giving us a try!"],
          [
            "Quick note so there's nothing to wonder about: your trial is set not to renew, so ",
            { b: "you won't be charged" },
            `. You still have everything until ${i.trialEnd}.`,
          ],
        ]
      : [["Dan here, co-founder of DreamMe. Welcome, and thank you for giving us a try!"]];
    const lead = i.cancelled
      ? "Since the week is yours anyway, here's the one thing I'd do with it: "
      : "If you only do one thing today, make it this: ";
    const askPara: Para = [...(note ? [`${note} `] : []), lead, { b: a.action }, a.rest];
    const after: Para[] = i.cancelled
      ? [turnBackOn, reply]
      : [
          [
            `Your trial is free until ${i.trialEnd}. Nothing is charged before then, and you can cancel any time in your ${store} subscriptions.`,
          ],
          reply,
        ];
    return { intro, askPara, after, closing: [], signoff: "Talk soon!" };
  }

  // day 1
  const intro: Para[] = [
    [i.cta === "side_effect" ? "Quick one from me today: how are you feeling?" : "Quick one from me today!"],
  ];
  if (i.cancelled) {
    intro.push([
      "(And just so you know, your trial is set not to renew, so ",
      { b: "you won't be charged" },
      `. Everything stays open until ${i.trialEnd}.)`,
    ]);
  }
  let askPara: Para;
  if (i.cta === "side_effect") {
    askPara = ["Nausea, low appetite, tired, or nothing at all, ", { b: a.action }, a.rest];
  } else {
    askPara = [`${note ?? ""} The one thing left that makes ${i.fish} really useful: `.trimStart(), { b: a.action }, a.rest];
  }
  const after: Para[] = [];
  if (i.aboutToStart && i.cta === "side_effect") {
    after.push([`Haven't had your first shot yet? Log how you feel today anyway. It gives you a "before" to compare against.`]);
  }
  const list = {
    title: "Here's the rest of your free week:",
    items: [
      `Today: ${TODAY[i.cta]}`,
      `Shot day: log your shot and ${i.fish} keeps your schedule`,
      "Any day: snap a photo of a meal to see your protein",
      i.cancelled ? `${i.trialEnd}: your free week ends (no charge)` : `${i.trialEnd}: your free trial ends`,
    ],
  };
  const closing: Para[] = [];
  if (i.cancelled) closing.push(turnBackOn);
  closing.push([
    `"Is this normal?" is the question we hear most. If you're wondering about anything at all, reply to this email and I'll get back to you myself.`,
  ]);
  return { intro, askPara, after, list, closing, signoff: "" };
}

// ---------------------------------------------------------------- render --

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INK = "#1A3550"; // Midnight Depth (brand)
const INK_2 = "#4A5B6E";
const BUTTON_BG = "#1A3550";
const PAGE = "#FFFFFF";
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

function paraHtml(p: Para): string {
  const inner = p.map((r) => (typeof r === "string" ? esc(r) : `<strong>${esc(r.b)}</strong>`)).join("");
  return `<p style="margin:0 0 16px;font:400 16px/1.55 ${FONT};color:${INK};">${inner}</p>`;
}
const paraText = (p: Para) => p.map((r) => (typeof r === "string" ? r : r.b)).join("");

export function renderEmail(i: EmailInput): RenderedEmail {
  const { subject, preview } = subjectFor(i);
  const b = bodyFor(i);
  const button = BUTTON[i.cta];
  const greeting = `Hi ${i.firstName}!`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td>
<p style="margin:0 0 16px;font:400 16px/1.55 ${FONT};color:${INK};">${esc(greeting)}</p>
${b.intro.map(paraHtml).join("\n")}
<img src="${esc(i.imageUrl)}" width="96" height="94" alt="${esc(i.fish)} waving hello" style="display:block;margin:4px 0 16px;border:0;width:96px;height:auto;">
${paraHtml(b.askPara)}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="border-radius:12px;background:${BUTTON_BG};">
<a href="${esc(i.ctaUrl)}" style="display:inline-block;padding:14px 26px;font:600 16px ${FONT};color:#FFFFFF;text-decoration:none;border-radius:12px;">${esc(button)}</a>
</td></tr></table>
${b.after.map(paraHtml).join("\n")}
${
  b.list
    ? `<p style="margin:0 0 8px;font:400 16px/1.55 ${FONT};color:${INK};">${esc(b.list.title)}</p>
<ul style="margin:0 0 16px;padding-left:22px;font:400 16px/1.55 ${FONT};color:${INK};">${b.list.items
        .map((x) => `<li style="margin:0 0 4px;">${esc(x)}</li>`)
        .join("")}</ul>`
    : ""
}
${b.closing.map(paraHtml).join("\n")}
${b.signoff ? `<p style="margin:0 0 16px;font:400 16px/1.55 ${FONT};color:${INK};">${esc(b.signoff)}</p>` : ""}
<p style="margin:0 0 24px;font:400 16px/1.55 ${FONT};color:${INK};">Dan<br>Co-founder, DreamMe</p>
<p style="margin:0 0 32px;font:400 15px/1.55 ${FONT};color:${INK};">P.S. Here's that link again: <a href="${esc(i.ctaUrl)}" style="color:${INK};font-weight:600;">${esc(button)}</a></p>
<p style="margin:0;font:400 12px/1.5 ${FONT};color:${INK_2};">You're getting this because you started a DreamMe free trial. <a href="${esc(i.unsubscribeUrl)}" style="color:${INK_2};">Unsubscribe</a></p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const lines: string[] = [greeting, "", ...b.intro.flatMap((p) => [paraText(p), ""]), paraText(b.askPara), "", `${button}: ${i.ctaUrl}`, ""];
  for (const p of b.after) lines.push(paraText(p), "");
  if (b.list) {
    lines.push(b.list.title);
    for (const x of b.list.items) lines.push(`- ${x}`);
    lines.push("");
  }
  for (const p of b.closing) lines.push(paraText(p), "");
  if (b.signoff) lines.push(b.signoff, "");
  lines.push("Dan", "Co-founder, DreamMe", "", `P.S. Here's that link again: ${i.ctaUrl}`, "", "--", `You're getting this because you started a DreamMe free trial. Unsubscribe: ${i.unsubscribeUrl}`);

  return { subject, preview, html, text: lines.join("\n") };
}

/** Every combination, for previews and the all-variants test send. */
export function allVariants(): { kind: EmailKind; cta: Cta; cancelled: boolean; aboutToStart: boolean; label: string }[] {
  const out: { kind: EmailKind; cta: Cta; cancelled: boolean; aboutToStart: boolean; label: string }[] = [];
  const combos: [EmailKind, Cta, boolean][] = [
    ["day0", "shot", false],
    ["day0", "shot_day", true],
    ["day0", "side_effect", false],
    ["day1", "side_effect", false],
    ["day1", "side_effect", true],
    ["day1", "shot", false],
  ];
  for (const [kind, cta, aboutToStart] of combos) {
    for (const cancelled of [false, true]) {
      out.push({
        kind,
        cta,
        cancelled,
        aboutToStart,
        label: `${kind === "day0" ? "Day 0" : "Day 1"}, ${BUTTON[cta].toLowerCase()}${aboutToStart ? ", about to start" : ""}${cancelled ? ", auto-renew off" : ""}`,
      });
    }
  }
  return out;
}
