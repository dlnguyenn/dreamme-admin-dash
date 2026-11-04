/**
 * Day and week helpers for the April-plan panels. PURE and client-safe.
 *
 * Every day is a US/Eastern calendar day (the Meta ad account and Mixpanel
 * both report in Eastern), carried as a "YYYY-MM-DD" string. Date arithmetic
 * runs on those strings through UTC midnight, so DST never shifts a day.
 */

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD of an instant in US/Eastern. */
export const easternDate = (iso: string | number | Date) => ET_DAY.format(new Date(iso));

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

export const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (positive when b is later). */
export const dayDiff = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY_MS);

/** The Monday on or before `d`. */
export function weekStart(d: string): string {
  const dow = new Date(utc(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

/** Every day from `from` to `to`, both inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = utc(from); t <= utc(to); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Instant (ISO) of Eastern midnight starting `d`, padded a day early so nothing is lost to the offset; bucket in code. */
export const utcSinceForEasternDay = (d: string) => new Date(utc(d) - DAY_MS).toISOString();

const ET_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });

/** Exact instant (ISO) of 00:00 US/Eastern on `d`, for range filters that must not be padded. */
export function easternMidnightIso(d: string): string {
  for (const offsetHours of [5, 4]) {
    const t = utc(d) + offsetHours * 3_600_000;
    if (easternDate(t) === d && ET_HOUR.format(t) === "00") return new Date(t).toISOString();
  }
  return new Date(utc(d) + 5 * 3_600_000).toISOString();
}
