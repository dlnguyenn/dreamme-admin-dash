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
