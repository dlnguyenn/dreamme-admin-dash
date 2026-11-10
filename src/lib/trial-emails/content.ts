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
 * first Ocean Sky / Deep Sea, then reworked to warm neutrals with Sushi's
 * coral as the one accent after Dan found the blue off). Headlines use Jellee (the store
 * listing face) where the mail app loads web fonts (Apple Mail), system bold
 * elsewhere. Table layout and inline styles only, so Gmail keeps it.
 *
 * In-app paths quoted in the copy were checked against davngu28/DreamMe
 * origin/main 00eea3b: the "+" button (FloatingActionButton) opens the action
 * menu with "Log a Shot", "Log Side Effect" and "Log Weight"; the home screen
 * shows a "Set up your shot schedule" card with a "Set schedule" button
 * (ShotDayCard) until a schedule exists.
 */
import { MOODS, type Cta, type EmailKind, type Mood, type Platform } from "./core";

export interface EmailAssets {
  /** animated hero art (right half of the banner): waving Sushi for day 0, heart Sushi for day 1 */
  heroDay0: string;
  heroDay1: string;
  icon: string;
  /** round Sushi mood tiles for the day-1 "how are you feeling?" row (Live Activity art) */
  moods: Record<Mood, string>;
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
  /** "blue" or "lux"; defaults to LIVE_THEME */
  theme?: EmailTheme;
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

const STEPS_LEAD: Record<Cta, string> = {
  shot: "It takes about 30 seconds:",
  shot_day: "It takes about 30 seconds:",
  side_effect: "It takes about 20 seconds:",
  weight: "It takes about 20 seconds:",
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

/**
 * Two looks on one layout (Dan 2026-11-10: "follow the Impeccable guidelines,
 * give me a blue and a lux version"). Impeccable rules applied: no cards inside
 * the sheet (the old step/mood/trial panels were nested cards), no small label
 * above a block (each became a sentence), colour owns a region (the banner)
 * instead of scattering accents, balanced headline breaks, 4.5:1 body contrast,
 * secondary text tinted from the palette, never plain grey.
 * Email clients don't support CSS variables, so these are literal on purpose.
 */
export type EmailTheme = "blue" | "lux";
export const EMAIL_THEMES: EmailTheme[] = ["blue", "lux"];
/** The look live sends use. Dan picks between the two; lux until he does. */
export const LIVE_THEME: EmailTheme = "lux";

interface Palette {
  page: string;
  hero: string; // must match the hero GIF ground
  heroInk: string;
  sheet: string;
  ink: string;
  ink2: string;
  cta: string;
  ctaText: string;
  /** step-number discs: tinted coral disc, deep coral numeral */
  discBg: string;
  discInk: string;
  dotNow: string;
  dot: string;
}

const THEMES: Record<EmailTheme, Palette> = {
  // Committed: the brand's Deep Sea owns the banner, Seafoam ground, Midnight
  // Depth text, Sushi coral for progress (DreamMe_Brand_Guidelines.pdf).
  // Contrast: heroInk on hero 6.4:1, ink 12.9:1, ink2 6.3:1, discInk on disc 5.2:1.
  blue: {
    page: "#EAF5FA",
    hero: "#2D5F8A",
    heroInk: "#F0FAFF",
    sheet: "#FFFFFF",
    ink: "#1A3550",
    ink2: "#46617A",
    cta: "#2D5F8A",
    ctaText: "#F0FAFF",
    discBg: "#FDE6E0",
    discInk: "#A9452F",
    dotNow: "#E8735C",
    dot: "#B8E4F0",
  },
  // Restrained: warm pearl ground, champagne banner, espresso text and button,
  // Sushi coral as the one accent. Display stays Jellee (not a serif), which
  // keeps it off Impeccable's "cream + serif + terracotta" default look.
  // Contrast: heroInk on hero 11.6:1, ink 14.8:1, ink2 5.9:1, discInk on disc 5.6:1.
  lux: {
    page: "#F4F0EA",
    hero: "#E6DCCF",
    heroInk: "#2E2622",
    sheet: "#FFFFFF",
    ink: "#2E2622",
    ink2: "#6B5E55",
    cta: "#2E2622",
    ctaText: "#FBF7F2",
    discBg: "#F6E3DA",
    discInk: "#97432F",
    dotNow: "#D9705A",
    dot: "#D9CBB8",
  },
};

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const DISPLAY = `'Jellee', ${SANS}`;
const pStyle = (C: Palette) => `margin:0 0 18px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink};`;

function paraHtml(C: Palette, p: Para, extra = ""): string {
  const inner = p.map((r) => (typeof r === "string" ? esc(r) : `<strong>${esc(r.b)}</strong>`)).join("");
  return `<p style="${pStyle(C)}${extra}">${inner}</p>`;
}
const paraText = (p: Para) => p.map((r) => (typeof r === "string" ? r : r.b)).join("");

function buttonHtml(C: Palette, label: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 30px;"><tr>
<td align="center" bgcolor="${C.cta}" style="border-radius:14px;background:${C.cta};">
<a href="${esc(url)}" style="display:block;padding:17px 20px;font-family:${SANS};font-size:17px;font-weight:700;line-height:22px;color:${C.ctaText};text-decoration:none;border-radius:14px;">${esc(label)}</a>
</td></tr></table>`;
}

/** The in-app path as a plain numbered list on the sheet (no panel). */
function stepsHtml(C: Palette, lead: string, items: string[]): string {
  const rows = items
    .map(
      (t, n) => `<tr>
<td width="30" valign="top" style="padding:0 12px 14px 0;">
<div style="width:30px;height:30px;border-radius:15px;background:${C.discBg};color:${C.discInk};font-family:${SANS};font-size:15px;font-weight:700;line-height:30px;text-align:center;">${n + 1}</div>
</td>
<td valign="top" style="padding:4px 0 14px;font-family:${SANS};font-size:16px;line-height:22px;color:${C.ink};">${esc(t)}</td>
</tr>`,
    )
    .join("");
  return `${paraHtml(C, [lead], "margin-bottom:14px;")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;">${rows}</table>`;
}

/** Trial date or no-charge note: a sentence with a bold lead, not a box. */
function noteHtml(C: Palette, n: Note): string {
  return paraHtml(C, [{ b: `${n.title}.` }, ` ${n.body}`]);
}

const MOOD_LABEL: Record<Mood, string> = { great: "Great", okay: "Okay", rough: "Rough", tired: "Tired" };
const moodUrl = (ctaUrl: string, m: Mood) => `${ctaUrl}${ctaUrl.includes("?") ? "&" : "?"}m=${m}`;

/** Headspace-style mood row: four Sushi tiles, each opens the app (and records the tap). */
function moodRowHtml(C: Palette, ctaUrl: string, tiles: Record<Mood, string>): string {
  const cells = MOODS.map(
    (m) => `<td align="center" valign="top" width="25%" style="padding:0 2px;">
<a href="${esc(moodUrl(ctaUrl, m))}" style="text-decoration:none;color:${C.ink};display:block;">
<img src="${esc(tiles[m])}" width="68" height="68" alt="${MOOD_LABEL[m]}" style="display:block;margin:0 auto 8px;border:0;width:68px;height:68px;border-radius:34px;">
<span style="font-family:${SANS};font-size:15px;font-weight:700;line-height:20px;color:${C.ink};">${MOOD_LABEL[m]}</span>
</a></td>`,
  ).join("");
  return `${paraHtml(C, ["Tap how you feel today:"], "margin-bottom:14px;")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;"><tr>${cells}</tr></table>`;
}

function weekHtml(C: Palette, items: { when: string; what: string }[]): string {
  const rows = items
    .map(
      (x, n) => `<tr>
<td width="12" valign="top" style="padding:7px 12px 0 0;"><div style="width:10px;height:10px;border-radius:5px;background:${n === 0 ? C.dotNow : C.dot};"></div></td>
<td valign="top" style="padding:0 0 14px;font-family:${SANS};font-size:16px;line-height:22px;color:${C.ink};"><strong>${esc(x.when)}</strong><br>${esc(
        x.what.charAt(0).toUpperCase() + x.what.slice(1),
      )}</td>
</tr>`,
    )
    .join("");
  return `${paraHtml(C, [{ b: "Here's the rest of your free week:" }], "margin:8px 0 14px;")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">${rows}</table>`;
}

export function renderEmail(i: EmailInput): RenderedEmail {
  const C = THEMES[i.theme ?? LIVE_THEME];
  const { subject, preview } = subjectFor(i);
  const hero = heroFor(i);
  const b = bodyFor(i);
  const button = BUTTON[i.cta];
  const greeting = `Hi ${i.firstName}!`;
  const a = i.assets;
  const moodRow = i.kind === "day1" && i.cta === "side_effect";

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<style>
@font-face{font-family:'Jellee';src:url('${esc(a.font)}') format('truetype');font-weight:400;font-style:normal;}
:root{color-scheme:light only;supported-color-schemes:light only;}
h1{text-wrap:balance;}
p{text-wrap:pretty;}
@media (max-width:480px){.outer{padding:12px 10px 28px !important}.pad{padding-left:22px !important;padding-right:22px !important}.title{font-size:24px !important;line-height:28px !important}.herotext{padding:16px 4px 16px 22px !important}}
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
<td width="54%" valign="middle" bgcolor="${C.hero}" class="herotext" style="width:54%;background:${C.hero};border-radius:24px 0 0 0;padding:22px 8px 22px 28px;">
<h1 class="title" style="margin:0;font-family:${DISPLAY};font-size:30px;line-height:35px;font-weight:400;color:${C.heroInk};">${esc(hero.title)}</h1>
</td>
<td width="46%" valign="bottom" bgcolor="${C.hero}" style="width:46%;background:${C.hero};border-radius:0 24px 0 0;padding:0;line-height:0;font-size:0;">
<img src="${esc(i.kind === "day0" ? a.heroDay0 : a.heroDay1)}" width="240" alt="${esc(i.fish)}, the DreamMe fish, ${i.kind === "day0" ? "waving hello" : "holding a heart"}" style="display:block;border:0;width:100%;max-width:240px;height:auto;margin-left:auto;">
</td>
</tr></table>
</td></tr>

<tr><td bgcolor="${C.sheet}" class="pad" style="background:${C.sheet};border-radius:0 0 24px 24px;padding:30px 30px 10px;">
${paraHtml(C, [greeting])}
${b.intro.map((p) => paraHtml(C, p)).join("\n")}
${moodRow ? moodRowHtml(C, i.ctaUrl, a.moods) : ""}
${paraHtml(C, b.askPara)}
${stepsHtml(C, STEPS_LEAD[i.cta], steps(i.cta))}
${buttonHtml(C, button, i.ctaUrl)}
${b.note ? noteHtml(C, b.note) : ""}
${b.after.map((p) => paraHtml(C, p)).join("\n")}
${b.week ? weekHtml(C, b.week) : ""}
${b.closing.map((p) => paraHtml(C, p)).join("\n")}
${b.signoff ? paraHtml(C, [b.signoff]) : ""}
<p style="margin:6px 0 2px;font-family:${SANS};font-size:16px;line-height:22px;font-weight:700;color:${C.ink};">Dan</p>
<p style="margin:0 0 22px;font-family:${SANS};font-size:15px;line-height:20px;color:${C.ink2};">Co-founder, DreamMe</p>
<p style="margin:0 0 24px;font-family:${SANS};font-size:15px;line-height:22px;color:${C.ink};">P.S. Here's that link again: <a href="${esc(i.ctaUrl)}" style="color:${C.ink};font-weight:700;text-decoration:underline;text-underline-offset:3px;">${esc(button)}</a></p>
</td></tr>

<tr><td align="center" style="padding:24px 12px 0;">
<p style="margin:0 0 6px;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink2};">DreamMe, your GLP-1 companion</p>
<p style="margin:0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink2};">You're getting this because you started a DreamMe free trial.<br><a href="${esc(i.unsubscribeUrl)}" style="color:${C.ink2};text-decoration:underline;text-underline-offset:2px;">Unsubscribe</a></p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  const lines: string[] = [hero.title, hero.sub, "", greeting, "", ...b.intro.flatMap((p) => [paraText(p), ""])];
  if (moodRow) lines.push("Tap how you feel today:", ...MOODS.map((m) => `- ${MOOD_LABEL[m]}: ${moodUrl(i.ctaUrl, m)}`), "");
  lines.push(paraText(b.askPara), "", STEPS_LEAD[i.cta], ...steps(i.cta).map((s, n) => `${n + 1}. ${s}`), "", `${button}: ${i.ctaUrl}`, "");
  if (b.note) lines.push(`${b.note.title}. ${b.note.body}`, "");
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
