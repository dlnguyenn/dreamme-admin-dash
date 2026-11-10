/**
 * Public: unsubscribe from trial emails. GET shows a confirm button (so link
 * scanners can't unsubscribe people); POST does it. POST is also the RFC 8058
 * one-click target named in the List-Unsubscribe-Post header. Adds the
 * address to email_suppressions, which every user email should honour.
 */
import { readToken } from "@/lib/trial-emails/core";
import { consumerUsers, getAssignment, patchAssignment, suppress } from "@/lib/trial-emails/db";
import { badLinkPage, unsubscribeConfirmPage, unsubscribedPage } from "@/lib/trial-emails/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t");
  const tok = readToken(t);
  if (!tok || tok.purpose !== "unsub") return badLinkPage();
  return unsubscribeConfirmPage(t!);
}

export async function POST(req: Request) {
  const tok = readToken(new URL(req.url).searchParams.get("t"));
  if (!tok || tok.purpose !== "unsub") return badLinkPage();
  const row = await getAssignment(tok.originalTransactionId);
  if (row) {
    const user = (await consumerUsers([row.app_user_id])).get(row.app_user_id);
    if (user?.email) await suppress(user.email, row.app_user_id);
    if (!row.unsubscribed_at) await patchAssignment(tok.originalTransactionId, { unsubscribed_at: new Date().toISOString() });
  }
  return unsubscribedPage();
}
