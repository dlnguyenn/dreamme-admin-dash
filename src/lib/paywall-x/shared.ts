/**
 * Paywall X test (`paywall_close_x`): names and small helpers the page and the
 * server both use. PURE and client-safe: nothing here may import server code.
 *
 * The test: on the onboarding paywall, control keeps the "… or meet Sushi
 * first!" text link; arm `close_x` replaces it with an X in the top corner.
 * The app records one `experiment_assignments` row per exposed user in the
 * consumer database (DreamMe app PR #35).
 */

export const PAYWALL_X_KEY = "paywall_close_x";

/** `?tab=experiments&readout=paywall_close_x` opens the readout. */
export const PAYWALL_X_READOUT_URL = `/?tab=experiments&readout=${PAYWALL_X_KEY}`;

/** Nobody can have been exposed before the app change existed. */
export const PAYWALL_X_EARLIEST_DAY = "2026-11-13";

export type PaywallXArm = "control" | "close_x";
export type PaywallXSource = "revenuecat" | "split";
export type PaywallXPlatform = "ios" | "android" | "other";

export const ARMS: PaywallXArm[] = ["control", "close_x"];

export const ARM_LABELS: Record<PaywallXArm, string> = {
  control: "Control (text link)",
  close_x: "close_x (X in the corner)",
};

export const SOURCE_LABELS: Record<PaywallXSource, string> = {
  revenuecat: "RevenueCat experiment",
  split: "App 50/50 split",
};

export const PLATFORM_LABELS: Record<PaywallXPlatform, string> = {
  ios: "iOS",
  android: "Android",
  other: "Other",
};

/** `variant` as written by the app; anything else is not an arm. */
export function normalizeArm(v: string | null | undefined): PaywallXArm | null {
  const s = (v ?? "").trim().toLowerCase();
  return s === "control" || s === "close_x" ? s : null;
}

/** The app writes salt `rc` when RevenueCat picked the arm, the split's salt otherwise. */
export function sourceFromSalt(salt: string | null | undefined): PaywallXSource {
  return (salt ?? "").trim().toLowerCase() === "rc" ? "revenuecat" : "split";
}

/** The RevenueCat attribute `paywall_close_x_source` (revenuecat | split). */
export function normalizeSource(v: string | null | undefined): PaywallXSource | null {
  const s = (v ?? "").trim().toLowerCase();
  return s === "revenuecat" || s === "split" ? s : null;
}

export function normalizePlatform(v: string | null | undefined): PaywallXPlatform {
  const s = (v ?? "").trim().toLowerCase();
  return s === "ios" || s === "android" ? s : "other";
}

/** One user's arm, for the per-user chip. */
export interface PaywallXUserArm {
  arm: PaywallXArm;
  source: PaywallXSource | null;
  platform: PaywallXPlatform | null;
  exposedAt: string | null;
  /** Where the arm came from: the exposure row, or (no row) a RevenueCat attribute. */
  from: "assignment" | "revenuecat";
}

export function chipLabel(a: PaywallXUserArm): string {
  return `X test: ${a.arm}`;
}

export function chipTitle(a: PaywallXUserArm): string {
  const parts = [
    `Paywall X test (${PAYWALL_X_KEY}), arm ${a.arm}`,
    a.source ? `assigned by ${SOURCE_LABELS[a.source]}` : null,
    a.exposedAt ? `exposed ${a.exposedAt.slice(0, 10)}` : null,
    a.from === "revenuecat" ? "from the RevenueCat attribute (no exposure row)" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Does this Experiments-log entry describe the X test? True when the key
 * `paywall_close_x` appears as a word in its title, what-changed, metric,
 * links or vault page. Lets the entry link to the readout without a new
 * column on experiment_log.
 */
export function mentionsPaywallX(e: {
  title?: string | null;
  what_changed?: string | null;
  primary_metric?: string | null;
  links?: string | null;
  vault_page?: string | null;
}): boolean {
  const re = new RegExp(`(^|[^a-z0-9_])${PAYWALL_X_KEY}([^a-z0-9_]|$)`, "i");
  return [e.title, e.what_changed, e.primary_metric, e.links, e.vault_page].some((t) => !!t && re.test(t));
}
