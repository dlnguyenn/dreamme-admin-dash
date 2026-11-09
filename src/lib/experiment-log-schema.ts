/**
 * Request validation for /api/experiments (server only). Kept apart from
 * experiment-log.ts so the client bundle doesn't pull in zod schemas twice.
 */
import { z } from "zod";
import {
  EXPERIMENT_AREAS,
  EXPERIMENT_KINDS,
  EXPERIMENT_OWNERS,
  EXPERIMENT_STATUSES,
} from "@/lib/experiment-log";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD").nullable();
const text = (max: number) => z.string().max(max);
const optId = z.string().trim().max(200).nullable();

export const EntryFields = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(EXPERIMENT_KINDS as [string, ...string[]]),
  area: z.enum(EXPERIMENT_AREAS as [string, ...string[]]),
  status: z.enum(EXPERIMENT_STATUSES as [string, ...string[]]),
  hypothesis: text(4000),
  what_changed: text(4000),
  has_control: z.boolean(),
  start_date: date,
  end_date: date,
  primary_metric: text(500),
  result: text(8000),
  decision: text(4000),
  rc_experiment_id: optId,
  vault_page: optId,
  links: text(4000),
  handoff_id: optId,
  owner: z.enum(EXPERIMENT_OWNERS as [string, ...string[]]).nullable(),
});

/** POST: title is required, everything else defaults. */
export const CreateEntry = EntryFields.partial().required({ title: true });

/** PATCH: any subset, but not nothing. */
export const PatchEntry = EntryFields.partial().refine((v) => Object.keys(v).length > 0, {
  message: "empty patch",
});

/** Blank optional ids and owner become null rather than "". */
export function cleanEntry<T extends Record<string, unknown>>(v: T): T {
  const out: Record<string, unknown> = { ...v };
  for (const k of ["rc_experiment_id", "vault_page", "handoff_id", "owner", "start_date", "end_date"]) {
    if (typeof out[k] === "string" && (out[k] as string).trim() === "") out[k] = null;
  }
  return out as T;
}
