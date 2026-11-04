/**
 * True monthly P&L for the April plan. PURE.
 *
 *   gross    rc_events charges minus refunds (matches RC "Revenue" within 0.5%)
 *   proceeds gross x0.84 (Apple's real 15% + ~1% tax), never RC's proceeds
 *   - Meta   ad_insights_daily spend
 *   - creators  Chase "Creator / UGC payouts" (Whop), "Contractors / UGC"
 *               (Wise etc.) and "People payments (VERIFY)"; the hand-entered
 *               clipper weeks stand in only for months Chase doesn't cover
 *   - tools  Chase AI, infra, data, content tooling, analytics and software
 *   = contribution
 * Chase's own "Ad spend - Meta" rows are left out (Meta comes from the ad
 * account, which is the same money). Everything else Chase sees (legal, bank
 * fees, uncategorised, the $24k Syndigo debit) is "other costs", shown under
 * the contribution, not inside it.
 */
import { NET_FACTOR } from "./sources";

export const CREATOR_CATEGORIES = ["Creator / UGC payouts", "Contractors / UGC", "People payments (VERIFY)"];
export const TOOL_CATEGORIES = ["AI / LLM APIs", "Infra / hosting", "Data / scraping", "Content tooling", "Analytics / SaaS", "Software / other"];
const COUNTED_ELSEWHERE = ["Ad spend - Meta"];

export interface ChaseMonth {
  month: string; // YYYY-MM
  categories: { category: string; total: number }[];
}

export interface PnlMonth {
  month: string;
  /** The month is still running. */
  partial: boolean;
  gross: number;
  proceeds: number;
  meta: number;
  creators: number | null;
  creatorsBasis: "chase" | "manual" | "none";
  tools: number | null;
  other: number | null;
  /** Proceeds minus Meta only: always available. */
  afterMeta: number;
  /** Proceeds minus Meta, creators and tools; null without Chase coverage. */
  contribution: number | null;
  chaseCovered: boolean;
}

export function buildPnl(
  months: string[],
  current: string,
  revenue: Map<string, number>,
  meta: Map<string, number>,
  chase: ChaseMonth[],
  manualCreators: Map<string, number>,
): PnlMonth[] {
  const byMonth = new Map(chase.map((c) => [c.month, c]));
  return months.map((m) => {
    const gross = revenue.get(m) ?? 0;
    const proceeds = gross * NET_FACTOR;
    const metaSpend = meta.get(m) ?? 0;
    const c = byMonth.get(m);
    const sumOf = (names: string[]) => (c ? c.categories.filter((x) => names.includes(x.category)).reduce((s, x) => s + x.total, 0) : 0);
    let creators: number | null = null;
    let creatorsBasis: PnlMonth["creatorsBasis"] = "none";
    if (c) {
      creators = sumOf(CREATOR_CATEGORIES);
      creatorsBasis = "chase";
    } else if (manualCreators.has(m)) {
      creators = manualCreators.get(m)!;
      creatorsBasis = "manual";
    }
    const tools = c ? sumOf(TOOL_CATEGORIES) : null;
    const other = c
      ? c.categories
          .filter((x) => !CREATOR_CATEGORIES.includes(x.category) && !TOOL_CATEGORIES.includes(x.category) && !COUNTED_ELSEWHERE.includes(x.category))
          .reduce((s, x) => s + x.total, 0)
      : null;
    const afterMeta = proceeds - metaSpend;
    return {
      month: m,
      partial: m === current,
      gross,
      proceeds,
      meta: metaSpend,
      creators,
      creatorsBasis,
      tools,
      other,
      afterMeta,
      contribution: c ? afterMeta - (creators ?? 0) - (tools ?? 0) : null,
      chaseCovered: !!c,
    };
  });
}
