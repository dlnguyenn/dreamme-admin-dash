/**
 * Pure helpers for the trial-ping pipeline, in their own module because
 * Next.js route files may export ONLY route handlers/config — exporting test
 * seams from route.ts fails the production build's route-type validation
 * (which local `tsc --noEmit` does not run). See /api/cron/trial-pings.
 */
import type { TrialPingType } from "@/lib/vendors/expo-push";

export interface WindowSpec {
  pingType: TrialPingType;
  from: string; // ISO, exclusive lower bound of event_at
  to: string; // ISO, inclusive upper bound of event_at
}

/**
 * A trial qualifies for a ping when its event_at is at least the ping delay
 * old, but no more than delay+4h old. Wide catch-up windows + the ledger's
 * claim-before-send make overlapping runs harmless.
 */
export function pingWindows(now: Date): WindowSpec[] {
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const H = 3_600_000;
  return [
    { pingType: "trial_qualified", from: iso(6 * H), to: iso(2 * H) },
    { pingType: "trial_engaged", from: iso(28 * H), to: iso(24 * H) },
  ];
}

export interface TokenRow {
  user_id: string;
  expo_push_token: string;
  updated_at: string;
}

/**
 * Newest token per user. Rows arrive ordered updated_at desc (PostgREST
 * order param); keep the first seen per user_id. One device per user on
 * purpose — every device runs its own client-side ledger, so pushing to
 * several would double-fire the events.
 */
export function pickLatestTokenPerUser(rows: TokenRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.user_id && r.expo_push_token && !out.has(r.user_id)) {
      out.set(r.user_id, r.expo_push_token);
    }
  }
  return out;
}
