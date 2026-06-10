# iOS attribution → RevenueCat handoff spec

**Audience:** the iOS engineer (or a separate Claude session pointed at the
iOS repo).
**Goal:** every trial in RevenueCat carries the Meta `campaign_id`,
`adset_id`, `ad_id`, and `ad_name` of the install that produced it.
**Side effect:** also fixes the long-standing CAPI-bridge gap (n8n
`trial_qualified` events are currently routed to the *web* dataset because
the iOS SDK never fires `fb_mobile_complete_registration` with attribution).
One iOS PR closes both holes.

## Three pre-flight items that don't need iOS code (do these first)

These take 30 minutes total in dashboards. They give immediate value
even before the Swift work below ships.

### 1. Enable Meta AEM (Aggregated Event Measurement)
Meta Business Manager → Events Manager → your iOS app dataset →
**Aggregated Event Measurement** → Configure. Rank the 8 priority
events in this order:
1. Subscribe (the conversion that matters most for ad-bid optimization)
2. StartTrial
3. AddPaymentInfo
4. CompleteRegistration
5. InitiateCheckout
6. ViewContent
7. AddToCart
8. Search

AEM runs in parallel with SKAdNetwork and works for ATT-allowed users
*and* gives ad-level resolution. Without it, SKAN alone gives campaign-
level resolution at best. Free, instant; nothing to install.

### 2. Connect RC → Meta CAPI in the RevenueCat dashboard
RC Settings → Integrations → Meta Ads → Connect. Authorize against
Business Manager; pick the `act_1575502753719515` ad account and the
iOS pixel. Map RC events: `INITIAL_PURCHASE` → Purchase,
`RENEWAL` → Subscribe, `TRIAL_STARTED` → StartTrial,
`TRIAL_CONVERTED` → Subscribe. RC starts pushing real downstream
conversion signal to Meta's auto-bidder → better automatic budget
allocation, no app code needed.

### 3. Disable client-side Meta SDK auto-logging (one line of Swift)
Once Item 2 is on, the iOS SDK and RC→Meta CAPI will both fire
purchase events, causing **double-counting in Meta's optimization**.
Add this once during FB SDK init:

```swift
Settings.shared.isAutoLogAppEventsEnabled = false
```

(Already-fired duplicate events are fine — Meta dedupes by event_id
when both paths send it.)

## Why this matters

I queried RevenueCat (`projc9e74a6c`) on 2026-05-15 with `trial_conversion_rate`
segmented by `attribution_source` over the last 30 days:

| Segment            | Trial Starts |
|--------------------|--------------|
| **No Attribution** | 1,530.5      |
| All other          | 0            |

100% of trials are unattributed. RevenueCat already supports per-ad LTV,
trial-conversion, payback, churn — it just has nothing to segment by. The
admin dashboard's `/creatives` view today shows blended estimates with an
asterisk on every per-ad column. Once this lands, those asterisks become
real measurements with **no dashboard code change** — the cron at
`/api/cron/sync-revenuecat` already pulls the segmented chart and upserts
to `rc_ad_metrics_daily`; today it writes 0 rows because every value lands
in the "No Attribution" bucket and gets filtered out.

## What to ship in the iOS app

After Facebook SDK init in `application(_:didFinishLaunchingWithOptions:)`,
fetch install attribution and forward it to RevenueCat:

