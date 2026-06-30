/**
 * Closed-loop RC→Meta audience sync (Module 4). Shared by the
 * /api/cron/refresh-audiences route, the CLI script, and the guarded Ads-MCP
 * tools so there's a single implementation.
 *
 * Pipeline each run:
 *   1. Pull active payers (non-relay, with entitlement tenure) from RevenueCat.
 *   2. Upsert them into rc_customer_snapshot as 'active'; flip prior-active-but-
 *      absent rows to 'lapsed' (the only churn signal RC v2 gives us — by diff).
 *   3. Build/refresh three Meta audiences from snapshot HASHES (we never persist
 *      raw email): suppression (= active subs), high-LTV seed (tenure > 60d) +
 *      its 1% lookalike, and win-back (= lapsed).
 *   4. Exclude the suppression audience from auto-discovered active prospecting
 *      ad sets.
 *
 * `dryRun` skips every Meta write (audience create/upload/remove + ad-set attach)
 * and only does read-only Meta discovery + our own snapshot/registry writes, so a
 * dry run is safe to point at production. Win-back is empty until a few runs
 * accumulate churn history. The Apple-relay majority can't email-match — these
 * audiences cover only the non-relay minority (lean on lookalikes + SKAN/CAPI).
 */

import {
  createCustomAudience,
  createLookalike,
  getActiveProspectingAdSets,
  hashEmailForMeta,
  removeEmailHashesFromAudience,
  setExcludedAudiencesOnAdSet,
  uploadEmailHashesToAudience,
} from "@/lib/vendors/meta-ads";
import {
  fetchActivePayersDetailed,
  type ActivePayerDetailed,
} from "@/lib/vendors/revenuecat";
import { resolveMetaToken } from "@/lib/meta-oauth";

// Read env lazily inside functions — top-level constants capture process.env
// before loadEnvConfig runs in CLI scripts (ESM imports hoist).
function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}
function serviceRole(): string {
  return (
    process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  );
}

const WINDOW_DAYS = 180;
const HIGH_LTV_TENURE_DAYS = 60; // active entitlement older than this = high-LTV proxy
const LOOKALIKE_RATIO = 0.01;
const LOOKALIKE_COUNTRY = "US";
const MIN_SEED_FOR_LOOKALIKE = 100; // Meta requires ≥100 matched seed users

export function audiencesConfigured(): boolean {
  return Boolean(supabaseUrl() && serviceRole());
}

// --- service-role PostgREST helpers ----------------------------------------
function svcHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = serviceRole();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sbUpsert(table: string, conflict: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const res = await fetch(`${supabaseUrl()}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: "POST",
      headers: svcHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`upsert ${table} failed: ${res.status} ${await res.text()}`);
  }
}

async function sbPatch(table: string, query: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: svcHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch ${table} failed: ${res.status} ${await res.text()}`);
}

async function sbSelect<T>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${table}?${query}`, {
    headers: svcHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`select ${table} failed: ${res.status}`);
  return res.json();
}

// --- registry --------------------------------------------------------------
interface RegistryRow {
  purpose: string;
  audience_id: string | null;
  kind: string | null;
  origin_audience_id: string | null;
  country: string | null;
  ratio: number | null;
  member_count: number | null;
  last_synced_at: string | null;
  note: string | null;
}

async function getRegistry(purpose: string): Promise<RegistryRow | null> {
  const rows = await sbSelect<RegistryRow>(
    "meta_audience_registry",
    `purpose=eq.${encodeURIComponent(purpose)}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

async function upsertRegistry(row: Partial<RegistryRow> & { purpose: string }): Promise<void> {
  await sbUpsert("meta_audience_registry", "purpose", [
    { ...row, updated_at: new Date().toISOString() },
  ]);
}

// --- snapshot --------------------------------------------------------------
export interface SnapshotResult {
  activeUpserted: number;
  lapsedFlipped: number;
}

/**
 * Upsert the current active payers as 'active', then flip any row that was
 * 'active' in a prior run but not seen this run to 'lapsed'. `runStartedAt` must
 * be captured before the upsert and used as the diff boundary.
 */
