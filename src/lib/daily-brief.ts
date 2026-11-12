/**
 * The morning WhatsApp brief: yesterday's numbers plus what needs a person,
 * built from the same Overview payload the DAD shows, so the message and the
 * dashboard never disagree.
 *
 * WhatsApp only lets a business start a conversation with an approved
 * template, and template values can't hold line breaks. So the brief is a
 * fixed template (docs/whatsapp-daily-brief.md) with one short value per line,
 * and lists inside a value are joined with " · ".
 *
 * Pure: buildDailyBrief takes already-fetched data. The cron route fetches.
 */
import type { OverviewPayload } from "@/lib/overview";
import type { ExperimentEntry } from "@/lib/experiment-log";
import { daysRunning } from "@/lib/experiment-log";

export interface DailyBriefInput {
  overview: Pick<OverviewPayload, "northStar" | "paid" | "mrr" | "urgent">;
  /** null = the experiment log couldn't be read. */
  experiments: ExperimentEntry[] | null;
  experimentsError?: string | null;
  /** Today's Eastern date, YYYY-MM-DD. */
  today: string;
}

export interface DailyBrief {
  /** "Wed Nov 11": the day the numbers are for (yesterday, Eastern). */
  dayLabel: string;
  trials: string;
  revenue: string;
  spend: string;
  mrr: string;
  needsYou: string;
  experiments: string;
  /** Template body values in order ({{1}}..{{7}}). */
  params: string[];
  /** The same message as plain text, for the dry-run preview and logs. */
  text: string;
}

const MAX_ITEMS = 4;
const MAX_PARAM = 300;

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;
const usdCents = (n: number) => `$${n.toFixed(2)}`;
const usdK = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : usd(n));
const signed = (n: number, fmt: (x: number) => string) => `${n >= 0 ? "+" : "-"}${fmt(Math.abs(n))}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function dayBefore(date: string, n = 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function weekdayLabel(date: string, withDate = true): string {
  const d = new Date(`${date}T12:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = withDate
    ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }
    : { weekday: "short", timeZone: "UTC" };
  return d.toLocaleDateString("en-US", opts).replace(",", "");
}

/** WhatsApp rejects template values with newlines, tabs or 4+ spaces in a row. */
export function cleanParam(s: string): string {
  const flat = s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (!flat) return "-";
  return flat.length > MAX_PARAM ? `${flat.slice(0, MAX_PARAM - 1)}…` : flat;
}

function joinItems(items: string[], empty: string): string {
  if (items.length === 0) return empty;
  const shown = items.slice(0, MAX_ITEMS);
  const more = items.length - shown.length;
  return shown.join(" · ") + (more > 0 ? ` · +${more} more` : "");
}

/**
 * Log titles are written for the Experiments tab ("In-app cancel offer
 * screen: new title and subtitle (English, German, Spanish)"). For a phone
 * line, keep the part before a colon and drop parentheticals.
 */
export function shortTitle(t: string, max = 40): string {
  let s = t.replace(/\s*\([^)]*\)/g, "").trim();
  const colon = s.indexOf(":");
  if (colon >= 12) s = s.slice(0, colon).trim();
  if (!s) s = t.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ---------------------------------------------------------------------------
// Lines

function trialsLine(o: DailyBriefInput["overview"]): string {
  const y = o.paid?.daily?.yesterday.trials ?? o.northStar?.trialStartsYesterday ?? null;
  if (y == null) return "couldn't read RevenueCat";
  const parts = [String(y)];
  // avg7d is the 7 days before yesterday, so a spike isn't in its own baseline.
  // (PaidDaily.weekAgo is the same weekday as TODAY, not yesterday, so it isn't used.)
  const avg = o.northStar?.avg7d;
  if (avg != null) {
    const delta = avg > 0 ? Math.round(((y - avg) / avg) * 100) : null;
    parts.push(`7d avg ${Math.round(avg)}${delta != null ? ` (${delta >= 0 ? "+" : ""}${delta}%)` : ""}`);
  }
  if (o.northStar?.stale) parts.push("RevenueCat rollup is late");
  return parts.join(" · ");
}

function revenueLine(o: DailyBriefInput["overview"]): string {
  const d = o.paid?.daily;
  if (!d || d.revenueError || d.yesterday.revenue == null) return "couldn't read revenue";
  const parts = [usd(d.yesterday.revenue)];
  if (d.last7.revenue != null) parts.push(`7d avg ${usd(d.last7.revenue / 7)}`);
  return parts.join(" · ");
}

