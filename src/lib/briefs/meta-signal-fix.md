# Meta Signal Fix Brief

Nov 6, 2026 · Dan Nguyen. Copy of the Claude Doc of the same name, kept here so the team can read it behind the DAD password.

Meta receives about three "Start trial" events for every real DreamMe trial, from three senders that cannot be deduplicated. This brief makes the Meta SDK the only trial sender, keeps RevenueCat as the only paid-conversion sender, and turns Singular into measurement only.

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
- The SDK's 1.66 events per trial is unexplained. There is one `logStartTrial` call per purchase path, and the SDK's auto-logger only emits `fb_mobile_purchase`, so something else is firing twice.

The result: Meta reports about $12 per trial while Singular, SKAN and the in-app survey all put the real figure at $24 to $32, and Meta optimizes on a signal three times too loud.

## Target state

One sender per event. The Meta SDK stays the trial sender because Marcus Burke measured it beating server-side events for in-app conversions, and found RevenueCat to MMP to Meta chains leaving only about 5% of trials attributed. RevenueCat stays the paid sender because a trial converts server-side, days after the app was last open, so only RevenueCat can see it.

| Event | Sender after the fix | Who stops sending |
| --- | --- | --- |
| App install | Meta SDK and Singular (Meta dedupes installs) | nobody |
| Start trial | Meta SDK | Singular; RevenueCat if possible (see below) |
| Subscribe (paid) | RevenueCat, with value | the app, Singular |
| Complete registration | Meta SDK | Singular |
| Trial converted (`rc_trial_converted`) | not forwarded to Meta; stays in Singular for reporting | — |

Singular keeps every measurement job it does today: Meta cost by placement, trials by ad set and ad, SKAN cross-check, and Android cost once configured. It just stops talking to Meta.

## David: app changes

Repo `davngu28/DreamMe`. All of this is in `lib/SubscriptionContext.tsx` (`purchasePackage` and `purchaseDiscountedPkg`) and `lib/facebook.ts`.

1. In the trial branch (`if (pkg.product.introPrice)`) of both purchase functions, remove the `logSubscribe(currency, price)` and `logSingularSubscribe(currency, price)` calls. Keep them for the non-trial path, where the user actually pays on day one. After this, Subscribe at trial start stops and Meta's Subscribe means a payment.
2. Keep `logStartTrial` and `logSingularStartTrial` as they are. The SDK call is the one trial signal Meta keeps; the Singular call feeds Singular's own reporting and no longer reaches Meta now that Dan has switched off the postback.
3. Find why the Facebook SDK sends 1.66 Start trial per real trial. Places to check: whether `introPrice` is set on a promotional offer that is a discounted first period rather than a free trial (`purchaseDiscountedPkg`), whether restore or relaunch paths re-run the purchase callback, and whether `SubscriptionPromptModal` and the paywall can both report the same purchase. Android counts too (712 of the 5,675 events were Android).
4. Do not change `_valueToSum` in `lib/facebook.ts`. Commit `d963eea` put it where the SDK ignores it on purpose, so on-device events carry no revenue and RevenueCat owns value. That stays.
5. Do not touch `autoLogAppEventsEnabled` in `app.json`. The auto-logger only emits `fb_mobile_purchase`, which nothing else sends.
6. Ship iOS and Android together and tell Dan the release date. The before-and-after comparison in the last section needs it.

If you find the 1.66 cause in step 3, fix it in the same release. If not, ship steps 1 and 2 anyway and note what you ruled out.

## Dan: Singular

Singular → Attribution → Partner Configuration → Facebook → DreamMe iOS (the config set on Aug 11).

1. Under events, stop sending `sng_start_trial`, `sng_subscribe` and `sng_complete_registration` to Facebook. Remove the mappings or set each to not send. This takes Singular's 596 trial copies out of Meta's feed at once.
2. Leave the install postback on (Send All). Meta deduplicates installs, and the install postback is part of how Singular claims Meta installs for its own reports.
3. Add a Facebook partner configuration for DreamMe Android, using the same Facebook app ID (1214186473920093), with install on and no event postbacks. This gives Singular Android attribution and cost reporting, which it has never had, without adding another sender.
4. Do not map `rc_trial_converted` to Facebook. It stays a Singular-only cohort metric for the DAD's trial-to-paid by ad.

These are reversible in the same screen if anything looks wrong.

Status, Nov 6: all four Singular steps are done and verified in Singular's change history. iOS no longer sends the three event postbacks; the Android Facebook configuration is saved with the install postback only (it needed Meta's Install Referrer Decryption Key, which Dan pasted in). The RevenueCat support email is sent and awaiting a reply. Both David cards are on the DAD Roadmap: "Meta signal fix" (Now) and "Put the ad on every Mixpanel event" (Next).

