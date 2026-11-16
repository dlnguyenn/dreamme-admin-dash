/**
 * The ad link — attribution phase 2's front door, served publicly as
 * https://go.dreamme.life/l (domain CNAMEs to this Vercel project; works
 * identically on outlier-snowy.vercel.app/l meanwhile).
 *
 * One canonical link serves EVERY ad: Meta URL macros carry the identity, so
 * there is no per-ad link management. The ad's website URL is:
 *
 *   https://go.dreamme.life/l?src=meta&c={{campaign.id}}&cn={{campaign.name}}
 *     &as={{adset.id}}&asn={{adset.name}}&a={{ad.id}}&an={{ad.name}}
 *     &pl={{placement}}&ss={{site_source_name}}
 *
 * (Meta auto-appends fbclid.) Creator rev-share links add &creator=<code>.
 * Every response also (re)sets a first-party _fbp cookie, logged with the
 * click so CAPI events can carry fbp next to fbc.
 *
 * Response: a tiny HTML page that redirects to the store client-side (see
 * attr-link-page for why it is no longer a 302 — Meta's crawler followed the
 * 302, learned the App Store destination, and Facebook started opening the
 * store natively, skipping this server). The same page goes to everyone;
 * only the click LOG is conditional: known crawlers / bots / Meta-network
 * fetchers are not written to attr_clicks (attr-bots). Logging happens in
 * waitUntil (@vercel/functions), post-response; the DAD's Next 15.0 has no stable after(). Public by design (an ad link cannot
 * carry secrets); the SKAN-collector precedent: validate, cap, store raw.
 */
import { handleLinkClick } from "@/lib/attr-link-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: Request) {
  return handleLinkClick(req);
}