function spendLine(o: DailyBriefInput["overview"]): string {
  const d = o.paid?.daily;
  if (!d || d.yesterday.spend == null) return "couldn't read Meta";
  const parts = [usd(d.yesterday.spend)];
  if (d.yesterday.metaCostPerTrial != null) parts.push(`${usdCents(d.yesterday.metaCostPerTrial)} per Meta trial`);
  if (d.last7.spend != null) parts.push(`7d avg ${usd(d.last7.spend / 7)}`);
  return parts.join(" · ");
}

function mrrLine(o: DailyBriefInput["overview"]): string {
  const m = o.mrr;
  if (!m) return "couldn't read MRR";
  const parts = [usdK(m.mrr)];
  if (m.lastDay) parts.push(`${signed(m.lastDay.change, usd)} yesterday`);
  if (m.d30) parts.push(`${pct(m.d30.pct)} in 30d`);
  return parts.join(" · ");
}

function needsYouLine(o: DailyBriefInput["overview"]): string {
  if (o.urgent == null) return "couldn't check alerts, open the DAD";
  const items = o.urgent.map((a) => (a.level === "critical" ? `🔴 ${a.title}` : a.title));
  return joinItems(items, "nothing urgent");
}

/**
 * What in the experiment log wants a look:
 *  - experiments with a control group that are running, and for how long
 *  - experiments starting in the next 3 days
 *  - stopped experiments nobody has decided on yet
 *  - anything (test or change) that went live yesterday or today
 */
export function experimentItems(entries: ExperimentEntry[], today: string): string[] {
  const yesterday = dayBefore(today);
  const in3 = dayBefore(today, -3);
  const out: string[] = [];

  for (const e of entries) {
    if (e.kind !== "experiment" || e.status !== "stopped" || e.decision.trim()) continue;
    out.push(`${shortTitle(e.title)} stopped, needs a decision`);
  }
  for (const e of entries) {
    if (e.kind !== "experiment" || e.status !== "running" || !e.start_date) continue;
    const n = daysRunning(e.start_date, null, today);
    out.push(`${shortTitle(e.title)} day ${n ?? "?"}`);
  }
  for (const e of entries) {
    if (e.kind !== "experiment" || (e.status !== "planned" && e.status !== "draft")) continue;
    if (!e.start_date || e.start_date < today || e.start_date > in3) continue;
    out.push(`${shortTitle(e.title)} starts ${e.start_date === today ? "today" : weekdayLabel(e.start_date)}`);
  }
  const fresh = entries.filter(
    (e) => e.kind === "change" && e.status === "running" && !!e.start_date && e.start_date >= yesterday,
  );
  if (fresh.length > 0) {
    const names = fresh.slice(0, 3).map((e) => shortTitle(e.title, 32)).join("; ");
    out.push(
      `${fresh.length === 1 ? "new change live" : `${fresh.length} new changes live`}: ${names}${fresh.length > 3 ? "; …" : ""}`,
    );
  }
  return out;
}

export function buildDailyBrief(i: DailyBriefInput): DailyBrief {
  const day = dayBefore(i.today);
  const dayLabel = weekdayLabel(day);
  const trials = trialsLine(i.overview);
  const revenue = revenueLine(i.overview);
  const spend = spendLine(i.overview);
  const mrr = mrrLine(i.overview);
  const needsYou = needsYouLine(i.overview);
  const experiments =
    i.experiments == null
      ? "couldn't read the experiment log"
      : joinItems(experimentItems(i.experiments, i.today), "nothing running");
  const expNote = i.experimentsError ? " (couldn't check RevenueCat status)" : "";

  const params = [dayLabel, trials, revenue, spend, mrr, needsYou, experiments + expNote].map(cleanParam);
  const text = [
    `DreamMe daily brief for ${params[0]}`,
    "",
    `Trials: ${params[1]}`,
    `Revenue: ${params[2]}`,
    `Ad spend: ${params[3]}`,
    `MRR: ${params[4]}`,
    "",
    `Needs you: ${params[5]}`,
    "",
    `Experiments: ${params[6]}`,
    "",
    "Full numbers are on the DAD Overview.",
  ].join("\n");

  return { dayLabel, trials, revenue, spend, mrr, needsYou, experiments, params, text };
}
