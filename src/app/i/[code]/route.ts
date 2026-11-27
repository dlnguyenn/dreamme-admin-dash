/**
 * The invite link, https://go.dreamme.life/i/<code> (see src/lib/attr-invite).
 * Same page and click log as the ad link (/l), with media_source forced to
 * 'invite' and a picture preview for messaging apps. An unknown or malformed
 * code still sends the friend to the store; the click is logged without a code.
 */
import { handleLinkClick } from "@/lib/attr-link-route";
import { INVITE_PREVIEW } from "@/lib/attr-link-page";
import { inviteLinkUrl, normalizeInviteCode } from "@/lib/attr-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeInviteCode((await params).code);
  return handleLinkClick(req, {
    mediaSource: "invite",
    inviteCode: code ?? undefined,
    pageUrl: code ? inviteLinkUrl(code) : "https://go.dreamme.life/i",
    preview: INVITE_PREVIEW,
  });
}
