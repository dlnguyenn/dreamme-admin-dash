# Meta Signal Fix Brief

Nov 6, 2026 · Dan Nguyen. Copy of the Claude Doc of the same name, kept here so the team can read it behind the DAD password.

Meta receives about three "Start trial" events for every real DreamMe trial, from three senders that cannot be deduplicated. This brief makes RevenueCat the only sender of trial and paid events to Meta, keeps the Meta SDK for installs and registration, and turns Singular into measurement only. Nothing here needs RevenueCat or Singular support.

## The problem

From Oct 9 to Nov 5, Meta's Events Manager received 5,675 "Start trial" events. RevenueCat recorded 1,916 real trials (iOS 1,548, Android 368).

| Sender | Start trial events | Per real trial |
| --- | --- | --- |
| Facebook SDK in the app | 3,184 | 1.66 |
| RevenueCat, Meta Conversions API | 1,895 | 0.99 |
| Singular, iOS only | 596 | 0.31 |
| Total | 5,675 | 2.96 |

Meta only drops a duplicate when both copies carry the same event ID. The three senders each use their own ID, so Meta can't match them. Installs are the exception: Meta deduplicates those on its own.

Two more problems on the same feed:

- The app fires "Subscribe" at trial start, so Meta's Subscribe (4.3K in the period) mixes trial starts with RevenueCat's real paid conversions and renewals.
- The SDK's 1.66 events per trial is unexplained. There is one `logStartTrial` call per purchase path. A possible second source is the Meta SDK's automatic in-app purchase logging, which can log subscription trials on its own. The fix below turns off both, so the cause no longer has to be found.

The result: Meta reports about $12 per trial while Singular, SKAN and the in-app survey all put the real figure at $24 to $32, and Meta optimizes on a signal three times too loud.

## Target state

One sender per event, and for trials and paid that sender is RevenueCat. Its Meta integration has no switch to turn off its own trial event, and its docs recommend this exact setup: turn off the Meta SDK's purchase logging and let RevenueCat send the purchase events, because the two can't share an event ID. RevenueCat also sees conversions server-side, days after the app was last open. It can match users who declined tracking because the app already gives it Meta's anonymous ID (`$fbAnonId`, on 588 of 607 recent webhook events).

| Event | Sender after the fix | Who stops sending |
| --- | --- | --- |
| App install | Meta SDK and Singular (Meta dedupes installs) | nobody |
| Start trial | RevenueCat | the app's Facebook SDK (manual call and auto-logging), Singular |
| Subscribe (paid) | RevenueCat, with value | the app, Singular |
| Complete registration | Meta SDK | Singular |
| Trial converted (`rc_trial_converted`) | not forwarded to Meta; stays in Singular for reporting | — |

Singular keeps every measurement job it does today: Meta cost by placement, trials by ad set and ad, SKAN cross-check, and Android cost once configured. It just stops talking to Meta.

The tradeoff: Marcus Burke measured the Meta SDK beating server-side events for in-app conversions, and Meta's docs don't say whether it credits server events from users who declined tracking as well as SDK events. The success check below tests this for us, with a fallback if it fails.

## David: app changes

Repo `davngu28/DreamMe`. All of this is in `lib/SubscriptionContext.tsx` (`purchasePackage` and `purchaseDiscountedPkg`) and `lib/facebook.ts`.

1. Remove every Facebook SDK `logStartTrial` and `logSubscribe` call from both purchase functions, in the trial branch (`if (pkg.product.introPrice)`) and the non-trial branch. RevenueCat now sends Start trial at trial start, and Subscribe with value when the user pays, including a day-one paid purchase.
2. In the trial branch, also remove `logSingularSubscribe(currency, price)`. Keep `logSingularStartTrial`, and keep `logSingularSubscribe` on the non-trial path. Singular no longer forwards anything to Meta, so these calls only feed Singular's own reports.
3. Keep the `$fbAnonId` wiring in `lib/facebook.ts` (`Purchases.setFBAnonymousID` and `collectDeviceIdentifiers` on every cold start). It is now how RevenueCat's events get matched to Meta users, so it must still run before the paywall.
4. Keep `autoLogAppEventsEnabled` on in `app.json`. It also sends app activations, which Meta uses for installs. Dan turns off only the in-app purchase auto-logging, in Meta's app dashboard.
5. Keep the Complete registration SDK event as it is.
6. Ship iOS and Android together and tell Dan the release date. The before-and-after comparison in the last section needs it.

The old step to hunt down the SDK's 1.66 Start trial per trial is gone. After the release the SDK should send almost no Start trial at all. If Events Manager still shows SDK Start trial events a week later, find what is still firing them.

## Dan: Singular

Singular → Attribution → Partner Configuration → Facebook → DreamMe iOS (the config set on Aug 11).

1. Under events, stop sending `sng_start_trial`, `sng_subscribe` and `sng_complete_registration` to Facebook. Remove the mappings or set each to not send. This takes Singular's 596 trial copies out of Meta's feed at once.
2. Leave the install postback on (Send All). Meta deduplicates installs, and the install postback is part of how Singular claims Meta installs for its own reports.
3. Add a Facebook partner configuration for DreamMe Android, using the same Facebook app ID (1214186473920093), with install on and no event postbacks. This gives Singular Android attribution and cost reporting, which it has never had, without adding another sender.
4. Do not map `rc_trial_converted` to Facebook. It stays a Singular-only cohort metric for the DAD's trial-to-paid by ad.

