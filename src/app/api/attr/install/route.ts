/**
 * First-party attribution — install ping ingest (phase 1 of the in-house
 * Appstack). The DreamMe app's attribution SDK POSTs here once per install
 * (retrying until acked, and again — with the full payload — when auth
 * links an app_user_id). Rows land in attr_installs (service-role only,
 * shared "DreamMe Internal" DB); phase 2 matches them to ad-link clicks,
 * phase 3 upgrades CAPI matching with the captured fbclid.
 *
 * Auth: dedicated static bearer token compared constant-time. Deliberately
 * NOT checkIngestAuth — its same-origin fallback is spoofable and this
 * route is internet-facing (the dash's rc-webhook precedent). The token
 * ships inside the app bundle, so it is abuse-limiting rather than secret:
 * worst case is junk rows in a table nothing renders unvalidated.
 *
 * IP and User-Agent are observed server-side and never trusted from the
 * client — they're half of the phase-2 click matching signal.
 *
 * Android builds also send `install_referrer` (Google Play) and
 * `meta_install_referrer` (the Facebook / Instagram app). Those are stored
 * raw, extracted into columns, and matched ahead of the IP (attr-referrer).
 * Decrypting Meta's payload needs META_INSTALL_REFERRER_KEY.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  InstallBody,
  constEq,
  clientIp,
  stripNul,
  upsertInstall,
  matchInstallNow,
  type InstallRow,
} from "@/lib/attr-installs";
import { META_REFERRER_KEY_ENV, resolveReferrers } from "@/lib/attr-referrer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const token = process.env.ATTR_SDK_TOKEN ?? "";
  if (!token) {
    // Unconfigured → 503 so the SDK marks itself off instead of retrying
    // forever (the SKAN collector's convention).
    return NextResponse.json({ error: "attribution ingest not configured" }, { status: 503 });
  }
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!constEq(presented, token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof InstallBody>;
  let rawBody: unknown;
  try {
    // A Play referrer is attacker-shaped text (anyone can craft a store
    // link); see stripNul for why a NUL must not reach the upsert.
    rawBody = stripNul(await req.json());
    body = InstallBody.parse(rawBody);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }

  // Android install referrers: the plain parts always extract; the Meta ad
  // ids need the decryption key (unset → they stay null and the daily
  // re-sweep fills them in once the key exists).
  const referrers = resolveReferrers(
    { install_referrer: body.install_referrer, meta_install_referrer: body.meta_install_referrer },
    process.env[META_REFERRER_KEY_ENV],
  );

  const row: InstallRow = {
    install_id: body.install_id,
    first_open_at: body.first_open_at,
    app_user_id: body.app_user_id ?? null,
    platform: body.platform ?? null,
    os_version: body.os_version ?? null,
    device_model: body.device_model ?? null,
    locale: body.locale ?? null,
    timezone: body.timezone ?? null,
    screen_w: body.screen_w ?? null,
    screen_h: body.screen_h ?? null,
    screen_scale: body.screen_scale ?? null,
    idfv: body.idfv ?? null,
    app_version: body.app_version ?? null,
    launch_url: body.launch_url ?? null,
    fbclid: body.fbclid ?? null,
    deferred_link: body.deferred_link ?? null,
    att_status: body.att_status ?? null,
    // Only a ping that carries a referrer writes the referrer columns, so
    // iOS and older Android builds send the same row as before this change
    // (and need no retry while the migration is unapplied). The SDK caches
    // what it read and re-sends it on every POST, so nothing needs nulling.
    ...(body.install_referrer || body.meta_install_referrer ? referrers.columns : {}),
    ip: clientIp(req),
    ua: req.headers.get("user-agent")?.slice(0, 512) ?? null,
    raw: rawBody as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };

  try {
    await upsertInstall(row);
    // Matching, inline while the click trail is freshest: an install
    // referrer decides outright, otherwise last-click over the IP.
    // Best-effort by contract (returns "skipped" on any error) — the ack
    // must never depend on it; the daily cron re-sweeps stragglers.
    const match = await matchInstallNow(
      {
        install_id: row.install_id,
        ip: row.ip,
        platform: row.platform,
        first_open_at: row.first_open_at,
        device_model: row.device_model,
        os_version: row.os_version,
        screen_scale: row.screen_scale,
        screen_w: row.screen_w,
        screen_h: row.screen_h,
        timezone: row.timezone,
        locale: row.locale,
        referrer: referrers.evidence,
      },
      referrers.columns,
    );
    return NextResponse.json({ ok: true, match });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
