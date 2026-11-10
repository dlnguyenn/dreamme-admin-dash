/**
 * Trial emails: the copy and the design. Written as Dan (co-founder), bubbly
 * with "!", never exclaiming at a problem, no em dashes. Approved draft + the
 * five changes from the vault best-practice check (wiki/trial-email-test.md):
 * Sushi image, CTA twice, the user's fish name, a status-aware version for
 * trialists who already turned auto-renew off, and the CTA swapping to the
 * next action not yet done.
 *
 * Design (2026-11-10 rework, Dan: "looks amateur on the phone"): modelled on
 * real welcome emails (Duolingo: mascot first, one ask, one big button;
 * Strava: brand header, colour hero, numbered steps; Calm: white cards on a
 * tinted page) in DreamMe's brand palette (DreamMe_Brand_Guidelines.pdf:
 * Ocean Sky backgrounds, Deep Sea buttons with Seafoam White text, Midnight
 * Depth text, Coral Bloom for progress). Headlines use Jellee (the store
 * listing face) where the mail app loads web fonts (Apple Mail), system bold
 * elsewhere. Table layout and inline styles only, so Gmail keeps it.
 *
 * In-app paths quoted in the copy were checked against davngu28/DreamMe
 * origin/main 00eea3b: the "+" button (FloatingActionButton) opens the action
 * menu with "Log a Shot", "Log Side Effect" and "Log Weight"; the home screen
 * shows a "Set up your shot schedule" card with a "Set schedule" button
 * (ShotDayCard) until a schedule exists.
 */
import type { Cta, EmailKind, Platform } from "./core";

export interface EmailAssets {
  /** animated hero art (right half of the banner): waving Sushi for day 0, heart Sushi for day 1 */
  heroDay0: string;
  heroDay1: string;
  icon: string;
  /** Jellee .ttf; Apple Mail loads it, Gmail ignores it */
  font: string;
}

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
  assets: EmailAssets;
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

/** The in-app steps, shown as a numbered list. */
function steps(cta: Cta): string[] {
  switch (cta) {
    case "shot":
      return ["Open DreamMe", "Tap the + button", "Tap Log a Shot"];
    case "shot_day":
      return ["Open DreamMe", `Find "Set up your shot schedule" on your home screen`, "Tap Set schedule"];
    case "side_effect":
      return ["Open DreamMe", "Tap the + button", "Tap Log Side Effect"];
    case "weight":
      return ["Open DreamMe", "Tap the + button", "Tap Log Weight"];
  }
}

const STEPS_TITLE: Record<Cta, string> = {
  shot: "Takes about 30 seconds",
  shot_day: "Takes about 30 seconds",
  side_effect: "Takes about 20 seconds",
  weight: "Takes about 20 seconds",
};

