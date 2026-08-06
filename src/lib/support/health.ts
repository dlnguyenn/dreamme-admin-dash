/**
 * Support Inbox — is mail actually still arriving?
 *
 * Born from the 2026-08-06 outage: a deleted Gmail message made the email leg
 * throw on every poll, so its historyId cursor froze for eleven hours. The
 * poller kept running and the sent leg kept succeeding, so every surface
 * looked healthy — the only symptom was an inbox that had gone quiet, which
 * is indistinguishable from a genuinely quiet inbox.
 *
 * So the check is deliberately not "did the last run error". It is "has the
 * cursor moved recently", which is the one thing that is false in every
 * version of this failure, including ones we haven't seen yet.
 *
 * The decision logic is pure and unit-tested; the IO wrapper is thin.
 */
import { getCursor, saveCursor } from "./db";
import { gmailConfigured } from "./gmail-ingest";
import { mailerConfigured, sendOperationalAlert } from "./mailer";

/** A cursor silent for this long, while polling continues, is stuck. */
export const STALE_AFTER_MINUTES = 60;

/**
 * Overridable so the threshold can be tuned without a deploy — and so the
 * banner can actually be exercised locally, which is the only way to know it
 * renders before the next real outage.
 */
export function staleAfterMinutes(): number {
  const raw = Number(process.env.SUPPORT_STALE_AFTER_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : STALE_AFTER_MINUTES;
}
/** Don't repeat the same warning on every 20-minute poll. */
export const REALERT_AFTER_MINUTES = 180;

export interface HealthVerdict {
  stale: boolean;
  minutesSinceAdvance: number | null;
  /** false when we've already warned recently about this same stall */
  shouldAlert: boolean;
}

/**
 * Pure. `updatedAt` is when the cursor last moved, `alertedAt` when we last
 * warned about it. A missing cursor is NOT stale — that's a cold start, and
 * crying wolf on first run would train the alert to be ignored.
 */
export function assessCursor(params: {
  updatedAt: string | null;
  alertedAt: string | null;
  now: number;
  staleAfterMinutes?: number;
  realertAfterMinutes?: number;
}): HealthVerdict {
  const staleAfter = params.staleAfterMinutes ?? STALE_AFTER_MINUTES;
  const realertAfter = params.realertAfterMinutes ?? REALERT_AFTER_MINUTES;
  if (!params.updatedAt) {
    return { stale: false, minutesSinceAdvance: null, shouldAlert: false };
  }
  const moved = new Date(params.updatedAt).getTime();
  if (Number.isNaN(moved)) {
    return { stale: false, minutesSinceAdvance: null, shouldAlert: false };
  }
  const minutes = Math.floor((params.now - moved) / 60_000);
  const stale = minutes >= staleAfter;
  if (!stale) return { stale: false, minutesSinceAdvance: minutes, shouldAlert: false };

  // Alert once, then only again after the re-alert window — but always alert
  // if the last warning predates the last advance (i.e. it recovered and
  // broke again, which is a new incident rather than the same one).
  const alerted = params.alertedAt ? new Date(params.alertedAt).getTime() : null;
  const shouldAlert =
    alerted === null ||
    Number.isNaN(alerted) ||
    alerted < moved ||
    params.now - alerted >= realertAfter * 60_000;
  return { stale: true, minutesSinceAdvance: minutes, shouldAlert };
}

/** Human summary for the alert body and the poll report. */
export function describeStall(minutes: number, cursorId: string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const age = h ? `${h}h ${m}m` : `${m}m`;
  return `Support email ingestion has not advanced in ${age} (cursor "${cursorId}"). Mail may be arriving and not reaching the Support Inbox.`;
}

/** Which cursor is authoritative depends on the active transport. */
export function activeCursorId(): string {
  return gmailConfigured() ? "gmail-api-inbox" : "gmail-inbox";
}

/**
 * Read-only: the stall message, or null. Safe to call from any GET — it
 * cannot send mail or write anything, which is why the UI uses this and the
 * ingest uses checkIngestHealth() below.
 */
export async function readIngestHealth(
  now: number = Date.now(),
): Promise<string | null> {
  try {
    const cursorId = activeCursorId();
    const cursor = await getCursor(cursorId);
    const verdict = assessCursor({
      updatedAt: cursor?.updated_at ?? null,
      alertedAt: cursor?.alerted_at ?? null,
      now,
      staleAfterMinutes: staleAfterMinutes(),
    });
    return verdict.stale && verdict.minutesSinceAdvance !== null
      ? describeStall(verdict.minutesSinceAdvance, cursorId)
      : null;
  } catch {
    return null;
  }
}

/**
 * Run after the ingest legs. Returns a message when the inbox has gone
 * silent in a way that looks like breakage, and emails Dan the first time.
 * Never throws — a health check must not be able to break ingestion.
 */
export async function checkIngestHealth(
  now: number = Date.now(),
): Promise<string | null> {
  const cursorId = activeCursorId();
  try {
    const cursor = await getCursor(cursorId);
    const verdict = assessCursor({
      updatedAt: cursor?.updated_at ?? null,
      alertedAt: cursor?.alerted_at ?? null,
      now,
      staleAfterMinutes: staleAfterMinutes(),
    });
    if (!verdict.stale || verdict.minutesSinceAdvance === null) return null;

    const message = describeStall(verdict.minutesSinceAdvance, cursorId);
    if (verdict.shouldAlert && cursor && mailerConfigured()) {
      await sendOperationalAlert({
        subject: "DreamMe support inbox has gone quiet",
        bodyText:
          `${message}\n\n` +
          `The poller is still running — the email leg specifically is not ` +
          `producing new messages. Check the poll report for leg errors:\n` +
          `https://dreamme-admin-dash.vercel.app/?tab=support\n\n` +
          `If this is a genuinely quiet mailbox you can ignore it; the alert ` +
          `repeats at most every ${REALERT_AFTER_MINUTES / 60} hours.\n`,
      }).catch(() => {});
      await saveCursor({
        id: cursor.id,
        uidvalidity: cursor.uidvalidity,
        last_uid: cursor.last_uid,
        history_id: cursor.history_id ?? null,
        last_seen_at: cursor.last_seen_at,
        alerted_at: new Date(now).toISOString(),
      }).catch(() => {});
    }
    return message;
  } catch {
    return null; // never let the health check take ingestion down with it
  }
}
