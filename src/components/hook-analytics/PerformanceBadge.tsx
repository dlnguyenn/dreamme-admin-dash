type PerformanceClass = "flop" | "mid" | "hit";

const TONE: Record<
  PerformanceClass,
  { bg: string; fg: string; label: string }
> = {
  hit: {
    bg: "color-mix(in oklab, var(--p-emma) 18%, transparent)",
    fg: "var(--p-emma)",
    label: "HIT",
  },
  mid: {
    bg: "var(--surface-2)",
    fg: "var(--ink-3)",
    label: "MID",
  },
  flop: {
    bg: "color-mix(in oklab, var(--accent) 14%, transparent)",
    fg: "var(--accent)",
    label: "FLOP",
  },
};

export function PerformanceBadge({
  performanceClass,
  ratio,
  title,
}: {
  performanceClass: PerformanceClass | null;
  ratio: number | null;
  title?: string;
}) {
  if (!performanceClass) return null;
  const tone = TONE[performanceClass];
  const ratioLabel =
    ratio == null
      ? null
      : ratio >= 10
        ? `${ratio.toFixed(0)}×`
        : `${ratio.toFixed(2)}×`;
  return (
    <span
      title={title ?? `Persona-relative performance: ${ratioLabel ?? tone.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 6,
        background: tone.bg,
        color: tone.fg,
        fontSize: 9,
        fontFamily: "var(--font-geist-mono), monospace",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {tone.label}
      {ratioLabel && (
        <span style={{ opacity: 0.7, fontWeight: 500 }}>{ratioLabel}</span>
      )}
    </span>
  );
}
