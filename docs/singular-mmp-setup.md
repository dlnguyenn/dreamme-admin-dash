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

## Step 6 — Paid conversions: RevenueCat → Singular (added 2026-11-05)

Without this, Singular only sees trial starts (the app's SDK events), so it can
rank ads on trials but not on who pays. RevenueCat's built-in Singular
integration sends each trial conversion, with revenue, server-to-server.
Singular ties it to the install its SDK already attributed, so it shows up per
campaign, ad set and ad. No app release is needed: RevenueCat already holds the
identifiers it uses (`$idfa` and `$idfv` on ~98% of iOS events, `$gpsAdId` on
Android).

**Done 2026-11-05:** the RevenueCat integration is saved and Active, with the
six required events named `rc_initial_purchase`, `rc_trial_started`,
`rc_trial_converted`, `rc_trial_cancelled`, `rc_renewal`, `rc_cancellation`,
gross revenue, and no sandbox key. This Singular account's events date from
2026-06-29 to 2026-07-01, so it predates the v2-only cutoff below.

1. **Singular → Developer Tools → SDK Integration → SDK Keys:** copy the
   production **SDK key** (not the reporting API key and not the secret).
2. **RevenueCat → Integrations → Attribution → Singular:**
   paste the SDK key. Leave the sandbox key empty, so test purchases never
   reach Singular.
   - **Event names:** give every event an `rc_` prefix, so they never collide
     with the app SDK's `sng_start_trial` / `sng_subscribe`. The one that
     matters is **Trial converted → `rc_trial_converted`**; the DAD's sync
     looks for that name.
   - **Revenue:** choose **gross** (RevenueCat's proceeds assume a 30% store
     fee; DreamMe pays 15%).
   - Leave Singular's "Reject IAP without Receipt" off.
3. **Singular → Settings → Events → Add Custom Event:** name it
   `rc_trial_converted` and map it to the raw event of the same name. Custom
   events never reach aggregated reports or the Reporting API until they are
   registered here, and the page holds 12 on our plan (8 used before this).
   **Order matters:** the mapping list only offers raw events Singular has
   already received, so this step can only be done after RevenueCat has sent
   the first `rc_trial_converted` (step 2 live, then a trial converting; about
   one an hour). Before that the list shows "No options" and Save stays off.
4. **Wait a day**, then run the sync (step 5). The response now carries
   `resolved_conversion_event_id` (null until step 3 has taken) and
   `paid_conversions`. Conversions are counted over a 14-day cohort, because a
   trial converts about 7 days after it starts.

Checks if conversions stay at zero:
- RevenueCat → a converted customer → **Customer History** shows a Singular
  delivery row, with Singular's reason if it was rejected.
- `invalid api version: v1` means this Singular account accepts only the newer
  v2 API, which needs the Singular device ID (SDID) set on each RevenueCat
  customer. That needs an app change: pass the SDID from the Singular SDK to
  RevenueCat (`setSingularDeviceID`, RevenueCat iOS SDK 5.87.0+ / Android
  10.19.0+). RevenueCat's docs say accounts created on or after 2026-07-15 are
  v2-only.
- Stripe (web) purchases are not sent by this integration.

Where it shows: the MMP tab (Summary → "By ad set and ad", Trial-to-paid
column; Parity → "Paid conversions to Singular").

### Response shape: confirmed live (2026-08-12)

The first live runs settled every open question about the response. Rows carry
`start_date`/`end_date` (no `date`); `source` is cased (`"Facebook"` — the
mapper lowercases it, and MUST: the cased value once leaked through the 4th
UNION arm as a phantom channel and double-counted $11.3k into the blended CAC);
cohort columns are keyed by the **bare auto-generated event id**, revenue by
bare `revenue`; `custom_installs` equals `tracker_installs` on this account
(the network count lives in `adn_installs`). The `unmapped_keys` / `sample_raw`
/ resolved-event-id diagnostics stay in the route so any future drift announces
itself.

### Correction (2026-11-05): trials were never zero, the mapper dropped them

Each cohort value arrives as an object keyed by period, e.g.
`"fdf7c893…": { "7d": 3 }`, not as a bare number. `mapSingularRows` read that
as a number, got NaN and stored 0, so `trial_starts` and `subscribes` were 0
for every row while Singular was reporting them. `cohortNum` now unwraps it
(pinned by a test on a real row). By then `tracker_installs` had also grown to
about 2,800 a month on SCALING iOS, so the 1.6% figure below is out of date.
Still open: `adn_cost` and `adn_installs` have been null since October, which
points at the Facebook data connector needing a reconnect in Singular.

### The trials-per-campaign reality (measured 2026-08-12, superseded above)

The cohort columns resolve and map correctly — **and their values are genuinely
zero**. Device-level attribution is the constraint: `tracker_installs` is ~1.6%
of `adn_installs` (44 vs 2,674 over 35d), consistent with the ~3% ATT opt-in
measured in Singular's UI, and cohort events only break out per campaign for
that attributed slice. This is the empirical answer to the support question
below, pending their written confirmation. The sequence that changes it:

1. **Ship the ATT-at-launch release** (davngu28/DreamMe#21) — raises the
   attributable slice ~3% → ~10%.
2. **AMM accrual** — terms accepted 2026-08-11, non-retroactive; watch
   `tracker_installs` trend in the days after.
3. Until then the dashboard is not blind: `cross_network_cost_daily`'s meta arm
   falls back to Meta-network trials (`trial_source='network'`).

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
