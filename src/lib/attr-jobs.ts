/**
 * Attribution moved from outlier to the DAD (2026-11-16). While both apps
 * carry the matcher and the Meta sender, only one may run them, or the same
 * trial could be sent to Meta twice in a race. The DAD's copies stay idle
 * until ATTR_JOBS_ENABLED=1 is set on its Vercel project, in the same
 * cutover step that removes outlier's two crons and repoints the pg_cron URL.
 * A dry run (?dry_run=1) is always allowed: it sends nothing.
 */
export function attrJobsEnabled(): boolean {
  return (process.env.ATTR_JOBS_ENABLED ?? "").trim() === "1";
}
