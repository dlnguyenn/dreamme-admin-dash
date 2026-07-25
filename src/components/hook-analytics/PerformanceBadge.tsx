type PerformanceClass = "flop" | "mid" | "hit";

// Porcelain: soft fill + AA -text color per semantic family.
const TONE: Record<
  PerformanceClass,
  { bg: string; fg: string; label: string }
> = {
  hit: {
    bg: "var(--success-soft)",
    fg: "var(--success-text)",
    label: "HIT",
  },
  mid: {
    bg: "var(--neutral-soft)",
    fg: "var(--neutral-text)",
    label: "MID",
  },
  flop: {
    bg: "var(--danger-soft)",
    fg: "var(--danger-text)",
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
        padding: "2px 7px",
        borderRadius: 6,
        background: tone.bg,
        color: tone.fg,
        font: "700 9.5px var(--font-ui)",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {tone.label}
      {ratioLabel && (
        <span style={{ opacity: 0.8, fontWeight: 600 }}>{ratioLabel}</span>
      )}
    </span>
  );
}