```swift
import FBSDKCoreKit
import RevenueCat

// Inside AppDelegate.application(_:didFinishLaunchingWithOptions:)
ApplicationDelegate.shared.application(application, didFinishLaunchingWithOptions: launchOptions)

AppLinkUtility.fetchDeferredAppLink { url, error in
    DispatchQueue.main.async {
        let attr = MetaInstallAttribution.resolve(url: url)
        Self.attachAttribution(attr)
    }
}

// MARK: - Attach attribution
private static func attachAttribution(_ attr: MetaInstallAttribution.Resolved) {
    // Built-in RC attribution slots — these populate the chart segments
    // (attribution_campaign / attribution_ad_group / attribution_ad / etc).
    Purchases.shared.attribution.setMediaSource("facebook")
    Purchases.shared.attribution.setCampaign(attr.campaignId)   // pass IDs, not names — easier to join
    Purchases.shared.attribution.setAdGroup(attr.adsetId)
    Purchases.shared.attribution.setAd(attr.adId)
    Purchases.shared.attribution.setCreative(attr.creativeId ?? "")

    // Custom attributes — keep the human-readable names + raw IDs for ops.
    Purchases.shared.attribution.setAttributes([
        "meta_campaign_id":   attr.campaignId,
        "meta_campaign_name": attr.campaignName ?? "",
        "meta_adset_id":      attr.adsetId,
        "meta_adset_name":    attr.adsetName ?? "",
        "meta_ad_id":         attr.adId,
        "meta_ad_name":       attr.adName ?? "",
        "fbc":                attr.fbc ?? "",
        "fbp":                attr.fbp ?? "",
    ])

    // Same payload, fired as the iOS app event so the FB Pixel stops mis-
    // attributing the n8n trial_qualified event to the web dataset.
    AppEvents.shared.logEvent(.completedRegistration, parameters: [
        "fb_campaign_id": attr.campaignId,
        "fb_adset_id":    attr.adsetId,
        "fb_ad_id":       attr.adId,
    ])
}
```

### Resolving `MetaInstallAttribution`

Three sources, in priority order — first match wins:

1. **Click-through install (deferred deep link)**
   `AppLinkUtility.fetchDeferredAppLink` returns a URL with `fbclid` and
   any `utm_*` params we set on the ad's destination URL. Parse and lift.
2. **ATT-allowed install (rare post-iOS-14.5)**
   If `ATTrackingManager.trackingAuthorizationStatus == .authorized`, the FB
   SDK's `Settings.shared.appID` flow fills in install referrer with full
   ad-level granularity.
3. **SKAN postback (the majority case)**
   Listen to SKAdNetwork conversion postbacks via `FBAEMReporter`. SKAN
   gives `campaign_id` and a coarse "source app ID" only — not ad-level.
   That's still ~10× better than today's "No Attribution".

```swift
struct MetaInstallAttribution {
    struct Resolved {
        let campaignId: String
        let campaignName: String?
        let adsetId: String
        let adsetName: String?
        let adId: String
        let adName: String?
        let creativeId: String?
        let fbc: String?  // facebook click ID — lift from fbclid query param
        let fbp: String?  // facebook browser ID — generated client-side
    }

    static func resolve(url: URL?) -> Resolved {
        // 1. Deep-link path
        if let url, let resolved = parseDeepLink(url) { return resolved }
        // 2. SKAN / FBAEM
        if let resolved = parseFBAEM() { return resolved }
        // 3. Empty (organic install)
        return Resolved(campaignId: "", campaignName: nil, adsetId: "",
                        adsetName: nil, adId: "", adName: nil,
                        creativeId: nil, fbc: nil, fbp: nil)
    }
}
```

We control the destination URL on every Meta ad — they should all be set
to:

```
https://dreamme.app/install?utm_source=facebook&utm_campaign={{campaign.id}}&utm_medium={{adset.id}}&utm_content={{ad.id}}&utm_term={{ad.name|urlencode}}
```

(Meta substitutes the `{{...}}` macros at click time.) The deep-link parser
just lifts those query params.

## Verification

1. **Local sanity:** in a debug build, change the ad URL to a test endpoint
   and verify that `MetaInstallAttribution.resolve(url:)` returns the right
   campaign/ad IDs.
2. **End-to-end:** install via a known live Meta ad (campaign
   `120243985343730622` is the variant test, easiest target). Start a
   trial. Within ~1 hour, query RevenueCat:
   ```
   GET /v2/projects/projc9e74a6c/metrics/charts/trials_new?segment=attribution_ad&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
   ```
   Confirm a non-empty segment appears for that ad's ID with `value: 1`.
