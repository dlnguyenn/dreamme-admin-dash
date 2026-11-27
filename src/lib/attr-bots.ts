/**
 * Bot / crawler classification for the ad link (/l) — pure, pinned by
 * tests/attr-bots.test.ts.
 *
 * Why this exists (2026-10-02 incident): the first 48h of the EAC web
 * campaign put ~600 rows in attr_clicks, of which 23 were real taps. The
 * rest were Meta's link crawler (facebookexternalhit, hundreds of fetches
 * per ad) and Meta's ad-review checkers, which hit the rendered ad URL
 * (with fbclid!) from Meta's own IP space while spoofing ordinary iPhone /
 * Android / Windows Chrome user agents — a UA filter alone cannot see them,
 * so the IP ranges matter. Nothing from Meta's network is ever a tap.
 *
 * Verdicts are reasons, not booleans, so a caller can log or report them;
 * null means "looks like a person".
 */

export type BotReason = "meta_crawler" | "bot_ua" | "meta_ip";

/** Meta's own crawlers — documented at developers.facebook.com/docs/sharing/webmasters/crawler. */
const META_CRAWLER_RE = /facebookexternalhit|facebookcatalog|meta-external|facebookbot/i;

/** Everything else that announces itself: link-preview bots, search
 *  crawlers, HTTP libraries, headless browsers. */
const BOT_UA_RE =
  /\b(bot|crawler|spider|preview|fetch(er)?)\b|Applebot|Googlebot|bingbot|Discordbot|Twitterbot|Slackbot|WhatsApp|TelegramBot|LinkedInBot|Pinterest|python|aiohttp|curl\/|wget\/|Go-http-client|okhttp|HeadlessChrome|PhantomJS|Lighthouse|GTmetrix|Dataprovider/i;

/**
 * Meta's public IPv4 ranges (AS32934), the set its crawlers and ad-review
 * fetchers come from. Static on purpose — a DNS/whois lookup in the click
 * path would add latency and a failure mode to an ad tap. Refresh from
 * `whois -h whois.radb.net -- '-i origin AS32934'` when Meta grows.
 */
export const META_IPV4_CIDRS: readonly string[] = [
  "31.13.24.0/21",
  "31.13.64.0/18",
  "45.64.40.0/22",
  "57.141.0.0/20",
  "57.141.16.0/21",
  "57.141.24.0/23",
  "57.144.0.0/14",
  "66.220.144.0/20",
  "69.63.176.0/20",
  "69.171.224.0/19",
  "74.119.76.0/22",
  "102.132.96.0/19",
  "103.4.96.0/22",
  "129.134.0.0/16",
  "147.75.208.0/20",
  "157.240.0.0/16",
  "163.70.128.0/17",
  "173.252.64.0/18",
  "179.60.192.0/22",
  "185.60.216.0/22",
  "185.89.216.0/22",
  "199.201.64.0/22",
  "204.15.20.0/22",
];

/** Meta's IPv6 allocations (whole /32s), matched by text prefix. */
const META_IPV6_PREFIXES = ["2a03:2880:", "2a03:2887:", "2c0f:ec00:", "2401:db00:", "2620:0:1c", "2620:10d:c0"];

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

const PARSED_CIDRS: Array<[net: number, mask: number]> = META_IPV4_CIDRS.map((c) => {
  const [ip, bits] = c.split("/");
  const n = ipv4ToInt(ip) ?? 0;
  const b = Number(bits);
  const mask = b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0;
  return [(n & mask) >>> 0, mask];
});

/** True for an address inside Meta's published ranges (v4 or v6). */
export function isMetaIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) {
    return PARSED_CIDRS.some(([net, mask]) => ((v4 & mask) >>> 0) === net);
  }
  const lower = ip.trim().toLowerCase();
  return META_IPV6_PREFIXES.some((p) => lower.startsWith(p));
}

/** Null = plausibly a person; otherwise why we think it is not. The
 *  crawler check comes first so Meta's own fetches are labelled as such
 *  even when they also come from Meta IPs. */
export function classifyBot(ua: string | null | undefined, ip: string | null | undefined): BotReason | null {
  if (ua && META_CRAWLER_RE.test(ua)) return "meta_crawler";
  if (!ua || BOT_UA_RE.test(ua)) return "bot_ua";
  if (isMetaIp(ip)) return "meta_ip";
  return null;
}

export function isBot(ua: string | null | undefined, ip: string | null | undefined): boolean {
  return classifyBot(ua, ip) !== null;
}
