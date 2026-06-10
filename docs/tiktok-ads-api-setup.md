# TikTok Marketing API setup

One-time setup so the dashboard cron can pull TikTok ad insights and surface
Spark Ad performance on `/creatives`. ~30 minutes of dashboard clicking.

## Prerequisites

- TikTok Ads Manager account with the DreamMe advertiser configured.
- TikTok for Business account (separate from personal TikTok — sign up at
  https://business.tiktok.com if needed).

## Step 1 — Create a TikTok for Business developer app

1. Visit https://business-api.tiktok.com/portal.
2. Sign in with the same TikTok for Business account that owns the
   advertiser.
3. Apps → **Create an App** → fill in:
   - **App name:** `DreamMe Admin Sync` (or anything; internal only).
   - **App description:** "Internal dashboard for ad-performance reporting."
   - **Company / business URL:** dreamme.app
   - **Redirect URI:** can be any URL you control — `https://dreamme.app/oauth`
     is fine even if no handler exists; we won't use the OAuth flow.
4. **Scopes** (request all three; minimum required for read-only sync):
   - Ad Account Management — Read
   - Reporting — Read
   - Audience Management — Read (used by `/identity/info/` for Spark Ad
     creator names)
5. Submit. Apps are usually auto-approved for read scopes; allow up to a
   business day if it goes to manual review.

## Step 2 — Generate an access token

Once the app is approved:

1. App detail → **Access tokens** tab → **Create token**.
2. Choose the advertiser account (DreamMe).
3. TikTok generates a long-lived access token (~1 year expiry — note the
   expiry date alongside `META_ACCESS_TOKEN` in your password manager).
4. Copy the token.

## Step 3 — Find your advertiser_id

1. TikTok Ads Manager → top-right → click the account chip → Settings.
2. **Advertiser ID** is a 19-digit number.
3. Copy it.

## Step 4 — Paste into env

Add to `.env.local` AND to Vercel project settings (Settings → Environment
Variables, all environments):

```
TIKTOK_ADS_ACCESS_TOKEN=<your token from step 2>
TIKTOK_ADVERTISER_ID=<your 19-digit ID from step 3>
```

## Step 5 — Test the sync

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/sync-tiktok-ads?days=35"
```

Expected response when no ads are running yet:
```json
{ "ok": true, "upserted": 0, "note": "no TikTok ad rows returned ..." }
```

Once your first Spark Ad goes live:
```json
{ "ok": true, "upserted": 17, "spark_rows": 3, "window": { ... } }
```

Then refresh `/creatives` and toggle to the TikTok view.

## Troubleshooting

- **`code: 40105`** — invalid token. Regenerate per Step 2.
- **`code: 40010`** — wrong advertiser_id. Confirm the ID matches the
  account that owns your ads.
- **`code: 40104`** — rate-limited. The client auto-retries; ignore unless
  it persists.
- **Token expiry** — when the cron starts returning 40105 in production
  (typically ~12 months in), regenerate the token; no other config change
  required.

## When you start running Spark Ads

In TikTok Ads Manager when creating the ad: Identity → **Use TikTok account
to deliver Spark Ads** → request authorization from the persona (Spark
code is shared in-app). This causes `identity_type` to be `AUTH_CODE` and
the dashboard detects + badges the ad as Spark with the creator's
`@username`.
