/**
 * The HTML the ad link (/l) serves — pure, pinned by tests/attr-link-page.test.ts.
 *
 * Why a page and not a 302 (2026-10-02): the link used to answer every
 * request, crawlers included, with `302 → apps.apple.com`. Meta's crawler
 * followed it, Meta stamped every active creative with
 * object_store_url = the App Store (a field we never set), and the Facebook
 * app then opened the App Store natively on ad taps — our server never saw
 * them (0 Facebook-app rows for 70 Facebook link clicks, while Instagram,
 * which loads the URL in its in-app browser, logged fine).
 *
 * So the destination is now revealed only to things that run JavaScript:
 * the raw HTML carries Open Graph tags and a "DreamMe" blurb, and the store
 * URL travels base64-encoded, decoded and followed on the client. Every
 * requester gets the SAME markup — no UA- or IP-conditional content, so
 * nothing here is cloaking in Meta's sense; non-JS fetchers simply see the
 * page as written. Click logging stays server-side in the route's after().
 */

export interface LinkPageInput {
  /** Final destination (App Store / Play) — never appears verbatim in the HTML. */
  storeUrl: string;
  /** Canonical public URL of the link, for og:url. */
  pageUrl?: string;
  /** This request's attr_clicks row, so the page can beacon its device
   *  signals back (POST /l/b). Validated as a UUID; empty disables the beacon. */
  clickId?: string;
  /** Link-preview text and picture (iMessage, WhatsApp, Android). Defaults
   *  to the ad link's text with no picture. Used by the /i invite link. */
  preview?: { title: string; description: string; imageUrl?: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OG = {
  title: "DreamMe — Your new GLP-1 best friend",
  description: "Track your shots, meals, side effects, and progress with Sushi by your side.",
  siteName: "DreamMe",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function encodeStoreUrl(url: string): string {
  return Buffer.from(url, "utf8").toString("base64");
}

/** The invite link's preview: what a friend sees under the shared message. */
export const INVITE_PREVIEW = {
  title: "Join me on DreamMe",
  description: "Track your shots, meals, side effects, and progress with Sushi by your side.",
  imageUrl: "https://go.dreamme.life/invite-preview.png",
};

export function renderLinkPage({ storeUrl, pageUrl = "https://go.dreamme.life/l", clickId = "", preview }: LinkPageInput): string {
  const encoded = encodeStoreUrl(storeUrl);
  const og = { title: preview?.title ?? OG.title, description: preview?.description ?? OG.description };
  const image = preview?.imageUrl
    ? `\n<meta property="og:image" content="${escapeHtml(preview.imageUrl)}">\n<meta name="twitter:image" content="${escapeHtml(preview.imageUrl)}">`
    : "";
  const beaconId = UUID_RE.test(clickId) ? clickId : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(og.title)}</title>
<meta property="og:title" content="${escapeHtml(og.title)}">
<meta property="og:description" content="${escapeHtml(og.description)}">
<meta property="og:site_name" content="${escapeHtml(OG.siteName)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(pageUrl)}">${image}
<meta name="twitter:card" content="${preview?.imageUrl ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escapeHtml(og.title)}">
<meta name="twitter:description" content="${escapeHtml(og.description)}">
<style>
html,body{margin:0;height:100%;background:#fff7f9;color:#2b1a22;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 24px;box-sizing:border-box}
h1{font-size:28px;margin:0 0 8px}
p{margin:0 0 24px;opacity:.8}
a{display:inline-block;padding:14px 28px;border-radius:999px;background:#e8558a;color:#fff;text-decoration:none;font-weight:600}
a[hidden]{display:none}
</style>
</head>
<body>
<main>
<h1>DreamMe</h1>
<p id="msg">Opening the App Store…</p>
<a id="go" hidden rel="noopener">Open the App Store</a>
</main>
<script>
(function(){
  var u;
  try { u = atob("${encoded}"); } catch (e) { return; }
  var a = document.getElementById("go");
  a.href = u; a.hidden = false;
  document.getElementById("msg").textContent = "If the store didn't open, tap below.";
  // Device signals for the click<->install matcher (same markup for every
  // requester; sendBeacon never delays the redirect). Screen is in CSS points.
  try {
    var c = "${beaconId}";
    if (c && navigator.sendBeacon) {
      var wk = (navigator.userAgent.match(/AppleWebKit\\/([\\d.]+)/) || [])[1];
      var p = { c: c, w: screen.width, h: screen.height, dpr: window.devicePixelRatio,
        lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
      if (wk) p.wk = wk;
      navigator.sendBeacon("/l/b", JSON.stringify(p));
    }
  } catch (e) {}
  location.replace(u);
})();
</script>
</body>
</html>
`;
}