export async function upsertSnapshot(
  actives: ActivePayerDetailed[],
  runStartedAt: string,
): Promise<SnapshotResult> {
  const rows = actives.map((a) => ({
    customer_id: a.customerId,
    email_sha256: hashEmailForMeta(a.email),
    entitlement: a.entitlement,
    status: "active",
    starts_at: a.startsAtMs ? new Date(a.startsAtMs).toISOString() : null,
    expires_at: a.expiresAtMs ? new Date(a.expiresAtMs).toISOString() : null,
    last_active_at: runStartedAt,
    last_run_at: runStartedAt,
    became_lapsed_at: null,
    updated_at: runStartedAt,
    // first_active_at intentionally omitted → preserved on existing rows,
    // defaults to now() on insert.
  }));
  await sbUpsert("rc_customer_snapshot", "customer_id", rows);

  // Diff: previously-active rows not refreshed this run → lapsed.
  await sbPatch(
    "rc_customer_snapshot",
    `status=eq.active&last_run_at=lt.${encodeURIComponent(runStartedAt)}`,
    { status: "lapsed", became_lapsed_at: runStartedAt, updated_at: runStartedAt },
  );

  const flipped = await sbSelect<{ customer_id: string }>(
    "rc_customer_snapshot",
    `status=eq.lapsed&became_lapsed_at=eq.${encodeURIComponent(runStartedAt)}&select=customer_id`,
  );
  return { activeUpserted: rows.length, lapsedFlipped: flipped.length };
}

async function hashesWhere(query: string): Promise<string[]> {
  const rows = await sbSelect<{ email_sha256: string }>(
    "rc_customer_snapshot",
    `${query}&email_sha256=not.is.null&select=email_sha256&limit=200000`,
  );
  return rows.map((r) => r.email_sha256);
}

// --- audience membership sync ----------------------------------------------
export interface AudienceSyncResult {
  dryRun: boolean;
  runStartedAt: string;
  windowDays: number;
  snapshot: SnapshotResult;
  cohorts: { active: number; highLtv: number; lapsed: number; becameLapsedThisRun: number };
  audiences: Array<{
    purpose: string;
    audienceId: string | null;
    action: string; // 'reused' | 'would_create' | 'created' | 'skipped'
    added?: number;
    removed?: number;
    memberCount?: number;
    note?: string;
  }>;
  prospectingAdSets: Array<{ id: string; name: string }>;
  attach: Array<{ adsetId: string; name: string; action: string; error?: string }>;
  logs: string[];
}

/** Ensure a custom audience exists for a purpose (reuse from registry, or create). */
async function ensureCustomAudience(opts: {
  purpose: string;
  name: string;
  description: string;
  accountId: string;
  token: string;
  dryRun: boolean;
}): Promise<{ audienceId: string | null; action: string }> {
  const existing = await getRegistry(opts.purpose);
  if (existing?.audience_id) return { audienceId: existing.audience_id, action: "reused" };
  if (opts.dryRun) return { audienceId: null, action: "would_create" };
  const created = await createCustomAudience({
    accountId: opts.accountId,
    name: opts.name,
    description: opts.description,
    accessToken: opts.token,
  });
  await upsertRegistry({ purpose: opts.purpose, audience_id: created.id, kind: "custom" });
  return { audienceId: created.id, action: "created" };
}

/**
 * Run the full audience-sync pipeline. Set `dryRun` to skip all Meta writes
 * (only snapshot/registry + read-only Meta discovery happen).
 */