These are reversible in the same screen if anything looks wrong.

Status, Nov 6: all four Singular steps are done and verified in Singular's change history. iOS no longer sends the three event postbacks; the Android Facebook configuration is saved with the install postback only (it needed Meta's Install Referrer Decryption Key, which Dan pasted in). Both David cards are on the DAD Roadmap: "Meta signal fix" (Now) and "Put the ad on every Mixpanel event" (Next).

## Dan: RevenueCat

RevenueCat's Meta Ads integration stays on and becomes the only sender of Start trial and Subscribe. Its docs list a fixed set of events (trial started as StartTrial; trial converted, initial purchase and renewal as Subscribe) that can be renamed but not switched off one by one. That's why the app stops sending instead. No support ticket is needed; the email sent earlier can go unanswered.

- In RevenueCat → Integrations → Meta Ads, confirm the integration uses the Conversions API and that "Send events when ATT consent is not authorized" is on. Without it, RevenueCat drops iOS events from users who declined tracking, about 85% of iOS.
- Leave the event names at their defaults: StartTrial and Subscribe.
- Leave the revenue setting as it is, so Subscribe keeps carrying its value.

Paid volume: about 700 paid conversions every four weeks, roughly 175 a week. That clears Burke's 50-a-week floor for optimizing on Subscribe on paper; how many of them Meta actually credits depends on the same open question as trials.

## Dan: Meta

In Meta's app dashboard for app 1214186473920093, set "Log In-App Events Automatically" to No. This is RevenueCat's documented step: it stops the SDK's own purchase and trial logging while the app keeps reporting installs. It is reversible and can happen today, before the release.

In Ads Manager, nothing changes before the release. Every active ad set already optimizes for In-app start trial, which stays the right event for now.

After the release:

- Expect Meta's reported cost per trial to roughly triple, to $25 to $35. That is the duplicates disappearing, not performance falling. Do not cut budget on it.
- Expect a learning restart of one to two weeks on each ad set.
- Statics (about 255 Meta-counted trials a week today) should still clear Burke's floor of 50 real events a week. Videos (about 90) will land near 30, so consider folding Videos into Statics or accepting slower learning there.
- After two clean weeks, test one ad set optimized on Subscribe. Adapty's Q3 2026 benchmark puts cost per payer at $42.77 for Subscribe-optimized versus $57.32 for StartTrial-optimized. Volume is the risk, see the paid volume note above.

## Order of work

1. Done Nov 6: Singular steps 1 to 4.
2. Dan: the RevenueCat check and the Meta app dashboard switch. Same day, reversible, no build.
3. David: app change, iOS and Android in one release.
4. Dan: after release, watch Events Manager for a week before judging any ad set. SDK Start trial should fall to near zero while RevenueCat's stays at about one per trial.
5. Both: read the success check two weeks after release.

Doing step 2 before step 3 is fine. Meta's counts drop a little, then more at release.

## How we know it worked

Two weeks after the release, in Meta Events Manager (dataset 1777837186267557), compare the same 14 days against RevenueCat:

| Check | Today | Target |
| --- | --- | --- |
| Start trial events per real trial | 2.96 | about 1.0, nearly all from RevenueCat |
| Start trial from the Facebook SDK | 3,184 per 4 weeks | near 0 |
| Start trial from Singular | 596 per 4 weeks | 0 |
| Subscribe events vs RevenueCat paid conversions | 4.3K vs about 700 | within 20% of each other |
| Meta-reported cost per trial vs Singular's | $12 vs $32 | within 1.3x either way |
| Singular Android installs | 0 | matches Meta's Android install count within 30% |

If Start trial is still above 1.2 per trial, something in the app still sends it. If Meta's cost per trial ends up well above Singular's (more than 1.3x), Meta isn't crediting RevenueCat's events the way it credited the SDK's. The fallback, still with no support ticket: put `logStartTrial` back in the app, turn off RevenueCat's Meta integration, and send Subscribe to Meta from our own server off `rc_events`.

## David: acquisition plumbing (no new vendor)

This is the part of the AppsFlyer spec worth building, fed by sources we already have. It makes the app, RevenueCat and Mixpanel know which ad brought each user, for every install that Outlier or Meta's deferred link can name. AppsFlyer is not part of it. Branch from `main`, draft PR, David merges. Line numbers are from `main` at `a52c14a`.

New file `lib/acquisition.ts`:

