/**
 * Checks for /api/app-analytics (server only): a report must match the shape
 * in app-analytics.ts before it is stored or sent to the tab. Kept apart so
 * the client bundle doesn't pull in zod.
 */
import { z } from "zod";
import { COLUMN_KINDS, EVIDENCE, TONES } from "@/lib/app-analytics";

const short = z.string().trim().min(1).max(200);
const long = z.string().trim().min(1).max(2000);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "use lowercase letters, digits and dashes");
const num = z.number().finite();

const status = z.object({ status: short, tone: z.enum(TONES) }).strict();

const stat = z.object({ label: short, value: short, note: short.optional() }).strict();

const base = {
  title: short.optional(),
  caption: long.optional(),
  half: z.boolean().optional(),
};

const series = z.object({ label: short, values: z.array(num).min(1).max(60) }).strict();

const sameLength = (xs: unknown[], all: { values: number[] }[]) =>
  all.every((s) => s.values.length === xs.length);

const block = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("stats"), items: z.array(stat).min(1).max(6) }).strict(),
  z
    .object({
      ...base,
      type: z.literal("findings"),
      items: z
        .array(
          z
            .object({
              title: short,
              body: long.optional(),
              evidence: z.enum(EVIDENCE).optional(),
              status: status.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("bars"),
      unit: z.string().max(12).optional(),
      max: num.optional(),
      rows: z
        .array(
          z
            .object({ label: short, value: num, note: short.optional(), emphasis: z.boolean().optional() })
            .strict(),
        )
        .min(1)
        .max(30),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("table"),
      columns: z
        .array(
          z
            .object({
              label: short,
              kind: z.enum(COLUMN_KINDS).optional(),
              unit: z.string().max(12).optional(),
              max: num.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(8),
      rows: z.array(z.array(z.union([z.string().max(600), num, z.null(), status])).max(8)).min(1).max(200),
      footnote: long.optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("columns"),
      unit: z.string().max(12).optional(),
      max: num.optional(),
      xLabel: short.optional(),
      x: z.array(z.string().trim().min(1).max(24)).min(1).max(31),
      series: z.array(series).min(1).max(6),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("trends"),
      unit: z.string().max(12).optional(),
      max: num.optional(),
      xLabel: short.optional(),
      x: z.array(num).min(2).max(60),
      series: z.array(series).min(1).max(12),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("series"),
      unit: z.string().max(12).optional(),
      days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")).min(2).max(400),
      series: z
        .array(
          z
            .object({
              label: short,
              values: z.array(num.nullable()).min(2).max(400),
              smooth: z.array(num.nullable()).min(2).max(400).optional(),
              headline: z.string().trim().max(24).optional(),
              note: short.optional(),
              unit: z.string().max(12).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(16),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("compare"),
      sides: z
        .array(z.object({ label: short, note: short.optional(), stats: z.array(stat).min(1).max(8) }).strict())
        .min(2)
        .max(3),
      footnote: long.optional(),
    })
    .strict(),
  z.object({ ...base, type: z.literal("note"), text: long }).strict(),
  z
    .object({
      ...base,
      type: z.literal("list"),
      items: z.array(z.object({ text: long, status: status.optional() }).strict()).min(1).max(30),
    })
    .strict(),
]);

const section = z
  .object({ id, title: short, intro: long.optional(), blocks: z.array(block).min(1).max(20) })
  .strict();

const view = z
  .object({ id, label: z.string().trim().min(1).max(24), intro: long.optional(), sections: z.array(section).min(1).max(12) })
  .strict();

/** The first thing wrong with a report's cross-field rules, or null. */
export function shapeProblem(report: z.infer<typeof ReportShape>): string | null {
  const viewIds = new Set<string>();
  for (const v of report.views) {
    if (viewIds.has(v.id)) return `two views share the id "${v.id}"`;
    viewIds.add(v.id);
    for (const s of v.sections) {
      for (const b of s.blocks) {
        const where = `${v.id} > ${s.id}`;
        if (b.type === "table") {
          const bad = b.rows.findIndex((r) => r.length !== b.columns.length);
          if (bad >= 0) return `${where}: table row ${bad + 1} has ${b.rows[bad].length} cells for ${b.columns.length} columns`;
          for (let c = 0; c < b.columns.length; c++) {
            const kind = b.columns[c].kind ?? "text";
            for (let r = 0; r < b.rows.length; r++) {
              const cell = b.rows[r][c];
              if (cell === null) continue;
              const ok =
                kind === "status"
                  ? typeof cell === "object"
                  : kind === "text"
                    ? typeof cell === "string" || typeof cell === "number"
                    : typeof cell === "number";
              if (!ok) return `${where}: row ${r + 1}, column "${b.columns[c].label}" does not hold a ${kind} value`;
            }
          }
        }
        if (b.type === "series") {
          const off = b.series.find((s) => s.values.length !== b.days.length || (s.smooth && s.smooth.length !== b.days.length));
          if (off) return `${where}: "${off.label}" needs one value per day (${b.days.length})`;
        }
        if ((b.type === "columns" || b.type === "trends") && !sameLength(b.x, b.series)) {
          return `${where}: every series needs one value per x position (${b.x.length})`;
        }
      }
    }
  }
  return null;
}

const ReportShape = z
  .object({
    version: z.literal(1),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
    sources: long,
    refresh: long.optional(),
    views: z.array(view).min(1).max(8),
  })
  .strict();

export const Report = ReportShape.superRefine((report, ctx) => {
  const problem = shapeProblem(report);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

/** POST body: the report, plus an optional title and who made it. */
export const CreateSnapshot = z
  .object({
    title: z.string().trim().max(200).optional(),
    created_by: z.string().trim().max(120).optional(),
    payload: Report,
  })
  .strict();

/** One readable line for the first thing wrong, for an error message. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid report";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