## Dan: RevenueCat

RevenueCat's Meta Ads integration sends a fixed list of events: trial started as StartTrial, and trial converted, initial purchase and renewal as Subscribe. Its docs show no way to turn off a single event.

- Keep the integration on. It is the only route for paid conversions with value, which is the signal Burke, Adapty's Q3 benchmark and AGA item 7 all point to.
- Email RevenueCat support and ask whether Trial Started can be disabled for the Meta integration, or whether they can set an `event_id` the Facebook SDK can match. One of those would remove the last duplicate. (Sent Nov 6.)
- Until then, accept that Start trial arrives twice (SDK plus RevenueCat). That is down from three times, and Subscribe becomes clean, which matters more.

One limit to know: RevenueCat's Meta events only count for users who allowed tracking, about 11% to 20% on iOS. So the paid signal will be roughly 100 to 140 events a month, under Burke's 50-a-week floor for optimizing on it alone. It still improves reporting and Meta's modeling.

## Dan: Meta Ads Manager

Nothing to change before the release. Every active ad set already optimizes for In-app start trial, which stays the right event for now.

After the release:

- Expect Meta's reported cost per trial to roughly triple, to $25 to $35. That is the duplicates disappearing, not performance falling. Do not cut budget on it.
- Expect a learning restart of one to two weeks on each ad set.
- Statics (about 255 Meta-counted trials a week today) should still clear Burke's floor of 50 real events a week. Videos (about 90) will land near 30, so consider folding Videos into Statics or accepting slower learning there.
- After two clean weeks, test one ad set optimized on Subscribe. Adapty's Q3 2026 benchmark puts cost per payer at $42.77 for Subscribe-optimized versus $57.32 for StartTrial-optimized. Volume is the risk, see the RevenueCat limit above.

## Order of work

1. Dan: Singular steps 1 to 4. Same day, reversible, removes a third of the duplicates immediately. (Done Nov 6.)
2. Dan: email RevenueCat support. (Done Nov 6.)
3. David: app change, iOS and Android in one release.
4. Dan: after release, watch Events Manager for a week before judging any ad set.
5. Both: read the success check two weeks after release.

Doing step 1 before step 3 is fine. Meta's counts drop a little, then more at release.

## How we know it worked

Two weeks after the release, in Meta Events Manager (dataset 1777837186267557), compare the same 14 days against RevenueCat:

| Check | Today | Target |
| --- | --- | --- |
| Start trial events per real trial | 2.96 | about 2.0 (SDK plus RevenueCat), or 1.0 if RevenueCat can switch its copy off |
| Start trial from Singular | 596 per 4 weeks | 0 |
| Subscribe events vs RevenueCat paid conversions | 4.3K vs about 700 | within 20% of each other |
| Meta-reported cost per trial vs Singular's | $12 vs $32 | within 1.3x |
| Singular Android installs | 0 | matches Meta's Android install count within 30% |

If Start trial is still above 2.0 per trial, the SDK double-fire from David's step 3 is still there.

## David: acquisition plumbing (no new vendor)

This is the part of the AppsFlyer spec worth building, fed by sources we already have. It makes the app, RevenueCat and Mixpanel know which ad brought each user, for every install that Outlier, Meta's deferred link or Singular can name. AppsFlyer is not part of it. Branch from `main`, draft PR, David merges. Line numbers are from `main` at `a52c14a`.

New file `lib/acquisition.ts`:

1. One snapshot per install, persisted in AsyncStorage: source, status, media source, campaign and campaign ID, ad group and ad group ID, ad and ad ID, keyword, creative, `is_paid`. Blank means blank; never store `unknown` or `paid` as a value.
2. Merge rule: Non-organic beats Organic beats failed beats blank. A result never replaces a higher-ranked one. A blank result never changes the snapshot. The first non-blank Meta deep link wins over later ones, because Meta's cold-start refresh rewrites its cache as `unknown` on every launch for users who allowed tracking.
3. Three sources, each handing its answer to the snapshot through one function:
   - `meta_deferred`: `lib/metaAttribution.ts`. Hand its `resolved` value over right after `await resolveMetaInstallAttribution()`. Do not add a second resolver call; Meta's SDK lets only the first deferred-link fetch of an install through.
   - `install_ping`: the server's match returned by `POST /api/attr/install`. Outlier already matches clicks to installs (`attr_installs.matched_click_id`, `ref_campaign_id`, `ref_adset_id`, `ref_ad_id`); it needs a small server change to include campaign, ad set and ad IDs and names in the response. Coordinate with PR #25, which is changing the ping's request, not its response. The app reads the response and does nothing else differently.
   - `singular`: Singular's SDK 4.2 `withDeviceAttributionCallbackHandler`, first session only, beta, enabled by Singular's CSM. Dan asks Singular; wire the handler behind a feature flag so it is inert until then.