3. **Dashboard:** the next morning, hit `/api/cron/sync-revenuecat` (or
   wait for the 07:30 UTC schedule). Visit the Creatives sidebar in the
   admin dash. The card for that ad should show non-asterisked Revenue /
   ROAS / Payback values.
4. **CAPI bridge:** in Meta Events Manager, confirm the iOS dataset starts
   receiving `fb_mobile_complete_registration` events with the campaign
   IDs populated. The n8n `trial_qualified` workflow can then be retired
   (or repurposed as redundancy).

## When TikTok Spark Ads ship (parallel pipeline)

The dashboard repo is already wired to pull TikTok ad insights (cron at
`/api/cron/sync-tiktok-ads`, table `tiktok_ad_insights_daily`, Spark Ad
detection via `identity_type === "AUTH_CODE"`). Once you start running
TikTok ads, the iOS attribution wiring needs a small extension:

1. Detect the install referrer for TikTok. TikTok's iOS SDK exposes
   `TikTokBusinessSDK.getDeferredDeeplink()` (mirrors the Meta deferred
   deep-link API). Add a sibling resolver:
   ```swift
   TikTokBusiness.shared.fetchDeferredDeeplink { url, error in
       guard let url = url, let attr = TikTokInstallAttribution.resolve(url: url) else { return }
       Purchases.shared.attribution.setMediaSource("tiktok")
       Purchases.shared.attribution.setCampaign(attr.campaignId)
       Purchases.shared.attribution.setAdGroup(attr.adgroupId)
       Purchases.shared.attribution.setAd(attr.adId)
       Purchases.shared.attribution.setAttributes([
           "tiktok_campaign_id": attr.campaignId,
           "tiktok_adgroup_id":  attr.adgroupId,
           "tiktok_ad_id":       attr.adId,
       ])
   }
   ```
2. Order of resolution: try Meta first, fall back to TikTok, fall back
   to "organic". Only ONE `setMediaSource` should win per install.
3. UTM template for TikTok ad destination URLs:
   ```
   https://dreamme.app/install?utm_source=tiktok&utm_campaign={__CAMPAIGN_ID__}&utm_medium={__AID__}&utm_content={__CID__}
   ```
   (TikTok macros: `__CAMPAIGN_ID__`, `__AID__` = ad ID, `__CID__` =
   creative ID. Different syntax from Meta's `{{...}}`.)

The dashboard's `rc_ad_metrics_daily` table doesn't care whether
`attribution_ad` is a Meta or TikTok ad_id; it just joins on the value.
So once both platforms are firing `setAd`, per-ad ROAS lights up for
both in the same UI panel.

## Notes / gotchas

- **ATT prompt timing.** Show the ATT prompt **before** the first trial
  start — most iOS apps now show it during onboarding. If denied, you
  still get coarse SKAN attribution; if allowed, you get ad-level for
  free. Both paths are fine; just don't gate the entire attribution flow
  on ATT consent.
- **Privacy manifest.** RevenueCat 5.x and FB SDK 17.x both ship privacy
  manifests; no extra work needed for the iOS 17 PrivacyInfo.xcprivacy
  requirement.
- **Idempotency.** RevenueCat's `setAttributes` is idempotent and merges
  on the server side — calling it on every cold launch is fine, not
  required. First-launch is sufficient.
- **Attribution windows.** The Meta deferred deep link only resolves once
  per install. Cache the resolved attribution in `UserDefaults` so a
  re-install or app update doesn't lose it (it shouldn't, since RC stores
  it server-side once set, but belt and suspenders).
- **What about Apple Search Ads?** Out of scope here — RC has it as a
  built-in `attribution_source` and would slot in as a separate
  `setMediaSource("apple_search_ads")` path if/when ASA spend starts.

## Estimate

Half-day of iOS work for the wiring + 1 day of QA across the three
attribution paths (deep link / ATT-allowed / SKAN-only). Negligible risk —
this is purely additive; nothing existing breaks if the attribution payload
arrives empty.