export async function runAudienceSync(opts: {
  dryRun: boolean;
  windowDays?: number;
  log?: (m: string) => void;
}): Promise<AudienceSyncResult> {
  const logs: string[] = [];
  const log = (m: string) => {
    logs.push(m);
    opts.log?.(m);
  };
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const runStartedAt = new Date().toISOString();
  const dryRun = opts.dryRun;

  if (!audiencesConfigured()) throw new Error("Supabase service role not configured");

  const meta = await resolveMetaToken();
  if (!meta) throw new Error("No Meta token — connect an account or set META_ACCESS_TOKEN");
  const { token, account } = meta;

  // 1. RC active payers
  log(`Pulling active payers from RevenueCat (${windowDays}d window)…`);
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const actives = await fetchActivePayersDetailed({ sinceMs, concurrency: 25, log });

  // 2. Snapshot + churn diff
  log(`Upserting snapshot (${actives.length} active)…`);
  const snapshot = await upsertSnapshot(actives, runStartedAt);
  log(`  ${snapshot.activeUpserted} active, ${snapshot.lapsedFlipped} flipped to lapsed.`);

  // 3. Cohort hashes from the snapshot
  const tenureCutoff = new Date(Date.now() - HIGH_LTV_TENURE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const activeHashes = await hashesWhere("status=eq.active");
  const highLtvHashes = await hashesWhere(`status=eq.active&starts_at=lt.${encodeURIComponent(tenureCutoff)}`);
  const lapsedHashes = await hashesWhere("status=eq.lapsed");
  const becameLapsedHashes = await hashesWhere(
    `status=eq.lapsed&became_lapsed_at=eq.${encodeURIComponent(runStartedAt)}`,
  );
  const cohorts = {
    active: activeHashes.length,
    highLtv: highLtvHashes.length,
    lapsed: lapsedHashes.length,
    becameLapsedThisRun: becameLapsedHashes.length,
  };
  log(
    `Cohorts — active ${cohorts.active}, high-LTV ${cohorts.highLtv}, lapsed ${cohorts.lapsed} (${cohorts.becameLapsedThisRun} new this run).`,
  );

  const audiences: AudienceSyncResult["audiences"] = [];

  // 3a. Suppression = current active subscribers
  {
    const { audienceId, action } = await ensureCustomAudience({
      purpose: "suppression_active",
      name: "DreamMe — Active Subscribers (suppression)",
      description: "Auto-synced active subscribers. Excluded from prospecting so we stop re-acquiring current subs.",
      accountId: account,
      token,
      dryRun,
    });
    let added = 0;
    let removed = 0;
    if (audienceId && !dryRun) {
      added = (await uploadEmailHashesToAudience({ audienceId, hashes: activeHashes, log, accessToken: token })).uploadedCount;
      if (becameLapsedHashes.length)
        removed = (await removeEmailHashesFromAudience({ audienceId, hashes: becameLapsedHashes, log, accessToken: token })).removedCount;
      await upsertRegistry({ purpose: "suppression_active", audience_id: audienceId, kind: "suppression", member_count: cohorts.active, last_synced_at: runStartedAt });
    }
    audiences.push({ purpose: "suppression_active", audienceId, action, added: dryRun ? cohorts.active : added, removed: dryRun ? cohorts.becameLapsedThisRun : removed, memberCount: cohorts.active });
  }

  // 3b. High-LTV seed + 1% lookalike
  let highLtvSeedId: string | null = null;
  {
    const { audienceId, action } = await ensureCustomAudience({
      purpose: "high_ltv_seed",
      name: `DreamMe — High-LTV Payers (tenure ≥ ${HIGH_LTV_TENURE_DAYS}d)`,
      description: `Active subscribers retained ≥ ${HIGH_LTV_TENURE_DAYS}d. Lookalike seed.`,
      accountId: account,
      token,
      dryRun,
    });
    highLtvSeedId = audienceId;
    let added = 0;
    if (audienceId && !dryRun) {
      added = (await uploadEmailHashesToAudience({ audienceId, hashes: highLtvHashes, log, accessToken: token })).uploadedCount;
      if (becameLapsedHashes.length)
        await removeEmailHashesFromAudience({ audienceId, hashes: becameLapsedHashes, log, accessToken: token });
      await upsertRegistry({ purpose: "high_ltv_seed", audience_id: audienceId, kind: "custom", member_count: cohorts.highLtv, last_synced_at: runStartedAt });
    }
    audiences.push({ purpose: "high_ltv_seed", audienceId, action, added: dryRun ? cohorts.highLtv : added, memberCount: cohorts.highLtv });
  }
  {
    const existing = await getRegistry("lookalike_high_ltv");
    if (existing?.audience_id) {
      audiences.push({ purpose: "lookalike_high_ltv", audienceId: existing.audience_id, action: "reused", note: "Meta auto-refreshes the LAL from its seed." });
    } else if (cohorts.highLtv < MIN_SEED_FOR_LOOKALIKE) {
      audiences.push({ purpose: "lookalike_high_ltv", audienceId: null, action: "skipped", note: `seed ${cohorts.highLtv} < ${MIN_SEED_FOR_LOOKALIKE} min — Meta needs ≥100 matched.` });
    } else if (dryRun || !highLtvSeedId) {
      audiences.push({ purpose: "lookalike_high_ltv", audienceId: null, action: "would_create", note: `1% ${LOOKALIKE_COUNTRY} LAL from high-LTV seed.` });
    } else {
      const lal = await createLookalike({ accountId: account, originAudienceId: highLtvSeedId, name: `DreamMe — LAL 1% ${LOOKALIKE_COUNTRY} (High-LTV)`, ratio: LOOKALIKE_RATIO, country: LOOKALIKE_COUNTRY, accessToken: token });
      await upsertRegistry({ purpose: "lookalike_high_ltv", audience_id: lal.id, kind: "lookalike", origin_audience_id: highLtvSeedId, country: LOOKALIKE_COUNTRY, ratio: LOOKALIKE_RATIO, last_synced_at: runStartedAt });
      audiences.push({ purpose: "lookalike_high_ltv", audienceId: lal.id, action: "created" });
    }
  }

  // 3c. Win-back = lapsed (grows over time)
  {
    const { audienceId, action } = await ensureCustomAudience({
      purpose: "winback_lapsed",
      name: "DreamMe — Win-back (lapsed subscribers)",
      description: "Lapsed subscribers (derived by snapshot diff). Retarget with win-back creative.",
      accountId: account,
      token,
      dryRun,
    });
    let added = 0;
    if (audienceId && !dryRun) {
      if (lapsedHashes.length)
        added = (await uploadEmailHashesToAudience({ audienceId, hashes: lapsedHashes, log, accessToken: token })).uploadedCount;
      // drop anyone currently active again
      if (activeHashes.length)
        await removeEmailHashesFromAudience({ audienceId, hashes: activeHashes, log, accessToken: token });
      await upsertRegistry({ purpose: "winback_lapsed", audience_id: audienceId, kind: "custom", member_count: cohorts.lapsed, last_synced_at: runStartedAt });
    }
    audiences.push({ purpose: "winback_lapsed", audienceId, action, added: dryRun ? cohorts.lapsed : added, memberCount: cohorts.lapsed, note: cohorts.lapsed === 0 ? "empty until churn history accumulates" : undefined });
  }

  // 4. Discover active prospecting ad sets + attach suppression
  log("Discovering active prospecting ad sets…");
  let prospecting: Awaited<ReturnType<typeof getActiveProspectingAdSets>> = [];
  try {
    prospecting = await getActiveProspectingAdSets({ accountId: account, accessToken: token });
    log(`  ${prospecting.length} active app-promo ad set(s).`);
  } catch (e) {
    log(`  discovery failed: ${(e as Error).message.slice(0, 160)}`);
  }
  const suppressionId = audiences.find((a) => a.purpose === "suppression_active")?.audienceId ?? null;
  const attach: AudienceSyncResult["attach"] = [];
  for (const ad of prospecting) {
    if (dryRun || !suppressionId) {
      attach.push({ adsetId: ad.id, name: ad.name, action: dryRun ? "would_attach" : "skipped (no suppression audience)" });
      continue;
    }
    try {
      await setExcludedAudiencesOnAdSet({ adsetId: ad.id, excludedAudienceIds: [suppressionId], accessToken: token });
      attach.push({ adsetId: ad.id, name: ad.name, action: "attached" });
    } catch (e) {
      attach.push({ adsetId: ad.id, name: ad.name, action: "error", error: (e as Error).message.slice(0, 160) });
    }
  }

  return {
    dryRun,
    runStartedAt,
    windowDays,
    snapshot,
    cohorts,
    audiences,
    prospectingAdSets: prospecting.map((a) => ({ id: a.id, name: a.name })),
    attach,
    logs,
  };
}

/** Attach a suppression audience to discovered (or explicit) prospecting ad sets. For the MCP tool. */
export async function attachSuppression(opts: {
  dryRun: boolean;
  adsetIds?: string[];
  log?: (m: string) => void;
}): Promise<{ suppressionAudienceId: string | null; attach: AudienceSyncResult["attach"] }> {
  const meta = await resolveMetaToken();
  if (!meta) throw new Error("No Meta token");
  const reg = await getRegistry("suppression_active");
  const suppressionId = reg?.audience_id ?? null;
  if (!suppressionId) return { suppressionAudienceId: null, attach: [] };

  let targets: Array<{ id: string; name: string }>;
  if (opts.adsetIds?.length) {
    targets = opts.adsetIds.map((id) => ({ id, name: id }));
  } else {
    targets = (await getActiveProspectingAdSets({ accountId: meta.account, accessToken: meta.token })).map((a) => ({ id: a.id, name: a.name }));
  }

  const attach: AudienceSyncResult["attach"] = [];
  for (const t of targets) {
    if (opts.dryRun) {
      attach.push({ adsetId: t.id, name: t.name, action: "would_attach" });
      continue;
    }
    try {
      await setExcludedAudiencesOnAdSet({ adsetId: t.id, excludedAudienceIds: [suppressionId], accessToken: meta.token });
      attach.push({ adsetId: t.id, name: t.name, action: "attached" });
    } catch (e) {
      attach.push({ adsetId: t.id, name: t.name, action: "error", error: (e as Error).message.slice(0, 160) });
    }
  }
  return { suppressionAudienceId: suppressionId, attach };
}
