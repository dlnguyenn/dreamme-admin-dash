/**
 * Server-only reads for the MMP tab: the one-row snapshot (plus Singular's
 * paid-conversion totals, migration 0100), the per-campaign comparison
 * (migration 0098) and the per-ad comparison (0099, 0100). All views are
 * service-role only.
 */
import { sbGet } from "@/lib/revenue-plan/db";
import {
  toAdRow,
  toCampaignRow,
  toSnapshot,
  type MmpAdRow,
  type MmpCampaignRow,
  type MmpSnapshot,
} from "./parity";

export async function fetchMmp(): Promise<{ snapshot: MmpSnapshot; campaigns: MmpCampaignRow[]; ads: MmpAdRow[] }> {
  const [snap, paid, campaigns, ads] = await Promise.all([
    sbGet<Record<string, unknown>[]>("internal", "mmp_snapshot?select=*&limit=1"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_singular_paid?select=*&limit=1"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_campaign_attribution?select=*"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_ad_attribution?select=*"),
  ]);
  if (!snap.length) throw new Error("mmp_snapshot returned no row");
  return {
    snapshot: toSnapshot({ ...snap[0], ...(paid[0] ?? {}) }),
    campaigns: campaigns.map(toCampaignRow),
    ads: ads.map(toAdRow),
  };
}
