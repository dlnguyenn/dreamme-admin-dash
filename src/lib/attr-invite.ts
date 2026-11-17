/**
 * Personal invite links: https://go.dreamme.life/i/<code>.
 *
 * The DreamMe app's "Share DreamMe" card (vault wiki/share-app-card-design.md)
 * shares one link per user. Codes come from the consumer DB's invite_codes
 * table: 7 characters from an alphabet with no look-alikes (no 0/o, 1/l/i).
 * A tap logs an attr_clicks row with media_source 'invite' and the code, then
 * sends the friend to the store like the ad link. The install matcher ties
 * it to the friend's install. The Meta sender only sends media_source 'meta',
 * so invites never reach Meta.
 */
export const INVITE_CODE_RE = /^[a-hjkmnp-z2-9]{7}$/;

/** A valid code in canonical (lowercase) form, or null. */
export function normalizeInviteCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const code = raw.trim().toLowerCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}

export function inviteLinkUrl(code: string): string {
  return `https://go.dreamme.life/i/${code}`;
}
