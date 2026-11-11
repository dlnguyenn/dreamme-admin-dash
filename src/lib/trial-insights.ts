/**
 * Overview trial tiles, opened up:
 *
 *  - why: a ranked guess at why yesterday's trial starts moved against the
 *    7 days before (the same baseline the hero tile's chip uses). Every reason
 *    carries an estimated effect in trials, so they can be ranked; the funnel
 *    split (fewer onboarding starts vs a lower trial rate) adds up to the
 *    whole change exactly, the others are evidence beside it.
 *  - pace: today's trials so far against the last 28 days' intraday shape,
 *    the last hour against the same hour on a usual day, and a projected
 *    end-of-day count with a range.
 *
 * Pure: the fetching lives in trial-insights-data.ts. Days are Eastern, to
 * match rc_trial_starts_daily and the tiles.
 */

export interface TrialEvent {
  /** ISO timestamp */
  event_at: string;
  store: string | null;
}

export interface MetaInsightRow {
  date: string;
  campaign_name: string | null;
  spend: number | null;
  installs: number | null;
  trial_starts: number | null;
}

export interface SourceDay {
  source: string;
  /** signups that said this source on the day */
  count: number;
  /** average a day over the 7 days before */
  avgPerDay: number;
}

export interface LoggedChange {
  title: string;
  kind: string;
  start_date: string | null;
  end_date: string | null;
}

export type ReasonKind = "funnel" | "weekday" | "platform" | "meta" | "source" | "change";

export interface Reason {
  id: string;
  kind: ReasonKind;
  /** One plain sentence with its numbers. */
  text: string;
  /** Estimated effect on yesterday's count, in trials; null when it can't be sized. */
  impact: number | null;
  /** Lowercase clause for the headline ("Meta iOS spend was cut 40%"). */
  clause?: string;
}

export interface TrialWhy {
  date: string;
  value: number;
  /** Average a day over the 7 days before. */
  baseline: number;
  dayBefore: number | null;
  change: number;
  changePct: number;
  direction: "down" | "up" | "flat";
  /** The top guess in one sentence; null when the day was in line. */
  headline: string | null;
  /** Ranked by size of effect; context items (no size) last. */
  reasons: Reason[];
}

export interface PacePoint {
  /** End of the hour, Eastern (1..24). */
  hour: number;
  /** Today's running count at the end of that hour; null after now. */
  today: number | null;
  /** A usual day's running count at the end of that hour. */
  typical: number;
}

export interface TrialPace {
  asOf: string;
  /** Minutes since Eastern midnight. */
  minuteOfDay: number;
  soFar: number;
  /** What a usual day has by this time. */
  typicalByNow: number;
  /** soFar against typicalByNow, as a percentage (+12 = 12% ahead). */
  vsTypicalPct: number | null;
  /** End-of-day estimate at today's pace, and the middle half of the outcomes. */
  projected: number;
  low: number;
  high: number;
  /** A usual full day over the basis days. */
  typicalDay: number;
  lastHour: number;
  typicalLastHour: number;
  /** Less than a tenth of a usual day is in by now: the estimate is rough. */
  early: boolean;
  basisDays: number;
  curve: PacePoint[];
}

export interface TrialInsights {
  generatedAt: string;
  why: TrialWhy | null;
  pace: TrialPace | null;
}

// ---------------------------------------------------------------------------
// Eastern time

