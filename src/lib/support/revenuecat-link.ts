/**
 * Support Inbox — deep link from a resolved thread into the customer's
 * RevenueCat profile.
 *
 * RC's dashboard customer page is /customers/<project id>/<app user id>,
 * and public.users.id IS the RC app_user_id (see resolve-user.ts), so the
 * sidebar can link straight to the live subscription record instead of
 * making you paste the id into RC's search box.
 *
 * The project id lives in server env (REVENUECAT_PROJECT_ID) and rides down
 * with the thread detail payload, which keeps this a real anchor — hoverable,
 * copyable, middle-clickable — rather than a redirect route.
 */
const RC_DASHBOARD = "https://app.revenuecat.com";

export function revenueCatCustomerUrl(
  projectId: string | null | undefined,
  appUserId: string | null | undefined,
): string | null {
  const project = projectId?.trim();
  // Anonymous ids carry "$RCAnonymousID:..." and emails carry "@" — both
  // need encoding to survive the path segment.
  const user = appUserId?.trim();
  if (!project || !user) return null;
  return `${RC_DASHBOARD}/customers/${encodeURIComponent(project)}/${encodeURIComponent(user)}`;
}
