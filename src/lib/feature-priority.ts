import type { FeatureRequestPriority } from "@/lib/types";

/** Highest first: also the sort order of the Feature Requests table. */
export const PRIORITY_OPTIONS: FeatureRequestPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export const PRIORITY_LABELS: Record<FeatureRequestPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_TONES: Record<
  FeatureRequestPriority,
  "attention" | "accent" | "warning" | "neutral"
> = {
  urgent: "attention",
  high: "accent",
  medium: "warning",
  low: "neutral",
};

/** Sort rank; unset sorts after Low. */
export function priorityRank(p: FeatureRequestPriority | null | undefined): number {
  const i = p ? PRIORITY_OPTIONS.indexOf(p) : -1;
  return i === -1 ? PRIORITY_OPTIONS.length : i;
}

export function isPriority(v: unknown): v is FeatureRequestPriority {
  return PRIORITY_OPTIONS.includes(v as FeatureRequestPriority);
}
