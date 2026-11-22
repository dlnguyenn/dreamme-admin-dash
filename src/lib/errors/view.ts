/**
 * Pure view logic for the Errors tab and its Overview alerts. Tested in
 * tests/error-tracker.test.ts. Days are UTC (err_issue_daily is UTC).
 */
import type { UrgentAlert } from "@/lib/overview-alerts";

export interface IssueLike {
  id: number;
  title: string;
  culprit: string | null;
  platform: string | null;
  status: "unresolved" | "resolved" | "ignored";
  regressed_at: string | null;
  first_seen: string;
  last_seen: string;
  event_count: number;
  user_count: number;
  handled: boolean | null;
  mechanism: string | null;
}

export interface DailyLike {
  issue_id: number;
  day: string;
  events: number;
}

export const SERIES_DAYS = 14;
const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface IssueView<T extends IssueLike = IssueLike> {
  issue: T;
  /** Events per UTC day, oldest first, ending today. */
  series: number[];
  today: number;
  last7: number;
  isNew: boolean;
  regressed: boolean;
  spiking: boolean;
  crash: boolean;
}

/** A crash ended the app; handled=false from a native mechanism, or a fatal JS error. */
export function isCrash(i: Pick<IssueLike, "handled" | "mechanism" | "platform">): boolean {
  if (i.handled !== false) return false;
  const m = (i.mechanism ?? "").toLowerCase();
  return i.platform !== "javascript" || m === "onerror" || m === "globalhandlererrors";
}

/** Spike: today at least 20 events and 5x the daily average of the 7 days before. */
export function isSpiking(series: number[]): boolean {
  const today = series.at(-1) ?? 0;
  const prior = series.slice(-8, -1);
  const avg = prior.length ? prior.reduce((s, n) => s + n, 0) / prior.length : 0;
  return today >= 20 && today >= 5 * Math.max(avg, 1);
}

export function buildIssueViews<T extends IssueLike>(issues: T[], daily: DailyLike[], now: Date): IssueView<T>[] {
  const days = Array.from({ length: SERIES_DAYS }, (_, k) => dayKey(now.getTime() - (SERIES_DAYS - 1 - k) * DAY));
  const index = new Map(days.map((d, k) => [d, k]));
  const byIssue = new Map<number, number[]>();
  for (const r of daily) {
    const k = index.get(r.day);
    if (k == null) continue;
    let s = byIssue.get(r.issue_id);
    if (!s) byIssue.set(r.issue_id, (s = new Array(SERIES_DAYS).fill(0)));
    s[k] += r.events;
  }
  return issues.map((issue) => {
    const series = byIssue.get(issue.id) ?? new Array(SERIES_DAYS).fill(0);
    return {
      issue,
      series,
      today: series.at(-1) ?? 0,
      last7: series.slice(-7).reduce((s, n) => s + n, 0),
      isNew: now.getTime() - Date.parse(issue.first_seen) <= 7 * DAY,
      regressed: !!issue.regressed_at && now.getTime() - Date.parse(issue.regressed_at) <= 7 * DAY && issue.status === "unresolved",
      spiking: issue.status !== "ignored" && isSpiking(series),
      crash: isCrash(issue),
    };
  });
}

export type Connection =
  | { state: "waiting" }
  | { state: "receiving"; lastEventAt: string }
  | { state: "quiet"; lastEventAt: string; hours: number };

/** "Gone quiet" = events used to arrive and none has in 24 hours. */
export function connectionState(issues: Pick<IssueLike, "last_seen">[], now: Date): Connection {
  if (!issues.length) return { state: "waiting" };
  const last = issues.reduce((m, i) => (i.last_seen > m ? i.last_seen : m), issues[0].last_seen);
  const hours = (now.getTime() - Date.parse(last)) / 3_600_000;
  return hours >= 24 ? { state: "quiet", lastEventAt: last, hours } : { state: "receiving", lastEventAt: last };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * Overview "Needs attention" items:
 *  - a new issue (first seen in the last 24 h) hitting at least 3 users or 10
 *    events (critical at 25 users, or any new crash with 3+ users);
 *  - a resolved issue that came back in the last 24 h;
 *  - an issue spiking today;
 *  - the tracker gone quiet (no events in 24 h after receiving some).
 */
export function errorUrgents(views: IssueView[], connection: Connection, now: Date): UrgentAlert[] {
  const out: UrgentAlert[] = [];
  // The Overview opens tabs by id only; the Errors tab lists new, regressed
  // and spiking issues first, so the one named here is at the top.
  const link = (_id?: number) => ({ tab: "errors", label: "Errors" });
  const live = views.filter((v) => v.issue.status !== "ignored");
  const fresh = live.filter(
    (v) => now.getTime() - Date.parse(v.issue.first_seen) <= DAY && v.issue.status === "unresolved" && (v.issue.user_count >= 3 || v.issue.event_count >= 10),
  );
  for (const v of fresh.slice(0, 3)) {
    const critical = v.issue.user_count >= 25 || (v.crash && v.issue.user_count >= 3);
    out.push({
      id: `errors:new:${v.issue.id}`,
      fingerprint: critical ? "critical" : "warning",
      level: critical ? "critical" : "warning",
      title: `New ${v.crash ? "crash" : "error"}: ${v.issue.title.slice(0, 90)}`,
      detail: `${plural(v.issue.user_count, "user")}, ${plural(v.issue.event_count, "event")} since it first appeared.`,
      link: link(v.issue.id),
    });
  }
  for (const v of live.filter((v) => v.issue.regressed_at && now.getTime() - Date.parse(v.issue.regressed_at) <= DAY && v.issue.status === "unresolved").slice(0, 3)) {
    out.push({
      id: `errors:regressed:${v.issue.id}`,
      fingerprint: v.issue.regressed_at ?? "",
      level: "warning",
      title: `Came back after it was resolved: ${v.issue.title.slice(0, 80)}`,
      detail: `${plural(v.today, "event")} today.`,
      link: link(v.issue.id),
    });
  }
  for (const v of live.filter((v) => v.spiking).slice(0, 3)) {
    out.push({
      id: `errors:spike:${v.issue.id}`,
      fingerprint: dayKey(now.getTime()),
      level: "warning",
      title: `Error spiking: ${v.issue.title.slice(0, 90)}`,
      detail: `${plural(v.today, "event")} today, against ${Math.round(v.series.slice(-8, -1).reduce((s, n) => s + n, 0) / 7)} a day the week before.`,
      link: link(v.issue.id),
    });
  }
  if (connection.state === "quiet") {
    out.push({
      id: "errors:quiet",
      fingerprint: connection.lastEventAt,
      level: "warning",
      title: "The error tracker has gone quiet",
      detail: `No app errors received for ${Math.round(connection.hours)} hours. Usually that means the app stopped sending, not that errors stopped.`,
      link: link(),
    });
  }
  return out;
}
