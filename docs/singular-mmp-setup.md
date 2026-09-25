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

| Event | Kind | Register when |
| --- | --- | --- |
| `sng_start_trial` | standard | now — the number this whole doc exists for |
| `sng_subscribe` | standard | now — fires at trial start in our app, not at paid conversion |
| `sng_complete_registration` | standard | now |
| `trial_qualified` | **custom** | **only after the app release that fires it** |
| `trial_engaged` | **custom** | **only after the app release that fires it** |

⚠️ **Do not try to register the two custom events until a production build that
fires them is live.** Singular's "Add Custom Event" dropdown only lists raw SDK
events it has *actually received*, so before that build ships there is nothing
to map them to — and creating the mapping anyway burns two of the 12 slots
pointing at a nonexistent source.

The exact literal strings the app sends (case-sensitive) are `trial_qualified`
and `trial_engaged` — see `lib/singular.ts` in `davngu28/DreamMe`. They were
added in the ATT/SKAN PR (#21); confirm that has merged **and** shipped in a
released build before touching this page for them.

Nothing else in this runbook depends on those two. They add trial *quality*
(did the trial survive 2h / did the user log anything in 24h — the best
trial→paid predictor we have); the headline per-campaign trial count comes from
`sng_start_trial`, which is a standard event and already flowing.

Three things that bite here:

- **Custom events are never auto-added.** Once `trial_qualified` /
  `trial_engaged` are shipping, they will land only in user-level logs — never
  in aggregated reports or the Reporting API's `cohort_metrics` — until they
  are added on this page by hand. (But see the warning above: they cannot be
  added at all until a build that fires them is live.)
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

Then map each SDK event to its Meta conversion event in Partner Configuration.
**Event mapping is not retroactive** — do this before you care about the data,
not after.

### Preferred Connection Method — LAST, and not required for our goal

Only after the event mapping above is in place: Meta Events Manager → the iOS
app dataset → set Preferred Connection Method = **MMP**.

**Order matters.** This tells Meta to prefer the MMP as the source of app
events. Setting it before Singular is actually forwarding mapped events points
Meta at a source that has nothing to send, and risks disrupting the working
RC→Meta CAPI path that currently supplies Meta's trial signal for optimization
(see `docs/attribution-handoff.md` for how hard-won that path was).

**It is also not required for the trial-per-campaign number.** That number is
read out of Singular's Reporting API, which depends on the partner
configuration, the data connector, and the registered events — none of which
care about this setting. Preferred Connection Method governs which source
*Meta* optimizes on. So if this screen is broken or blocked, it does not block
the pipeline; carry on and come back.

Treat flipping it as a deliberate decision about whether Meta should optimize
on Singular's signal instead of RevenueCat's CAPI feed — not as a checkbox.

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

### The trials-per-campaign reality (measured 2026-08-12)

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
