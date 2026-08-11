# Singular (MMP) setup

Goal: answer **"how many free trials did each Meta campaign drive?"** — the
question neither `rc_ad_metrics_daily` (written with zero rows) nor the
first-party SKAN collector (decodes ~6% of postbacks) can answer today.

Singular becomes the primary MMP. The DIY SKAN collector
(`docs/skan-diy-attribution.md`) stays running as an independent cross-check.

## Prerequisites

- A Singular account with the iOS app registered. The SDK has shipped in
  DreamMe since v1.3.8; the `EXPO_PUBLIC_SINGULAR_SDK_*` keys live in **EAS**,
  not here.
- Meta Business Manager access to ad account `act_1575502753719515`.
- Admin on Meta app `1214186473920093` (needed for AMM below).

## Step 1 — Accept the Meta AMM terms (do this FIRST)

https://developers.facebook.com/advanced_mobile_measurement/terms

Advanced Mobile Measurement is what gives row-level attribution for ATT-denied
users. **It is not retroactive** — only users attributed *after* acceptance are
covered, and there is no backfill. Every day of delay is permanently lost
attribution data, so this goes before anything else even though nothing
technically depends on it.

## Step 2 — Register the events

Singular → **Settings → Events**. Add:

| Event | Kind | Notes |
| --- | --- | --- |
| `sng_start_trial` | standard | the number this whole doc exists for |
| `sng_subscribe` | standard | fires at trial start in our app, not at paid conversion |
| `sng_complete_registration` | standard | |
| `trial_qualified` | **custom** | survived 2h + willRenew |
| `trial_engaged` | **custom** | logged something in 24h — best trial→paid predictor |

Three things that bite here:

- **Custom events are never auto-added.** `trial_qualified` / `trial_engaged`
  are fired by the app but will land only in user-level logs — never in
  aggregated reports or the Reporting API's `cohort_metrics` — until they are
  added on this page by hand.
- **The page is capped at 12 events** on Free/Growth. We use 5 — but check
  what's already there first: newer Growth accounts get standard SDK events
  auto-added (up to 6 unique + 6 non-unique versions), so `sng_start_trial` /
  `sng_subscribe` may already be present and some slots already consumed.
  Don't add duplicates; don't assume 7 free slots.
- **Allow ~24h** before a newly defined event appears in reports. The sync will
  return zero rows until then, which is indistinguishable from "no spend".

## Step 3 — Connect Meta (two separate integrations, both required)

**Attribution:** Attribution → Partner Configuration → Facebook → paste app ID
`1214186473920093`. Set the click lookback window to match Meta's exactly —
mismatched windows are the single most common cause of "Singular and Meta
disagree" tickets.

**Cost:** Settings → Data Connectors → Facebook → *Connect with Facebook*,
signed in as a user with Business Manager asset access. Activate
`act_1575502753719515`.

Refresh cadence, per the current connector docs: **daily pulls cover the last
7 days of cost; Mondays pull 30 days back.** There is no documented initial
backfill — if months of historical Meta cost matter, ask Singular support
rather than assuming it appears. Consequence for our sync: within the 35-day
window, Meta *cost* for days 8–35 only refreshes weekly, while cohort trial
counts recompute on every run.

Then in **Meta Events Manager**, set Preferred Connection Method = **MMP**.

Finally, map each SDK event to its Meta conversion event in Partner
Configuration. **Event mapping is not retroactive** — do this before you care
about the data, not after.

## Step 4 — Paste into env

Singular → Developer Tools → API Keys. Add to `.env.local` **and** to the
Vercel project (Settings → Environment Variables, all environments):

```
SINGULAR_REPORTING_API_KEY=...
```

## Step 5 — Test the sync

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://dreamme-admin-dash.vercel.app/api/cron/sync-singular?days=7" | jq
```

Populated:

```json
{ "ok": true, "upserted": 84, "campaigns": 6, "trial_starts": 213,
  "cohort_period": "7d", "window": { "since": "...", "until": "..." },
  "unmapped_keys": [] }
```

Empty — expected until step 2 has had ~24h:

```json
{ "ok": true, "upserted": 0, "unmapped_keys": [...], "sample_raw": {...},
  "note": "no Singular rows returned — ..." }
```

### Read `unmapped_keys` on the first live run

The client's request side follows the documented API, but the **response** side
was written without ever seeing a real response. `mapSingularRows` reports every
key it did not consume rather than silently returning zeros. On the first real
run, check `unmapped_keys` and `sample_raw`: if the cohort metric came back under
a key shape we did not anticipate, that is where it shows up. Fix the candidate
lists in `src/lib/vendors/singular.ts`, update the fixture in
`tests/singular.test.ts`, and delete the PROVISIONAL notice at the top of the
client.

## How the data lands

```
Singular Reporting API  (async: create_async_report → poll → download_url)
  → src/lib/vendors/singular.ts   (chunks to ≤30d, resolves cohort event ids)
  → /api/cron/sync-singular       (17:00 UTC daily, re-upserts full 35d window)
  → singular_campaign_daily       (grain: source, campaign_id, date)
  → cross_network_cost_daily      (enriches the META arm's trial_starts)
  → singular_reconciliation       (vs RevenueCat truth)
```

**Why 17:00 UTC and not the 07:00 ad-sync cluster:** Singular's Meta cost
connector is only ready ~08:00 account-local. Consequence: `marketing-alerts`
at 07:45 UTC reads Singular data ~15h stale.

**Why the sync re-fetches 35 days every run:** cohort metrics are anchored to
the **install** date and recomputed on every report run — the row for install-day
D holds the trials those installs have started *as of now*. An incremental
"sync yesterday" design would freeze each day at its near-zero day-1 value
forever. See the header comment on the route.

## Reading the numbers honestly

`singular_reconciliation.singular_trial_coverage` is Singular's 35d trials ÷
RevenueCat's. It will never be 100% — Meta drives only a share of installs, and
organic / ASA / TikTok sit in the RC denominator but never in a
`source=facebook` report. Rough guide, assuming Meta drives ~half of installs:

| Coverage | Read |
| --- | --- |
| < 10% | something is broken — ATT fix didn't land, AMM not accepted, or events unmapped |
| 15–30% | plausible if cohort events cover only the ATT-opted-in slice. Rank with it; don't cost with it |
| 35–60% | the good outcome — consistent with AMM covering ATT-denied users |
| > 70% | suspicious, not success. Check for double-counting before believing it |

Two caveats that belong in any UI built on this:

- **Meta censors rows under 1000 impressions.** Small campaigns show gaps, not
  zeros. Do not render a gap as a zero.
- **Recent install-days are structurally immature.** A 7-day cohort on a
  2-day-old install day is 2 days of data. Exclude the trailing 7 days from any
  headline number or mark those rows visually.

## Open question for Singular support

Whether cohort events (`sng_start_trial`) are broken out per
`unified_campaign_id` for **ATT-denied** users, or only for the opted-in slice —
and whether accepting AMM changes that. Singular's own docs contradict each
other here: the attribution article describes user-level AMM data, while the
user-level-data FAQ still states Meta self-attributing installs are marked
Unattributed. The answer decides whether our trial number is a real count or a
lower bound, and it is what the dashboard's honesty disclaimer must say. Get it
in writing before building UA decisions on it.
