/**
 * Source groups and the money constants shared by the April-plan panels.
 * PURE and client-safe.
 *
 * Source = the onboarding answer to "how did you hear about us?"
 * (consumer users.referral_source), copied nightly into user_sources so
 * rc_events can join on app_user_id. The groups are the plan's three channels.
 * Definitions and every reference value come from the vault page
 * wiki/revenue-100k-question.md (Decision section, 2026-11-04).
 */

export type SourceGroup = "meta" | "tiktok" | "other";

export const SOURCE_GROUPS: SourceGroup[] = ["meta", "tiktok", "other"];

export const GROUP_LABEL: Record<SourceGroup, string> = {
  meta: "Meta (FB + IG)",
  tiktok: "TikTok / clippers",
  other: "Other organic",
};

/**
 * Meta = facebook + instagram; clipper/TikTok = tiktok; other organic =
 * everything else, including a skipped question. The option list belongs to
 * the app (youtube appeared unannounced on 2026-08-07), so unknown values fall
 * through to "other" rather than breaking.
 */
export function sourceGroup(referralSource: string | null | undefined): SourceGroup {
  const s = (referralSource ?? "").trim().toLowerCase();
  if (s === "facebook" || s === "instagram") return "meta";
  if (s === "tiktok") return "tiktok";
  return "other";
}

/**
 * Gross to net. Apple pays at the Small Business 15% rate (confirmed from
 * Chase deposits, 83-85% of RC's net-of-tax revenue), plus ~1% tax: x0.84.
 * Never use RC's proceeds field: RC assumes ~29.5%, which reads ~21% low.
 */
export const NET_FACTOR = 0.84;

/** 12-month net value per trial, trials onboarded Aug 24 - Oct 11 (vault). */
export const REFERENCE_NET = { meta: 15.3, nonMeta: 18.2 } as const;

/** Meta's cost per extra trial, measured three ways in October (vault): $19-24. */
export const META_CPT_RANGE = { low: 19, high: 24 } as const;