const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Eastern date and minute of day for an instant. */
export function etParts(d: Date): { date: string; minute: number } {
  const parts = Object.fromEntries(ET.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);
const signed = (n: number, dp = 0) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(dp)}`;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

interface Bucketed {
  /** date -> minutes of each trial that day */
  minutes: Map<string, number[]>;
  /** date -> store -> count */
  byStore: Map<string, Map<string, number>>;
}

function bucket(events: TrialEvent[]): Bucketed {
  const minutes = new Map<string, number[]>();
  const byStore = new Map<string, Map<string, number>>();
  for (const e of events) {
    const { date, minute } = etParts(new Date(e.event_at));
    (minutes.get(date) ?? minutes.set(date, []).get(date)!).push(minute);
    const s = byStore.get(date) ?? byStore.set(date, new Map()).get(date)!;
    const store = e.store ?? "OTHER";
    s.set(store, (s.get(store) ?? 0) + 1);
  }
  return { minutes, byStore };
}

const countOn = (b: Bucketed, date: string) => b.minutes.get(date)?.length ?? 0;

// ---------------------------------------------------------------------------
// Pace

export const PACE_BASIS_DAYS = 28;

export function buildPace(events: TrialEvent[], now = new Date()): TrialPace | null {
  const b = bucket(events);
  const { date: today, minute: nowMin } = etParts(now);
  const basis: string[] = [];
  for (let i = 1; i <= PACE_BASIS_DAYS; i++) {
    const d = addDays(today, -i);
    if (countOn(b, d) > 0) basis.push(d);
  }
  if (basis.length < 7) return null;

  const todayMins = b.minutes.get(today) ?? [];
  const soFar = todayMins.filter((m) => m <= nowMin).length;

  const totals = basis.map((d) => countOn(b, d));
  const before = basis.map((d) => (b.minutes.get(d) ?? []).filter((m) => m <= nowMin).length);
  const typicalDay = mean(totals);
  const typicalByNow = mean(before);
  const pooledFrac = before.reduce((a, c) => a + c, 0) / Math.max(1, totals.reduce((a, c) => a + c, 0));

  // At today's pace: so far, scaled by the share of a day that is usually in
  // by now. The range takes each basis day's own share, so it widens when the
  // time of day says little (early morning) and narrows as the day fills in.
  const projected = pooledFrac > 0 ? soFar / pooledFrac : typicalDay;
  const perDay = basis
    .map((_, i) => (totals[i] > 0 && before[i] > 0 ? soFar / (before[i] / totals[i]) : null))
    .filter((x): x is number => x != null);
  const low = perDay.length >= 5 ? Math.min(quantile(perDay, 0.25), projected) : projected;
  const high = perDay.length >= 5 ? Math.max(quantile(perDay, 0.75), projected) : projected;

  const inWindow = (mins: number[], from: number, to: number) => mins.filter((m) => m > from && m <= to).length;
  const lastHour = inWindow(todayMins, nowMin - 60, nowMin);
  const typicalLastHour = mean(basis.map((d) => inWindow(b.minutes.get(d) ?? [], nowMin - 60, nowMin)));

  const curve: PacePoint[] = [];
  for (let h = 1; h <= 24; h++) {
    const end = h * 60 - 1;
    curve.push({
      hour: h,
      today: end - 59 <= nowMin ? todayMins.filter((m) => m <= Math.min(end, nowMin)).length : null,
      typical: mean(basis.map((d) => (b.minutes.get(d) ?? []).filter((m) => m <= end).length)),
    });
  }

  return {
    asOf: now.toISOString(),
    minuteOfDay: nowMin,
    soFar,
    typicalByNow: Math.round(typicalByNow * 10) / 10,
    vsTypicalPct: typicalByNow >= 1 ? Math.round(pct(soFar, typicalByNow)) : null,
    projected: Math.round(projected),
    low: Math.round(low),
    high: Math.round(high),
    typicalDay: Math.round(typicalDay),
    lastHour,
    typicalLastHour: Math.round(typicalLastHour * 10) / 10,
    early: pooledFrac < 0.1,
    basisDays: basis.length,
    curve,
  };
}

// ---------------------------------------------------------------------------
// Why

export interface WhyInputs {
  events: TrialEvent[];
  /** Mixpanel onboarding_started uniques by Eastern date; null when unavailable. */
  onboarding: Map<string, number> | null;
  meta: MetaInsightRow[] | null;
  /** Yesterday's self-reported sources; null when unavailable. */
  sources: SourceDay[] | null;
  changes: LoggedChange[] | null;
}

function platformOf(store: string): "iOS" | "Android" | null {
  if (store === "APP_STORE" || store === "MAC_APP_STORE") return "iOS";
  if (store === "PLAY_STORE") return "Android";
  return null;
}

function metaPlatform(name: string | null): "iOS" | "Android" | null {
  const n = (name ?? "").toLowerCase();
  if (n.includes("android")) return "Android";
  if (n.includes("ios") || n.includes("iphone")) return "iOS";
  return null;
}

const SOURCE_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  app_store: "the App Store",
  google: "Google",
  friend_family: "a friend or family",
  youtube: "YouTube",
  other: "something else",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ");

export function buildWhy(input: WhyInputs, now = new Date()): TrialWhy | null {
  const b = bucket(input.events);
  const today = etParts(now).date;
  const y = addDays(today, -1);
  const prior = Array.from({ length: 7 }, (_, i) => addDays(y, -(i + 1)));
  const value = countOn(b, y);
  const priorCounts = prior.map((d) => countOn(b, d));
  if (priorCounts.every((n) => n === 0)) return null;
  const baseline = mean(priorCounts);
  const change = value - baseline;
  const changePct = pct(value, baseline);
  const direction: TrialWhy["direction"] = Math.abs(changePct) < 5 ? "flat" : change < 0 ? "down" : "up";
  const reasons: Reason[] = [];

  // 1. Funnel: onboarding volume against the trial rate. The two effects add
  //    up to the whole change, so they are the backbone of the guess.
  const onb = input.onboarding;
  const onbY = onb?.get(y);
  const onbPrior = onb ? prior.map((d) => onb.get(d)).filter((n): n is number => n != null && n > 0) : [];
  if (onbY != null && onbY > 0 && onbPrior.length >= 5) {
    const onbBase = mean(onbPrior);
    const rateBase = baseline / onbBase;
    const rateY = value / onbY;
    const volume = (onbY - onbBase) * rateBase;
    const rate = onbY * (rateY - rateBase);
    reasons.push({
      id: "onboarding",
      kind: "funnel",
      impact: volume,
      text:
        `${onbY < onbBase ? "Fewer" : "More"} people started onboarding: ${fmt(onbY)} against ${fmt(onbBase)} a day ` +
        `(${signed(pct(onbY, onbBase))}%), worth about ${signed(volume)} trials.`,
    });
    reasons.push({
      id: "trial-rate",
      kind: "funnel",
      impact: rate,
      text:
        `A ${rateY < rateBase ? "smaller" : "bigger"} share of new users started a trial: ${(rateY * 100).toFixed(1)}% against ` +
        `${(rateBase * 100).toFixed(1)}%, worth about ${signed(rate)} trials.`,
    });
  }

  // 2. Weekday: the prior 7 days hold one of each weekday, so the baseline is
  //    weekday-neutral; four weeks say what this weekday usually does.
  const basis = Array.from({ length: PACE_BASIS_DAYS }, (_, i) => addDays(y, -(i + 1))).filter((d) => countOn(b, d) > 0);
  const sameDay = basis.filter((d) => weekdayName(d) === weekdayName(y)).map((d) => countOn(b, d));
  if (sameDay.length >= 3 && basis.length >= 21) {
    const factor = mean(sameDay) / mean(basis.map((d) => countOn(b, d)));
    const impact = baseline * (factor - 1);
    if (Math.abs(factor - 1) >= 0.04) {
      reasons.push({
        id: "weekday",
        kind: "weekday",
        impact,
        clause: `${weekdayName(y)}s usually run ${factor < 1 ? "low" : "high"}`,
        text: `${weekdayName(y)}s usually run ${Math.abs((factor - 1) * 100).toFixed(0)}% ${factor < 1 ? "below" : "above"} an average day (last ${sameDay.length} weeks), worth about ${signed(impact)} trials.`,
      });
    }
  }

  // 3. Platform: where the change landed.
  for (const platform of ["iOS", "Android"] as const) {
    const on = (d: string) =>
      [...(b.byStore.get(d) ?? new Map()).entries()].filter(([s]) => platformOf(s) === platform).reduce((a, [, n]) => a + n, 0);
    const yN = on(y);
    const base = mean(prior.map(on));
    const diff = yN - base;
    if (base > 0 && Math.abs(diff) >= 2) {
      reasons.push({
        id: `platform-${platform}`,
        kind: "platform",
        impact: diff,
        text: `${platform} trials ${fmt(yN)} against ${fmt(base)} a day (${signed(pct(yN, base))}%).`,
      });
    }
  }

  // 4. Meta spend by platform (synced ad_insights_daily). Sized by Meta's own
  //    trial count, which over-claims, so it is evidence, not the backbone.
  if (input.meta && input.meta.length) {
    for (const platform of ["iOS", "Android"] as const) {
      const rows = input.meta.filter((r) => metaPlatform(r.campaign_name) === platform);
      const sum = (d: string, k: "spend" | "trial_starts") =>
        rows.filter((r) => r.date === d).reduce((a, r) => a + (Number(r[k]) || 0), 0);
      const spendY = sum(y, "spend");
      const spendBase = mean(prior.map((d) => sum(d, "spend")));
      const trialsY = sum(y, "trial_starts");
      const trialsBase = mean(prior.map((d) => sum(d, "trial_starts")));
      if (spendBase <= 0 && spendY <= 0) continue;
      const spendPct = pct(spendY, spendBase);
      if (Math.abs(spendPct) < 10 && Math.abs(trialsY - trialsBase) < 3) continue;
      const cpt = trialsY > 0 ? spendY / trialsY : null;
      const cptBase = trialsBase > 0 ? spendBase / trialsBase : null;
      const perTrial =
        cpt != null && cptBase != null ? ` That is ${money(cpt)} per Meta trial against ${money(cptBase)}.` : "";
      const fewer = trialsY < trialsBase;
      let clause: string;
      if (spendPct <= -10) clause = `Meta ${platform} spend was cut ${Math.abs(Math.round(spendPct))}%`;
      else if (spendPct >= 10 && !fewer) clause = `Meta ${platform} spend went up ${Math.round(spendPct)}%`;
      else clause = `Meta ${platform} brought ${fewer ? "fewer" : "more"} trials for the money`;
      reasons.push({
        id: `meta-${platform}`,
        kind: "meta",
        impact: trialsY - trialsBase,
        clause,
        text:
          `Meta ${platform}: ${money(spendY)} spent against ${money(spendBase)} a day (${signed(spendPct)}%), ` +
          `${fmt(trialsY)} Meta-reported trials against ${fmt(trialsBase)}.${perTrial}`,
      });
    }
  }

  // 5. Self-reported sources: the biggest mover, sized at the usual trial rate.
  if (input.sources && input.sources.length) {
    const onbBase = onbPrior.length ? mean(onbPrior) : null;
    const rate = onbBase ? baseline / onbBase : null;
    const movers = input.sources
      .map((s) => ({ ...s, diff: s.count - s.avgPerDay }))
      .filter((s) => s.avgPerDay >= 5 && Math.abs(s.diff) >= 3)
      .sort((a, c) => Math.abs(c.diff) - Math.abs(a.diff))
      .slice(0, 2);
    for (const s of movers) {
      reasons.push({
        id: `source-${s.source}`,
        kind: "source",
        clause: `${s.diff < 0 ? "fewer" : "more"} new users came from ${sourceLabel(s.source)}`,
        impact: rate != null ? s.diff * rate : null,
        text:
          `${s.diff < 0 ? "Fewer" : "More"} new users said they heard about us from ${sourceLabel(s.source)}: ` +
          `${fmt(s.count)} against ${fmt(s.avgPerDay)} a day (${signed(pct(s.count, s.avgPerDay))}%).`,
      });
    }
  }

  // 6. Changes logged in the Experiments tab that started or ended around it.
  for (const c of input.changes ?? []) {
    const near = (d: string | null) => d != null && d >= addDays(y, -2) && d <= y;
    if (!near(c.start_date) && !near(c.end_date)) continue;
    const when = near(c.start_date) ? c.start_date! : c.end_date!;
    const verb = near(c.start_date) ? "started" : "ended";
    const day = new Date(`${when}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    reasons.push({
      id: `change-${c.title}`,
      kind: "change",
      impact: null,
      text: `${verb === "started" ? "Started" : "Ended"} ${day}: ${c.title}.`,
    });
  }

  // Rank: causes first (funnel, weekday, Meta, sources), those pushing the
  // same way as the move before those against it, biggest first. Then where
  // it landed (platform), which restates the change rather than explaining
  // it. Logged changes, which can't be sized, last.
  const dir = change < 0 ? -1 : 1;
  const group = (r: Reason) => (r.kind === "change" || r.impact == null ? 2 : r.kind === "platform" ? 1 : 0);
  reasons.sort((a, c) => {
    if (group(a) !== group(c)) return group(a) - group(c);
    if (a.impact == null || c.impact == null) return 0;
    const aWith = Math.sign(a.impact) === dir ? 0 : 1;
    const cWith = Math.sign(c.impact) === dir ? 0 : 1;
    if (aWith !== cWith) return aWith - cWith;
    return Math.abs(c.impact) - Math.abs(a.impact);
  });

  let headline: string | null = null;
  if (direction !== "flat") {
    const withMove = (r: Reason) => r.impact != null && Math.sign(r.impact) === dir;
    const funnel = reasons.filter((r) => r.kind === "funnel" && withMove(r)).sort((a, c) => Math.abs(c.impact!) - Math.abs(a.impact!))[0];
    const evidence = reasons.find((r) => withMove(r) && r.clause && r.kind !== "funnel");
    const lead = funnel ? funnelLead(funnel, direction) : null;
    if (lead && evidence) headline = `${lead}, likely because ${evidence.clause}`;
    else if (lead) headline = lead;
    else if (evidence) headline = `Trial starts are ${direction}, likely because ${evidence.clause}`;
  }

  return {
    date: y,
    value,
    baseline: Math.round(baseline * 10) / 10,
    dayBefore: b.minutes.has(addDays(y, -1)) ? countOn(b, addDays(y, -1)) : null,
    change: Math.round(change * 10) / 10,
    changePct: Math.round(changePct),
    direction,
    headline,
    reasons,
  };
}

function funnelLead(r: Reason, direction: "down" | "up"): string {
  if (r.id === "onboarding") return `${direction === "down" ? "Fewer" : "More"} people started onboarding`;
  return `A ${direction === "down" ? "smaller" : "bigger"} share of new users started a trial`;
}

export function buildTrialInsights(input: WhyInputs, now = new Date()): TrialInsights {
  return {
    generatedAt: now.toISOString(),
    why: buildWhy(input, now),
    pace: buildPace(input.events, now),
  };
}