4. Fix the existing bug at `lib/metaAttribution.ts:141-146`: it writes whatever the launch URL held, so `$adGroup` is the literal `paid` on most installs. Add `utm_term` (ad set ID) and `utm_id` (campaign ID) to `parseUtmFromUrl`, put numeric values in the ID fields and names in the name fields, map `fb` to `facebook` and `ig` to `instagram`. The install ping sends the cache whole, so extra keys are safe.

Destinations:

- RevenueCat (`lib/revenuecat.ts`, setter pattern at `:225-297`): `setMediaSource`, `setCampaign`, `setAdGroup`, `setAd` take Meta's numeric IDs, never names, and only for Non-organic results. They are write-once, and the DAD joins RevenueCat's `attribution_ad` to Meta's `ad_id`. Names go in custom attributes `acquisition_*` via `setAttributes`, Non-organic only; omit blank keys, because an empty string deletes the attribute. Flush at `lib/SubscriptionContext.tsx:208-219` and after `loginUser` and `logoutUser`.
- Mixpanel (`lib/analytics/mixpanel.ts`): `setAcquisitionProperties()` modelled on `setFreeModeArmProperty` (`:170-178`), holding values until init. Super properties `acquisition_*` and `is_paid_acquisition` on every result; people properties for Non-organic only, so a reinstall answering Organic never overwrites the account's original ad. Add `await mixpanelInstance.getDistinctId()` after `init()` (`:93`) so held events carry a `distinct_id`. Re-apply after identify (`lib/AuthContext.tsx:70`), never in the same tick as `resetUser()` (`:247`).
- One Mixpanel event, `acquisition_data_received`, when the first real answer arrives, with its source, status and media source, so we can watch coverage.

Do not touch: the install ping request (PR #25 owns it), `lib/att.ts`, the SKAN endpoints in `app.json`, `lib/singular.ts` event calls, and the Facebook SDK event calls beyond the Subscribe change in the section above.

Tests: `__tests__/acquisition.test.ts` for the merge rule (higher rank kept, blank keeps held values, first Meta deep link survives later launches, numeric-ID row sets `is_paid`); `__tests__/metaAttribution.test.ts` with `react-native-purchases` and `react-native-fbsdk-next` mocked (`setCampaign`, `setAdGroup`, `setAd` get IDs only, `paid` never reaches them, name-only row leaves `setAd` uncalled). The att, singular and installAttribution suites stay green.

Device check on a TestFlight and internal Android build: a fresh install sends one `acquisition_data_received`; a cold start from `fb1214186473920093://authorize?utm_source=fb&utm_medium=paid&utm_campaign=111&utm_content=333&utm_term=222&utm_id=111` on a throwaway install shows `$campaign` 111, `$adGroup` 222, `$ad` 333 in RevenueCat and the same IDs in Mixpanel; an install through a `go.dreamme.life/l` click shows the server's match once the Outlier response change is live. Ships in the next store build with the Subscribe change above; no OTA.

Outside the code: Dan asks Singular's CSM to enable the device attribution callback and whether Meta-attributed installs come back with campaign and ad names; the Outlier response change is a separate small PR on `dlnguyenn/outlier`.

## Sources

- [Meta: Conversions API for App Events](https://developers.facebook.com/docs/marketing-api/conversions-api/app-events), deduplication by `event_id` and event name; installs deduped automatically.
- [RevenueCat: Meta Ads integration](https://www.revenuecat.com/docs/integrations/attribution/meta-ads), the fixed event mapping and the warning against client-side revenue tracking.
- [RevenueCat community: deduplicating StartTrial and Subscribe for Meta](https://community.revenuecat.com/third-party-integrations-53/deduplicating-start-trial-subscribe-events-for-meta-ads-7428), no easy way to set the SDK's event ID.
- [Branch: Meta does not deduplicate custom app events](https://help.branch.io/ko/faq/docs/what-is-facebook-mmp).
- Marcus Burke, Sub Club and RevenueCat Signal Engineering panel appearances, summarized in the DreamMe vault page `marcus-burke-playbook`.
- Counts: Meta Events Manager Oct 9 to Nov 5 2026; RevenueCat `rc_events`; Singular partner configuration history, all read on Nov 6 2026.
