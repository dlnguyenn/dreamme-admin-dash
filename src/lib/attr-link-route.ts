/**
 * Shared by the ad link (src/app/l/route.ts, which documents the design)
 * and the invite link (src/app/i/[code]/route.ts).
 */
import { randomInt, randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { parseClickParams, parseClickUa, platformFromUa, resolveFbp, storeUrlFor } from "@/lib/attr-match";
import { insertClick } from "@/lib/attr-installs";
import { classifyBot } from "@/lib/attr-bots";
import { renderLinkPage, type LinkPageInput } from "@/lib/attr-link-page";

/** What differs between the ad link (/l) and the invite link (/i/<code>). */
export interface LinkClickOptions {
  /** Forced media_source; the ad link reads it from ?src= (default meta). */
  mediaSource?: string;
  /** The inviter's code (invite links only). */
  inviteCode?: string;
  /** Canonical public URL for og:url. */
  pageUrl?: string;
  preview?: LinkPageInput["preview"];
}

/** The shared click handler: log the click (unless a bot) after the
 *  response, and return the store-redirect page. */
export async function handleLinkClick(req: Request, opts: LinkClickOptions = {}): Promise<Response> {
  const url = new URL(req.url);
  const ua = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || null;
  const platform = platformFromUa(ua);
  const landing = platform === "android" ? "play_store" : "app_store";
  const bot = classifyBot(ua, ip);
  // Minted here, not by the DB default, so the page can beacon its own
  // device signals back against this row (see attr-installs applyBeacon).
  const clickId = randomUUID();
  const fingerprint = parseClickUa(ua);
  const { fbp, setCookie } = resolveFbp(
    req.headers.get("cookie"),
    url.host,
    Date.now(),
    randomInt(1_000_000_000, 2_147_483_647),
  );

  if (!bot) {
    waitUntil((async () => {
      try {
        const params = parseClickParams(url.searchParams);
        await insertClick({
          click_id: clickId,
          clicked_at: new Date().toISOString(),
          ip: ip && ip.length <= 64 ? ip : null,
          ua,
          platform_hint: platform,
          media_source: opts.mediaSource ?? params.media_source ?? "meta",
          campaign_id: params.campaign_id,
          campaign_name: params.campaign_name,
          adset_id: params.adset_id,
          adset_name: params.adset_name,
          ad_id: params.ad_id,
          ad_name: params.ad_name,
          fbclid: params.fbclid,
          fbp,
          placement: params.placement,
          site_source_name: params.site_source_name,
          creator_code: opts.inviteCode ? null : params.creator_code,
          invite_code: opts.inviteCode ?? null,
          landing,
          raw: Object.fromEntries(url.searchParams.entries()),
          model: fingerprint.model ?? null,
          os_version: fingerprint.os_version ?? null,
          screen_scale: fingerprint.screen_scale ?? null,
          screen_w: fingerprint.screen_w ?? null,
          screen_h: fingerprint.screen_h ?? null,
          lang: fingerprint.lang ?? null,
        });
      } catch {
        // a lost click log must never surface to the user mid-redirect
      }
    })());
  }

  // Android: the Play URL carries this click's id as the install referrer,
  // which the app reads back at first open (an exact match, no IP needed).
  return new Response(renderLinkPage({ storeUrl: storeUrlFor(platform, clickId), clickId, pageUrl: opts.pageUrl, preview: opts.preview }), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Set-Cookie": setCookie,
      // surfaced for debugging only; never influences the body
      "X-Attr-Bot": bot ?? "none",
    },
  });
}