1. One snapshot per install, persisted in AsyncStorage: source, status, media source, campaign and campaign ID, ad group and ad group ID, ad and ad ID, keyword, creative, `is_paid`. Blank means blank; never store `unknown` or `paid` as a value.
2. Merge rule: Non-organic beats Organic beats failed beats blank. A result never replaces a higher-ranked one. A blank result never changes the snapshot. The first non-blank Meta deep link wins over later ones, because Meta's cold-start refresh rewrites its cache as `unknown` on every launch for users who allowed tracking.
3. Two sources, each handing its answer to the snapshot through one function:
   - `meta_deferred`: `lib/metaAttribution.ts`. Hand its `resolved` value over right after `await resolveMetaInstallAttribution()`. Do not add a second resolver call; Meta's SDK lets only the first deferred-link fetch of an install through.
   - `install_ping`: the server's match returned by `POST /api/attr/install`. Outlier already matches clicks to installs (`attr_installs.matched_click_id`, `ref_campaign_id`, `ref_adset_id`, `ref_ad_id`); it needs a small server change to include campaign, ad set and ad IDs and names in the response. Coordinate with PR #25, which is changing the ping's request, not its response. The app reads the response and does nothing else differently.
4. Fix the existing bug at `lib/metaAttribution.ts:141-146`: it writes whatever the launch URL held, so `$adGroup` is the literal `paid` on most installs. Add `utm_term` (ad set ID) and `utm_id` (campaign ID) to `parseUtmFromUrl`, put numeric values in the ID fields and names in the name fields, map `fb` to `facebook` and `ig` to `instagram`. The install ping sends the cache whole, so extra keys are safe.

Destinations:

- RevenueCat (`lib/revenuecat.ts`, setter pattern at `:225-297`): `setMediaSource`, `setCampaign`, `setAdGroup`, `setAd` take Meta's numeric IDs, never names, and only for Non-organic results. They are write-once, and the DAD joins RevenueCat's `attribution_ad` to Meta's `ad_id`. Names go in custom attributes `acquisition_*` via `setAttributes`, Non-organic only; omit blank keys, because an empty string deletes the attribute. Flush at `lib/SubscriptionContext.tsx:208-219` and after `loginUser` and `logoutUser`.
- Mixpanel (`lib/analytics/mixpanel.ts`): `setAcquisitionProperties()` modelled on `setFreeModeArmProperty` (`:170-178`), holding values until init. Super properties `acquisition_*` and `is_paid_acquisition` on every result; people properties for Non-organic only, so a reinstall answering Organic never overwrites the account's original ad. Add `await mixpanelInstance.getDistinctId()` after `init()` (`:93`) so held events carry a `distinct_id`. Re-apply after identify (`lib/AuthContext.tsx:70`), never in the same tick as `resetUser()` (`:247`).
- One Mixpanel event, `acquisition_data_received`, when the first real answer arrives, with its source, status and media source, so we can watch coverage.

Do not touch: the install ping request (PR #25 owns it), `lib/att.ts`, the SKAN endpoints in `app.json`, `lib/singular.ts` event calls, and the Facebook SDK event calls beyond the changes in the section above.

Tests: `__tests__/acquisition.test.ts` for the merge rule (higher rank kept, blank keeps held values, first Meta deep link survives later launches, numeric-ID row sets `is_paid`); `__tests__/metaAttribution.test.ts` with `react-native-purchases` and `react-native-fbsdk-next` mocked (`setCampaign`, `setAdGroup`, `setAd` get IDs only, `paid` never reaches them, name-only row leaves `setAd` uncalled). The att, singular and installAttribution suites stay green.

Device check on a TestFlight and internal Android build: a fresh install sends one `acquisition_data_received`; a cold start from `fb1214186473920093://authorize?utm_source=fb&utm_medium=paid&utm_campaign=111&utm_content=333&utm_term=222&utm_id=111` on a throwaway install shows `$campaign` 111, `$adGroup` 222, `$ad` 333 in RevenueCat and the same IDs in Mixpanel; an install through a `go.dreamme.life/l` click shows the server's match once the Outlier response change is live. Ships in the next store build with the app change above; no OTA.

Outside the code: the Outlier response change is a separate small PR on `dlnguyenn/outlier`. Singular's device attribution callback is left out on purpose. It is a beta Singular has to switch on, and it adds little: Android already gets the campaign, ad set and ad from Meta's install referrer (PR #25), and on iOS Meta only names the ad for users who allowed tracking.

## Sources

- [Meta: Conversions API for App Events](https://developers.facebook.com/docs/marketing-api/conversions-api/app-events), deduplication by `event_id` and event name; installs deduped automatically.
- [RevenueCat: Meta Ads integration](https://www.revenuecat.com/docs/integrations/attribution/meta-ads), the fixed event mapping, no per-event off switch, and the documented fix of turning off Meta SDK purchase logging.
- [RevenueCat community: deduplicating StartTrial and Subscribe for Meta](https://community.revenuecat.com/third-party-integrations-53/deduplicating-start-trial-subscribe-events-for-meta-ads-7428), no easy way to set the SDK's event ID.
- [Branch: Meta does not deduplicate custom app events](https://help.branch.io/ko/faq/docs/what-is-facebook-mmp).
- Marcus Burke, Sub Club and RevenueCat Signal Engineering panel appearances, summarized in the DreamMe vault page `marcus-burke-playbook`.
- Counts: Meta Events Manager Oct 9 to Nov 5 2026; RevenueCat `rc_events`; Singular partner configuration history, all read on Nov 6 2026.
