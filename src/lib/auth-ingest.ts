function isSameOrigin(req: Request): boolean {
  try {
    const host = req.headers.get("host") ?? "";
    const origin = req.headers.get("origin") ?? "";
    const referer = req.headers.get("referer") ?? "";
    if (!host) return false;
    const ok = (u: string) => {
      if (!u) return false;
      try {
        return new URL(u).host === host;
      } catch {
        return false;
      }
    };
    return ok(origin) || ok(referer);
  } catch {
    return false;
  }
}

export function checkIngestAuth(req: Request): boolean {
  const secret = process.env.INGEST_TOKEN ?? "";
  const cron = process.env.CRON_SECRET ?? "";
  const header =
    req.headers.get("x-dreamme-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (secret !== "" && header === secret) return true;
  if (cron !== "" && header === cron) return true;
  // Allow same-origin calls from the dashboard UI (the app is itself
  // behind a shared-password gate).
  if (isSameOrigin(req)) return true;
  return false;
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
