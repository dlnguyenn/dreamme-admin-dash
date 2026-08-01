/**
 * Support Inbox — plain-text email cleanup helpers. Pure, client-safe,
 * unit-tested.
 */

/**
 * Minimal HTML → readable plain text. Exists because Apple Mail replies to
 * our HTML billing emails are often HTML-ONLY (no text/plain part), which
 * left body_text null — triage then saw "(no body)" and spam-binned a real
 * "please cancel my subscription" (Jo N., 2026-07-28).
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/﻿/g, "");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The best available body: plain text, else text derived from HTML. */
export function messageText(
  bodyText: string | null | undefined,
  bodyHtml: string | null | undefined,
): string {
  const t = (bodyText ?? "").trim();
  return t || htmlToPlainText(bodyHtml);
}

// ---------------------------------------------------------------------------
// Signature names
//
// The From header is often only part of a person's name ("Dr. Mijares"),
// while the sign-off carries the rest ("Thank you, / Lilia"). Together
// they make the full name that matches a Stripe billing name — the only
// way to find a customer who emails from a different address than the
// card on file. Pure, unit-tested.

const SIGNOFF = new RegExp(
  "^(" +
    [
      "thanks so much",
      "thanks again",
      "thanks",
      "thank you so much",
      "thank you",
      "thx",
      "many thanks",
      "best regards",
      "kind regards",
      "warm regards",
      "best wishes",
      "best",
      "regards",
      "sincerely",
      "cheers",
      "warmly",
      "take care",
      "talk soon",
      "appreciate it",
      "respectfully",
    ].join("|") +
    ")$",
  "i",
);

/** Device/app footers and other lines that are never a person's name. */
const NOT_A_NAME =
  /^(sent from|get outlook|sent via|download|confidentiality|this email|virus-free|www\.|http)/i;

/** 1-3 alphabetic words — allows accents, hyphens, apostrophes, "A." initials. */
function looksLikeName(raw: string): boolean {
  const line = raw.trim().replace(/[,;:!]+$/, "");
  if (!line || line.length > 40) return false;
  if (NOT_A_NAME.test(line) || SIGNOFF.test(line)) return false;
  if (/[@\d<>/]/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 1 || words.length > 3) return false;
  return words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w));
}

function cleanName(raw: string): string {
  return raw.trim().replace(/[,;:!.]+$/, "").replace(/\s+/g, " ");
}

/**
 * Names found in the sign-off of an email body. Handles both
 * "Thank you, Lilia" on one line and "Thank you," / "Lilia" across two,
 * plus a bare trailing name line. Quoted reply chains are ignored.
 */
export function extractSignatureNames(body: string | null | undefined): string[] {
  const { main } = splitQuotedText(body ?? "");
  const lines = main
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[.!]+$/, "").trim();
    // "Thank you, Lilia"
    const inline = line.match(/^([^,]{2,30}),\s*(.{2,40})$/);
    if (inline && SIGNOFF.test(inline[1].trim()) && looksLikeName(inline[2])) {
      found.push(cleanName(inline[2]));
      continue;
    }
    // "Thank you," then the name on the next line
    if (SIGNOFF.test(line.replace(/,$/, "").trim()) && i + 1 < lines.length) {
      if (looksLikeName(lines[i + 1])) found.push(cleanName(lines[i + 1]));
    }
  }

  // Fallback: a short trailing line that isn't a sentence.
  if (found.length === 0) {
    const last = lines[lines.length - 1];
    if (!/[.?!]$/.test(last) && looksLikeName(last)) found.push(cleanName(last));
  }

  return [...new Set(found)];
}

export interface SplitBody {
  /** the author's own words */
  main: string;
  /** the quoted reply chain ("On … wrote:" + "> …"), null when absent */
  quoted: string | null;
}

const ATTRIBUTION = /^On .{4,200} wrote:\s*$/;
const OUTLOOK_SEP = /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}$/i;
const OUTLOOK_HDR = /^From:\s.+$/;

/**
 * Split a plain-text email body into the author's words and the quoted
 * reply chain underneath. Handles Gmail ("On … wrote:" + "> " lines,
 * including a wrapped attribution line) and Outlook ("-----Original
 * Message-----" / "From: …" header blocks). Never returns an empty main:
 * a body that is entirely quotation stays unsplit.
 */
export function splitQuotedText(body: string | null | undefined): SplitBody {
  const text = (body ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith(">")) {
      cut = i;
      break;
    }
    if (ATTRIBUTION.test(line) || OUTLOOK_SEP.test(line)) {
      cut = i;
      break;
    }
    // Gmail wraps long attributions: "On Sun, Jul 26, 2026 at 5:07 PM Jane\nDoe <jane@x.com> wrote:"
    if (
      /^On .{4,200}$/.test(line) &&
      i + 1 < lines.length &&
      /wrote:\s*$/.test(lines[i + 1].trim())
    ) {
      cut = i;
      break;
    }
    // Outlook top-posting header block: "From: x" directly followed by Sent/Date
    if (
      OUTLOOK_HDR.test(line) &&
      i + 1 < lines.length &&
      /^(Sent|Date):\s/.test(lines[i + 1].trim())
    ) {
      cut = i;
      break;
    }
  }

  // No split point, or the body is quotation from line one — leave whole.
  if (cut <= 0) return { main: text.trim(), quoted: null };

  const main = lines.slice(0, cut).join("\n").trim();
  const quoted = lines.slice(cut).join("\n").trim();
  if (!main) return { main: text.trim(), quoted: null };
  return { main, quoted: quoted || null };
}
