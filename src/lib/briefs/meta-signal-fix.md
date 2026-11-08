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

One sender per event. The app's Meta SDK sends Start trial, RevenueCat sends the paid events with value. (Changed Nov 8. The Nov 6 version had RevenueCat sending trials too; see "Why the plan changed" below.)

| Event | Sender after the fix | Who stops sending |
| --- | --- | --- |
| App install | Meta SDK and Singular (Meta dedupes installs) | nobody |
| Start trial | Meta SDK (iOS: Meta's automatic logging; Android: the app's `logStartTrial` call) | the app's manual iOS call, RevenueCat, Singular |
| Subscribe (paid) | RevenueCat, with value | the app, Singular |
| Complete registration | Meta SDK | Singular |
| Trial converted (`rc_trial_converted`) | not forwarded to Meta; stays in Singular for reporting | nobody |

Singular keeps every measurement job it does today: Meta cost by placement, trials by ad set and ad, SKAN cross-check, and Android cost once configured. It just stops talking to Meta.

### Why the plan changed on Nov 8

The Nov 6 plan needed Meta's "Log in-app events automatically" toggle (iOS) switched off. Checked on Nov 8: it is ON and locked. Meta's tooltip says it can't change while SKAN campaigns run. The same toggle explains the SDK's extra 0.66 Start trial per trial: it auto-logs App Store trials on top of our manual call. It also has to stay on, because SKAN conversion values are set on the device by the Meta SDK, and RevenueCat's server events can't set them. Meta's AEM trial optimisation also wants install and trial from the same source. Our experts (Timothe Rey, Marcus Burke) both put the SDK first for trials. RevenueCat's Meta settings now have a per-event "Send" checkbox, so its trial event can be switched off with one click. Full reasoning: vault page `meta-attribution-architecture-decision`.

## David: app changes

Repo `davngu28/DreamMe`. All of this is in `lib/SubscriptionContext.tsx` (`purchasePackage` and `purchaseDiscountedPkg`) and `lib/facebook.ts`.

1. iOS: remove the manual `logStartTrial` call in both purchase functions. Meta's automatic logging already sends StartTrial for App Store trials, so the manual call is the duplicate. If the call is shared code, gate it on `Platform.OS === 'android'`.
2. Android: keep `logStartTrial`. Android's automatic logging has not been shown to send StartTrial (Android SDK events ran about 0.9 per trial, so there is no double there).
3. Remove every Facebook SDK `logSubscribe` call, trial branch (`if (pkg.product.introPrice)`) and non-trial branch, both platforms. RevenueCat sends Subscribe with revenue for trial conversions, direct purchases and renewals.
4. In the trial branch, also remove `logSingularSubscribe(currency, price)`. Keep `logSingularStartTrial`, and keep `logSingularSubscribe` on the non-trial path. Singular no longer forwards anything to Meta, so these calls only feed Singular's own reports.
5. Keep the `$fbAnonId` wiring in `lib/facebook.ts` (`Purchases.setFBAnonymousID` and `collectDeviceIdentifiers` on every cold start). RevenueCat's paid events match users who declined tracking through it, so it must still run before the paywall.
6. Keep `autoLogAppEventsEnabled` on in `app.json` and keep the Complete registration SDK event as it is.
7. Ship iOS and Android together, store builds (no OTA: main already needs a rebuild for expo-secure-store), and tell Dan the release date before submitting. Dan's RevenueCat change and the release must land the same day so ad learning restarts once.

The 1.66x is explained (automatic logging plus the manual call), so there is nothing to hunt. After the release the SDK should send about one Start trial per real trial.

## Dan: Singular

Singular → Attribution → Partner Configuration → Facebook → DreamMe iOS (the config set on Aug 11).

1. Under events, stop sending `sng_start_trial`, `sng_subscribe` and `sng_complete_registration` to Facebook.
2. Leave the install postback on (Send All). Meta deduplicates installs, and the install postback is part of how Singular claims Meta installs for its own reports.
3. Add a Facebook partner configuration for DreamMe Android, using the same Facebook app ID (1214186473920093), with install on and no event postbacks.
4. Do not map `rc_trial_converted` to Facebook.

Status, Nov 6: all four steps are done and verified in Singular's change history.

## Dan: RevenueCat

RevenueCat → Integrations → Meta Ads. Checked Nov 8: Conversions API, dataset 1777837186267557, token valid (events return 200), "Send events when ATT consent is not authorized" ON, gross revenue, mapping Trial Started → StartTrial, Trial Converted / Initial Purchase / Renewal → Subscribe. Recent StartTrial events from users who declined tracking carry the anonymous ID, so the matching works.

- On release day: untick the "Send" checkbox on the Trial Started row and save. Everything else stays. Reversible with one click.
- Leave the Subscribe rows and the revenue setting as they are.

RevenueCat support (Nov 6 reply) suggested renaming Trial Started to a custom name instead; the checkbox does the same thing more cleanly.

## Dan: Meta

Nothing to change in Meta's app dashboard. The iOS "Log in-app events automatically" toggle stays ON (it is locked anyway) and is now the trial sender. The Android automatic purchase and subscription toggles stay as they are.

In Ads Manager, nothing changes before the release. Every active ad set already optimizes for In-app start trial, which stays the right event.

After the release:

- Expect Meta's reported cost per trial to roughly triple, to $25 to $35. That is the duplicates disappearing, not performance falling. Do not cut budget on it.
- Expect a learning restart of one to two weeks on each ad set. Freeze campaign structure for two weeks.
- Check the DAD SKAN decoder maps fine value 61 to `trial_started`. Today trials arrive as 62 because of the Subscribe-at-trial-start bug.
- Statics should still clear 50 real trial events a week. Videos will land near 30, so consider folding Videos into Statics or accepting slower learning there.
- After two clean weeks, test one ad set optimized on Subscribe, knowing RevenueCat's Subscribe includes renewals.

## Order of work

1. Done Nov 6: Singular steps 1 to 4.
2. Done Nov 8: RevenueCat settings confirmed, Meta toggle checked (locked, stays on), plan switched.
3. David: app change, iOS and Android in one release. Tell Dan the date.
4. Dan, release day: untick RevenueCat Trial Started.
5. Dan: watch Events Manager for a week before judging any ad set.
6. Both: read the success check two weeks after release.

## How we know it worked

Two weeks after the release, in Meta Events Manager (dataset 1777837186267557), compare the same 14 days against RevenueCat:

| Check | Today | Target |
| --- | --- | --- |
| Start trial events per real trial | 2.96 | about 1.0, all from the Facebook SDK |
| Start trial from the Conversions API (RevenueCat) | 1,895 per 4 weeks | 0 |
| Start trial from Singular | 596 per 4 weeks | 0 |
| Subscribe events vs RevenueCat paid conversions | 4.3K vs about 700 | within 20% of each other |
| Meta-reported cost per trial vs Singular's | $12 vs $32 | within 1.3x either way |
| Singular Android installs | 0 | matches Meta's Android install count within 30% |

If Start trial is still above 1.2 per trial, something still double-fires (check Android automatic logging). If Subscribe runs far above RevenueCat's paid count, iOS automatic logging is sending subscriptions beside RevenueCat's. Fallback if SDK Start trial on iOS falls well under 1 per trial, or AEM trial optimisation loses eligibility in Events Manager: re-tick RevenueCat's Trial Started (one click, no build).

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
