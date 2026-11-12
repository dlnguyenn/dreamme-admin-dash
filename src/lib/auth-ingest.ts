import { devBypassActive, getRequestAccount, type DadAccount } from "./dad-session";

function headerToken(req: Request): string {
  return (
    req.headers.get("x-dreamme-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

/** Scripts, n8n and crons: the ingest token or the cron secret. */
export function checkServerToken(req: Request): boolean {
  const secret = process.env.INGEST_TOKEN ?? "";
  const cron = process.env.CRON_SECRET ?? "";
  const header = headerToken(req);
  if (secret !== "" && header === secret) return true;
  if (cron !== "" && header === cron) return true;
  return false;
}

/**
 * Every DAD API route's gate: a server token, or a signed-in person or Claude
 * session (any role). The old "same origin" fallback is gone: an Origin header
 * can be faked by anyone, so it never proved the caller was the dashboard.
 */
export function checkIngestAuth(req: Request): boolean {
  if (checkServerToken(req)) return true;
  if (getRequestAccount(req)) return true;
  return devBypassActive(req);
}

/** Like checkIngestAuth, but a signed-in viewer is refused. */
export function checkAdminAuth(req: Request): boolean {
  if (checkServerToken(req)) return true;
  if (getRequestAccount(req)?.role === "admin") return true;
  return devBypassActive(req);
}

/** The signed-in account for this request (null for tokens and strangers). */
export function requestAccount(req: Request): DadAccount | null {
  const a = getRequestAccount(req);
  if (a) return a;
  if (devBypassActive(req)) return { kind: "dev", name: "localhost", role: "admin" };
  return null;
}

export function checkCronAuth(req: Request): boolean {
  const cron = process.env.CRON_SECRET ?? "";
  if (!cron) return false;
  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret") ??
    "";
  return header === cron;
}