/** The ask: the bold action and why it matters (the how is in the steps). */
function ask(cta: Cta, fish: string, kind: EmailKind): { action: string; why: string } {
  switch (cta) {
    case "shot":
      return {
        action: "log your most recent shot.",
        why: ` It's what lets ${fish} keep your shot schedule, remind you on shot day and line up how you feel with where you are in your week.`,
      };
    case "shot_day":
      return {
        action: `tell ${fish} when your first shot is.`,
        why: " Then when shot day comes, your reminder, your checklist and a place to log how you feel are all ready and waiting.",
      };
    case "side_effect":
      return kind === "day1"
        ? {
            action: "take 20 seconds to log it.",
            why: " After a few check-ins you start to see your own pattern (which days after your shot feel rough and which feel easy), and that's something you can plan around and show your doctor.",
          }
        : {
            action: "log how you feel today.",
            why: " Nausea, low appetite, tired, or nothing at all. After a few check-ins you start to see your own pattern.",
          };
    case "weight":
      return {
        action: "log your weight today.",
        why: " It becomes your starting point, so every weigh-in after this has something to compare against.",
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

/** The big line under Sushi and the one under it. */
function heroFor(i: EmailInput): { title: string; sub: string } {
  const named = i.firstName !== "there";
  if (i.cancelled) return { title: "Your free week is still on!", sub: "Here's how to make the most of it." };
  if (i.kind === "day0") {
    return {
      title: named ? `Welcome to DreamMe, ${i.firstName}!` : "Welcome to DreamMe!",
      sub: "Your free trial is on. Here's the one thing to do today.",
    };
  }
  if (i.cta === "side_effect") return { title: "How are you feeling today?", sub: "A 20-second check-in helps the rest of your week make sense." };
  return { title: `Day 2 with ${i.fish}`, sub: "One quick thing today and you're all set." };
}

type Note = { tone: "info" | "good"; title: string; body: string };

interface Body {
  intro: Para[];
  askPara: Para;
  note?: Note; // the trial-date or no-charge panel
  after: Para[];
  week?: { when: string; what: string }[];
  closing: Para[];
  signoff: string;
}

function bodyFor(i: EmailInput): Body {
  const store = STORE[i.platform];
  const a = ask(i.cta, i.fish, i.kind);
  const done = doneNote(i.kind, i.cta);
  const reply: Para = ["Stuck on anything? Just reply to this email. I read every reply myself."];
  const noCharge: Note = {
    tone: "good",
    title: "You won't be charged",
    body: `Your trial is set not to renew, and you still have everything until ${i.trialEnd}. If DreamMe earns a spot in your week, you can turn it back on in your ${store} subscriptions before then, and everything you've logged stays put.`,
  };

  if (i.kind === "day0") {
    const intro: Para[] = [
      ["Dan here, co-founder of DreamMe. Thank you so much for giving us a try!"],
    ];
    const lead = i.cancelled
      ? "Since the week is yours anyway, here's the one thing I'd do with it: "
      : "If you only do one thing today, make it this: ";
    const askPara: Para = [...(done ? [`${done} `] : []), lead, { b: a.action }, a.why];
    const note: Note = i.cancelled
      ? noCharge
      : {
          tone: "info",
          title: `Free until ${i.trialEnd}`,
          body: `Nothing is charged before then, and you can cancel any time in your ${store} subscriptions.`,
        };
    return { intro, askPara, note, after: [reply], closing: [], signoff: "Talk soon!" };
  }

  // day 1
  const intro: Para[] = [["Quick one from me today!"]];
  const askPara: Para =
    i.cta === "side_effect"
      ? ["Nausea, low appetite, tired, or nothing at all, ", { b: a.action }, a.why]
      : [`${done ?? ""} The one thing left that makes ${i.fish} really useful: `.trimStart(), { b: a.action }, a.why];
  const after: Para[] = [];
  if (i.aboutToStart && i.cta === "side_effect") {
    after.push([`Haven't had your first shot yet? Log how you feel today anyway. It gives you a "before" to compare against.`]);
  }
  const week = [
    { when: "Today", what: TODAY[i.cta] },
    { when: "Shot day", what: `log your shot and ${i.fish} keeps your schedule` },
    { when: "Any day", what: "snap a photo of a meal to see your protein" },
    { when: i.trialEnd, what: i.cancelled ? "your free week ends (no charge)" : "your free trial ends" },
  ];
  const closing: Para[] = [
    [`"Is this normal?" is the question we hear most. If you're wondering about anything at all, reply to this email and I'll get back to you myself.`],
  ];
  return { intro, askPara, note: i.cancelled ? noCharge : undefined, after, week, closing, signoff: "" };
}

// ---------------------------------------------------------------- render --

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Brand palette (DreamMe_Brand_Guidelines.pdf). Email clients don't support
// CSS variables, so these are literal on purpose.
const C = {
  page: "#F0FAFF", // Seafoam White
  hero: "#B8E4F0", // Ocean Sky
  card: "#FFFFFF",
  ink: "#1A3550", // Midnight Depth
  ink2: "#3E5A74", // Midnight Depth, lighter, for secondary text (5.9:1 on white)
  cta: "#2D5F8A", // Deep Sea
  ctaText: "#F0FAFF",
  coral: "#F4826A", // Coral Bloom (progress)
  panel: "#EAF6FB", // Ocean Sky, light
  good: "#E4F3EA", // Sea Kelp, light
  goodInk: "#25603E", // Sea Kelp, dark
};
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const DISPLAY = `'Jellee', ${SANS}`;
const P = `margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink};`;

function paraHtml(p: Para, style = P): string {
  const inner = p.map((r) => (typeof r === "string" ? esc(r) : `<strong>${esc(r.b)}</strong>`)).join("");
  return `<p style="${style}">${inner}</p>`;
}
const paraText = (p: Para) => p.map((r) => (typeof r === "string" ? r : r.b)).join("");

function buttonHtml(label: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td align="center" bgcolor="${C.cta}" style="border-radius:14px;background:${C.cta};">
<a href="${esc(url)}" style="display:block;padding:16px 20px;font-family:${SANS};font-size:17px;font-weight:700;line-height:22px;color:${C.ctaText};text-decoration:none;border-radius:14px;">${esc(label)}</a>
</td></tr></table>`;
}

function stepsHtml(title: string, items: string[]): string {
  const rows = items
    .map(
      (t, n) => `<tr>
<td width="28" valign="top" style="padding:0 12px 12px 0;">
<div style="width:28px;height:28px;border-radius:14px;background:${C.coral};color:#FFFFFF;font-family:${SANS};font-size:14px;font-weight:700;line-height:28px;text-align:center;">${n + 1}</div>
</td>
<td valign="top" style="padding:3px 0 12px;font-family:${SANS};font-size:16px;line-height:22px;color:${C.ink};">${esc(t)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;background:${C.panel};border-radius:16px;"><tr><td style="padding:18px 18px 6px;">
<p style="margin:0 0 14px;font-family:${SANS};font-size:13px;font-weight:700;line-height:18px;color:${C.ink2};">${esc(title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr></table>`;
}

function noteHtml(n: Note): string {
  const bg = n.tone === "good" ? C.good : C.panel;
  const ink = n.tone === "good" ? C.goodInk : C.ink;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background:${bg};border-radius:16px;"><tr><td style="padding:16px 18px;">
<p style="margin:0 0 4px;font-family:${SANS};font-size:16px;font-weight:700;line-height:22px;color:${ink};">${esc(n.title)}</p>
<p style="margin:0;font-family:${SANS};font-size:15px;line-height:22px;color:${ink};">${esc(n.body)}</p>
</td></tr></table>`;
}

function weekHtml(items: { when: string; what: string }[]): string {
  const rows = items
    .map(
      (x, n) => `<tr>
<td width="12" valign="top" style="padding:7px 12px 0 0;"><div style="width:10px;height:10px;border-radius:5px;background:${n === 0 ? C.coral : C.hero};"></div></td>
<td valign="top" style="padding:0 0 12px;font-family:${SANS};font-size:16px;line-height:22px;color:${C.ink};"><strong>${esc(x.when)}</strong><br>${esc(
        x.what.charAt(0).toUpperCase() + x.what.slice(1),
      )}</td>
</tr>`,
    )
    .join("");
  return `<p style="${P}margin-bottom:12px;font-weight:700;">Here's the rest of your free week</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">${rows}</table>`;
}

export function renderEmail(i: EmailInput): RenderedEmail {
  const { subject, preview } = subjectFor(i);
  const hero = heroFor(i);
  const b = bodyFor(i);
  const button = BUTTON[i.cta];
  const greeting = `Hi ${i.firstName}!`;
  const a = i.assets;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<style>
@font-face{font-family:'Jellee';src:url('${esc(a.font)}') format('truetype');font-weight:400;font-style:normal;}
:root{color-scheme:light only;supported-color-schemes:light only;}
@media (max-width:480px){.outer{padding:12px 10px 28px !important}.pad{padding-left:20px !important;padding-right:20px !important}.title{font-size:22px !important;line-height:26px !important}.herotext{padding:14px 4px 14px 20px !important}}
</style></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preview)}&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" class="outer" style="padding:20px 16px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

<tr><td align="center" style="padding:4px 0 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px;"><img src="${esc(a.icon)}" width="36" height="36" alt="" style="display:block;border:0;width:36px;height:36px;border-radius:9px;"></td>
<td valign="middle" style="font-family:${DISPLAY};font-size:22px;line-height:36px;color:${C.ink};">DreamMe</td>
</tr></table>
</td></tr>

<tr><td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>
<td width="54%" valign="middle" bgcolor="${C.hero}" class="herotext" style="width:54%;background:${C.hero};border-radius:24px 0 0 0;padding:20px 8px 20px 26px;">
<h1 class="title" style="margin:0;font-family:${DISPLAY};font-size:28px;line-height:33px;font-weight:400;color:${C.ink};">${esc(hero.title)}</h1>
</td>
<td width="46%" valign="bottom" bgcolor="${C.hero}" style="width:46%;background:${C.hero};border-radius:0 24px 0 0;padding:0;line-height:0;font-size:0;">
<img src="${esc(i.kind === "day0" ? a.heroDay0 : a.heroDay1)}" width="240" alt="${esc(i.fish)}, the DreamMe fish, ${i.kind === "day0" ? "waving hello" : "holding a heart"}" style="display:block;border:0;width:100%;max-width:240px;height:auto;margin-left:auto;">
</td>
</tr></table>
</td></tr>

<tr><td bgcolor="${C.card}" class="pad" style="background:${C.card};border-radius:0 0 24px 24px;padding:26px 28px 8px;">
${paraHtml([greeting])}
${b.intro.map((p) => paraHtml(p)).join("\n")}
${paraHtml(b.askPara)}
${stepsHtml(STEPS_TITLE[i.cta], steps(i.cta))}
${buttonHtml(button, i.ctaUrl)}
${b.note ? noteHtml(b.note) : ""}
${b.after.map((p) => paraHtml(p)).join("\n")}
${b.week ? weekHtml(b.week) : ""}
${b.closing.map((p) => paraHtml(p)).join("\n")}
${b.signoff ? paraHtml([b.signoff]) : ""}
<p style="margin:0 0 4px;font-family:${SANS};font-size:16px;line-height:22px;font-weight:700;color:${C.ink};">Dan</p>
<p style="margin:0 0 20px;font-family:${SANS};font-size:15px;line-height:20px;color:${C.ink2};">Co-founder, DreamMe</p>
<p style="margin:0 0 24px;font-family:${SANS};font-size:15px;line-height:22px;color:${C.ink};">P.S. Here's that link again: <a href="${esc(i.ctaUrl)}" style="color:${C.cta};font-weight:700;text-decoration:underline;">${esc(button)}</a></p>
</td></tr>

<tr><td align="center" style="padding:22px 12px 0;">
<p style="margin:0 0 6px;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink2};">DreamMe, your GLP-1 companion</p>
<p style="margin:0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink2};">You're getting this because you started a DreamMe free trial.<br><a href="${esc(i.unsubscribeUrl)}" style="color:${C.ink2};text-decoration:underline;">Unsubscribe</a></p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  const lines: string[] = [hero.title, hero.sub, "", greeting, "", ...b.intro.flatMap((p) => [paraText(p), ""]), paraText(b.askPara), ""];
  lines.push(`${STEPS_TITLE[i.cta]}:`, ...steps(i.cta).map((s, n) => `${n + 1}. ${s}`), "", `${button}: ${i.ctaUrl}`, "");
  if (b.note) lines.push(b.note.title, b.note.body, "");
  for (const p of b.after) lines.push(paraText(p), "");
  if (b.week) {
    lines.push("Here's the rest of your free week:");
    for (const x of b.week) lines.push(`- ${x.when}: ${x.what}`);
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
