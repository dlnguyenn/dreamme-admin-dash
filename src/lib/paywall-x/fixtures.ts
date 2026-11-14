/**
 * Made-up data for the Paywall X readout: a seeded, deterministic population
 * used by the tests and by the dev-only `?demo=fixture` view. Every id is
 * invented (uuid-shaped counters); none is a real user, install or
 * transaction, and the rates are arbitrary.
 */
import type { Charge, TrialStart } from "@/lib/revenue-plan/value-per-trial";
import type { ArmTag, AssignmentRow, CancelEvent, ReadoutInput } from "./readout";
import type { PaywallXArm } from "./shared";

const H = 3_600_000;
const DAY = 24 * H;

/** uuid-shaped fake id: fakeId(7) = "00000000-0000-4000-8000-000000000007". */
export const fakeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Mulberry32: a tiny seeded generator, so the fixture never changes between runs. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoOptions {
  now: Date;
  users?: number;
  days?: number;
  seed?: number;
  /** Chance of a trial within 24 h, per arm. */
  trialRate?: Record<PaywallXArm, number>;
  /** Share of users put in close_x (0.5 = even split). */
  closeXShare?: number;
}

/** A month of a running test: both arms, both sources, iOS and Android, trialists and not. */
export function demoInput(o: DemoOptions): ReadoutInput {
  const r = rng(o.seed ?? 7);
  const users = o.users ?? 900;
  const days = o.days ?? 36;
  const rates = o.trialRate ?? { control: 0.2, close_x: 0.24 };
  const share = o.closeXShare ?? 0.5;
  const nowMs = o.now.getTime();
  const out: ReadoutInput = { assignments: [], trials: [], charges: [], refunds: [], cancels: [], tags: [] };
  for (let i = 1; i <= users; i++) {
    const id = fakeId(i);
    const arm: PaywallXArm = r() < share ? "close_x" : "control";
    const rc = r() < 0.3;
    const exp = nowMs - r() * days * DAY;
    const iso = (t: number) => new Date(t).toISOString();
    out.assignments.push({
      appUserId: id,
      installId: `install-${i}`,
      variant: arm,
      salt: rc ? "rc" : "v1",
      platform: r() < 0.7 ? "ios" : "android",
      createdAt: iso(exp),
    });
    const roll = r();
    let trialAt: number | null = null;
    if (roll < rates[arm]) trialAt = exp + r() * 20 * H;
    else if (roll < rates[arm] + 0.04) trialAt = exp + (1 + r() * 5) * DAY;
    if (trialAt == null || trialAt > nowMs) continue;
    const otx = `otx-${i}`;
    out.trials.push({ otx, userId: id, at: iso(trialAt), store: rc ? "APP_STORE" : "PLAY_STORE" });
    // The attribute usually lands on a later event, not on the trial start.
    const tagAt = trialAt + (r() < 0.8 ? 2 * H : 0);
    if (tagAt <= nowMs) out.tags.push({ userId: id, at: iso(tagAt), variant: arm, source: rc ? "revenuecat" : "split" });
    if (r() < 0.25) {
      const at = trialAt + r() * 20 * H;
      if (at <= nowMs) out.cancels.push({ userId: id, otx, at: iso(at), type: "CANCELLATION", cancelReason: "UNSUBSCRIBE" });
      continue;
    }
    const chargeAt = trialAt + 7.2 * DAY;
    if (chargeAt <= nowMs && r() < 0.45) {
      const yearly = r() < 0.6;
      const c: Charge = {
        userId: id,
        otx,
        at: iso(chargeAt),
        priceUsd: yearly ? 59.99 : 14.99,
        productId: yearly ? "demo_yearly" : "demo_monthly",
        periodDays: yearly ? 365 : 30,
      };
      out.charges.push(c);
      if (!yearly && chargeAt + 30 * DAY <= nowMs) out.charges.push({ ...c, at: iso(chargeAt + 30 * DAY) });
      if (r() < 0.04 && chargeAt + 2 * DAY <= nowMs) {
        out.refunds.push({ ...c, at: iso(chargeAt + 2 * DAY), priceUsd: -c.priceUsd });
      }
    }
  }
  // Two users RevenueCat tags but the app never recorded (a lost write).
  out.tags.push({ userId: fakeId(900001), at: new Date(nowMs - 3 * DAY).toISOString(), variant: "close_x", source: "split" });
  out.tags.push({ userId: fakeId(900002), at: new Date(nowMs - 2 * DAY).toISOString(), variant: "control", source: "split" });
  return out;
}

export const EMPTY_INPUT: ReadoutInput = { assignments: [], trials: [], charges: [], refunds: [], cancels: [], tags: [] };

// Small helpers for hand-written test rows.
export const assignment = (n: number, arm: string, at: string, extra: Partial<AssignmentRow> = {}): AssignmentRow => ({
  appUserId: fakeId(n),
  installId: `install-${n}`,
  variant: arm,
  salt: "v1",
  platform: "ios",
  createdAt: at,
  ...extra,
});
export const trial = (n: number, at: string): TrialStart => ({ otx: `otx-${n}`, userId: fakeId(n), at, store: "APP_STORE" });
export const charge = (n: number, at: string, priceUsd: number, productId = "demo_yearly"): Charge => ({
  userId: fakeId(n),
  otx: `otx-${n}`,
  at,
  priceUsd,
  productId,
  periodDays: productId.includes("month") ? 30 : 365,
});
export const cancel = (n: number, at: string, cancelReason = "UNSUBSCRIBE", type = "CANCELLATION"): CancelEvent => ({
  userId: fakeId(n),
  otx: `otx-${n}`,
  at,
  type,
  cancelReason,
});
export const tag = (n: number, at: string, variant: string, source: string | null = "split"): ArmTag => ({ userId: fakeId(n), at, variant, source });
