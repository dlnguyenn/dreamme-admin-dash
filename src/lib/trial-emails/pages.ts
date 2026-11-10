/**
 * Small public HTML pages for email links (button hand-off, unsubscribe).
 * Users see these on their phone, so they carry DreamMe's look, not the DAD's.
 */
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const INK = "#1A3550";

export const APP_DEEP_LINK = "dreamme://";
export const APP_STORE_URL = "https://apps.apple.com/app/id6755569693";
export const PLAY_URL = "https://play.google.com/store/apps/details?id=com.dreamme.app";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function page(title: string, body: string, extraHead = ""): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>${extraHead}
<style>
body{margin:0;background:#FFFFFF;color:${INK};font:400 17px/1.5 ${FONT};}
main{max-width:420px;margin:0 auto;padding:48px 24px;text-align:center;}
h1{font:600 22px/1.3 ${FONT};margin:16px 0 8px;}
p{margin:0 0 20px;}
.btn{display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;font:600 17px ${FONT};padding:14px 28px;border-radius:12px;border:0;cursor:pointer;}
.small{font-size:14px;color:#4A5B6E;}
.small a{color:#4A5B6E;}
img{width:96px;height:auto;}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/** Button hand-off: counts the click (POST from script, so link scanners that only GET don't count) and opens the app. */
export function goPage(token: string): Response {
  const t = JSON.stringify(token);
  return page(
    "Opening DreamMe",
    `<img src="/email/sushi-waving.png" alt="">
<h1>Opening DreamMe…</h1>
<p>If nothing happens, tap the button.</p>
<p><a class="btn" href="${APP_DEEP_LINK}">Open DreamMe</a></p>
<p class="small">Not on this phone? Get it on the <a href="${APP_STORE_URL}">App Store</a> or <a href="${PLAY_URL}">Google Play</a>.</p>
<script>
(function(){
  try { fetch(location.pathname + "?t=" + encodeURIComponent(${t}), { method: "POST", keepalive: true }); } catch (e) {}
  setTimeout(function(){ location.href = ${JSON.stringify(APP_DEEP_LINK)}; }, 250);
})();
</script>`,
  );
}

export function unsubscribeConfirmPage(token: string): Response {
  return page(
    "Unsubscribe",
    `<img src="/email/sushi-heart.png" alt="">
<h1>Stop these emails?</h1>
<p>You won't get any more emails like this from DreamMe. Your account and everything you've logged stay just as they are.</p>
<form method="post" action="/api/trial-emails/unsubscribe?t=${encodeURIComponent(token)}">
<button class="btn" type="submit">Unsubscribe</button>
</form>`,
  );
}

export function unsubscribedPage(): Response {
  return page(
    "Unsubscribed",
    `<img src="/email/sushi-heart.png" alt="">
<h1>You're unsubscribed</h1>
<p>No more emails like this one. Thanks for giving DreamMe a try, and Sushi is still in the app whenever you want to check in.</p>`,
  );
}

export function badLinkPage(): Response {
  return page(
    "Link expired",
    `<h1>This link doesn't work anymore</h1>
<p>Open DreamMe on your phone, or reply to our email and we'll help.</p>
<p><a class="btn" href="${APP_DEEP_LINK}">Open DreamMe</a></p>`,
  );
}
