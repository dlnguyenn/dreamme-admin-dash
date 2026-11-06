/**
 * A small Markdown parser for briefs shown in the DAD (src/lib/briefs).
 * Covers what our briefs use: # to ### headings, paragraphs, - and 1. lists
 * with one nested level, pipe tables, `code`, **bold** and [links](url).
 * Pure, so it is unit-tested; BriefReader.tsx turns the blocks into React.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; v: string }
  | { t: "link"; href: string; children: Inline[] };

export interface ListItem {
  children: Inline[];
  sub: Block | null;
}

export type Block =
  | { t: "h"; level: 1 | 2 | 3; children: Inline[] }
  | { t: "p"; children: Inline[] }
  | { t: "ul" | "ol"; items: ListItem[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] };

/** Only http(s), mailto and same-site paths become links; anything else stays text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  if (h.startsWith("/") && !h.startsWith("//")) return h;
  return null;
}

const INLINE = /(`[^`]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)/g;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: s.slice(last, at) });
    if (m[1]) {
      out.push({ t: "code", v: m[1].slice(1, -1) });
    } else if (m[2]) {
      const href = safeHref(m[4]);
      const children = parseInline(m[3]);
      if (href) out.push({ t: "link", href, children });
      else out.push(...children);
    } else if (m[5]) {
      out.push({ t: "strong", v: m[6] });
    }
    last = at + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line: string): Inline[][] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => parseInline(c.trim()));
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: ListItem[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", children: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: list.t, items: list.items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) {
      flushPara();
      // A blank line ends a list unless the next line continues it.
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (list && !(next && LIST.test(next))) flushList();
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3, children: parseInline(h[2].trim()) });
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      flushPara();
      flushList();
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(cells(lines[i]));
        i++;
      }
      i--;
      blocks.push({ t: "table", head, rows });
      continue;
    }

    const li = LIST.exec(line);
    if (li) {
      flushPara();
      const indented = li[1].length >= 2;
      const kind: "ul" | "ol" = /\d/.test(li[2]) ? "ol" : "ul";
      const item: ListItem = { children: parseInline(li[3]), sub: null };
      if (indented && list && list.items.length) {
        const parent = list.items[list.items.length - 1];
        if (!parent.sub || parent.sub.t !== kind) parent.sub = { t: kind, items: [] };
        (parent.sub as { items: ListItem[] }).items.push(item);
        continue;
      }
      if (!list || list.t !== kind) {
        flushList();
        list = { t: kind, items: [] };
      }
      list.items.push(item);
      continue;
    }

    // Indented text right under a list item continues that item.
    if (list && /^\s{2,}\S/.test(line) && list.items.length) {
      const last = list.items[list.items.length - 1];
      last.children.push({ t: "text", v: " " }, ...parseInline(line.trim()));
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** The first # heading, for a page title. */
export function markdownTitle(src: string): string | null {
  const m = /^#\s+(.+)$/m.exec(src);
  return m ? m[1].trim() : null;
}
