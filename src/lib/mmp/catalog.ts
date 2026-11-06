/**
 * Static content for the MMP tab: what an MMP is for, how AppsFlyer works
 * (public docs only, read 2026-11-05), what App Growth Annual 2026 speakers
 * said about MMPs (paraphrased from the transcripts in the vault), and the
 * ordered plan to match AppsFlyer in-house. Sources: wiki/mmp-emulation.md.
 */

export interface MmpJob {
  title: string;
  what: string;
  dreamme: string;
  verdict: "built" | "partly" | "cant";
}

/** The three things an MMP is paid for, and where DreamMe stands on each. */
export const JOBS: MmpJob[] = [
  {
    title: "Referee",
    what: "Every ad network claims the installs it touched. An MMP sits between them and gives each install to one last touch, so the same user is not paid for twice.",
    dreamme:
      "Nearly all paid spend is on Meta, so there is little to referee between networks. The open question is paid against organic, and last-touch does not answer that. A holdout test does.",
    verdict: "partly",
  },
  {
    title: "Plumbing",
    what: "One SDK and one link format: clicks in, installs matched, events sent back to every network, spend pulled into one table, raw rows exported.",
    dreamme: "Mostly built in-house: the /l link, the install ping, the SKAN collector, the event senders and the cost table. The Parity view lists what is live, idle or broken.",
    verdict: "built",
  },
  {
    title: "Privileged access",
    what: "Meta, Google and TikTok only answer attribution questions from certified partners. With Meta's Advanced Mobile Measurement terms, a partner also gets row-level Meta attribution.",
    dreamme:
      "This cannot be built, only reached through a partner. Singular is already in the app and has it: it attributes iOS installs and trials to Meta campaigns, and the DAD pulls those in. Trial-to-paid by ad is still missing.",
    verdict: "cant",
  },
];

export interface Mechanic {
  topic: string;
  appsflyer: string;
  ours: string;
}

/** How AppsFlyer attributes, from its public docs, next to what the DAD does today. */
export const MECHANICS: Mechanic[] = [
  {
    topic: "Link parameters",
    appsflyer: "pid (media source), c (campaign), af_adset, af_ad, af_siteid (publisher) and clickid (the network's click ID).",
    ours: "src, c and cn (campaign), as and asn (ad set), a and an (ad), filled by Meta's URL macros, plus fbclid.",
  },
  {
    topic: "Lookback windows",
    appsflyer: "Click: 7 days by default, settable from 1 to 30. Probabilistic click match: up to 24 hours. View: 1 day.",
    ours: "Click: 7 days. Confidence is high inside 1 hour, medium inside 24 hours, low after. No view window.",
  },
  {
    topic: "Who gets the credit",
    appsflyer: "The most recent click in its window. A click always beats a view; a view wins only when no click qualifies, and otherwise counts as an assist.",
    ours: "The most recent click. Views are not tracked.",
  },
  {
    topic: "Match order",
    appsflyer: "Install referrer, then device ID, then a probabilistic match. No match means organic.",
    ours: "Same IP first, then same network block with a device-fingerprint check. No referrer and no device ID.",
  },
  {
    topic: "Meta, Google, TikTok, Apple",
    appsflyer: "Sends each install to the network's API and gets a claim back, then runs last-touch over all claims. Apple Ads uses the AdServices token.",
    ours: "No claim API. Meta's totals are read from the Marketing API.",
  },
  {
    topic: "Reinstalls",
    appsflyer: "A reinstall inside 90 days is a re-attribution, not a new install. Re-engagement window: 30 days.",
    ours: "Not classified. SKAN flags redownloads.",
  },
  {
    topic: "Users who decline tracking",
    appsflyer: "No IDFA. Attribution still runs (probabilistic, or from the network's claim) but row-level data is hidden. SKAN runs either way.",
    ours: "The click match uses IP and fingerprint, so the tracking prompt does not change it. SKAN runs either way.",
  },
  {
    topic: "SDK start-up",
    appsflyer: "Starts on launch, waits up to 60 seconds for the tracking prompt, then returns the install's source and campaign to the app.",
    ours: "The app sends an install ping on first open with the full payload each time, and stores our install ID on the RevenueCat customer.",
  },
  {
    topic: "Events",
    appsflyer: "af_start_trial, af_subscribe and af_purchase from the SDK, or a server API taking one event per request.",
    ours: "RevenueCat webhooks into rc_events, with server-side senders to Meta.",
  },
  {
    topic: "Fraud signals",
    appsflyer: "Very short or very long click-to-install time, click flooding per publisher, device farms, an IP denylist, signed SDK messages.",
    ours: "Apple's postback signature, the redownload rate, a fingerprint conflict gate.",
  },
  {
    topic: "Getting data out",
    appsflyer: "A pull API with daily quotas, a real-time push API, and Data Locker writing files to your bucket 1 to 3 hours behind.",
    ours: "SQL on our own tables.",
  },
  {
    topic: "Price",
    appsflyer: "Growth plan: $0.07 per paid conversion after 12,000 free in year one. Fraud, audiences, cost and Data Locker are add-ons priced by sales.",
    ours: "About $430 a month at today's Meta volume (estimate, 2026-11-05) against our own build time.",
  },
];

export interface AgaNote {
  who: string;
  session: string;
  said: string[];
  means: string;
}

/** What App Growth Annual 2026 speakers said about MMPs. Paraphrased, not quoted. */
export const AGA_NOTES: AgaNote[] = [
  {
    who: "Marcus Burke",
    session: "AI workflows for Meta (workshop)",
    said: [
      "His stack is Meta Ads, an MMP (AppsFlyer), PostHog and RevenueCat, all read by one agent over MCP. He treats MMPs as interchangeable.",
      "He uses the MMP for one thing: trial-to-paid rates at the creative level, to estimate what a new ad's trials will be worth.",
      "He expects the MMP and Ads Manager to disagree with what really happened, and checks RevenueCat for blended numbers.",
      "From his other talks: 70 to 80% of trials should be visible in Meta, each extra hop between the app and Meta loses matches, the Meta SDK beat the Conversions API in his tests, and he now prefers Meta's AEM to SKAN.",
    ],
    means: "The one thing he gets from AppsFlyer that the DAD lacks is trial-to-paid by ad. The rest of his loop is already here.",
  },
  {
    who: "Hannah Parvaz (Aperture)",
    session: "Sub Club Live",
    said: [
      "App Store Analytics by source is her main source of truth.",
      "Meta's AEM numbers are probabilistic, and she sees Meta under-report against reality across clients.",
      "She adds custom product pages to triangulate.",
    ],
    means: "She names no MMP as the truth. Her clients see Meta under-report; ours over-claims. Either way the check is a source Meta does not control.",
  },
  {
    who: "Julien Daver, Hannah Parvaz",
    session: "AI-generated ads (workshop), Sub Club Live",
    said: [
      "Both cite Singular's creative benchmark: the median advertiser launches 13 new creatives a week, the 90th percentile 54.",
      "Julien also points to AppsFlyer's creative optimization report as a list of concepts to test.",
    ],
    means: "At this conference the MMPs showed up mostly as publishers of benchmarks.",
  },
  {
    who: "MillionARR game show",
    session: "Main stage (affiliate segment)",
    said: ["For creator and affiliate links: use the strongest automatic attribution available, and fall back to a short code the user types where a link cannot work."],
    means: "That is how DreamMe's creator codes already work.",
  },
  {
    who: "RevenueCat",
    session: "Product keynote",
    said: ["Launched Funnels (web-to-app flows) and Audiences (segments by subscription status, with export)."],
    means: "RevenueCat now ships two pieces an MMP also sells.",
  },
];

export const AGA_SUMMARY =
  "In the sessions captured in the vault, no talk was about MMPs and no speaker called one a source of truth. The MMP was one input among several, checked against RevenueCat or the App Store.";

export interface PlanStep {
  title: string;
  why: string;
  work: string;
  needs: "App release" | "DAD only" | "Ad account" | "App release + DAD" | "Singular account";
}

/** Ordered by how much attribution each step adds for the work it takes. */
export const PLAN: PlanStep[] = [
  {
    title: "Get everything Singular already has",
    why: "Singular is a certified Meta partner, so its numbers include the row-level Meta data nobody can build. It attributes iOS installs and trials by campaign today. Its Meta cost has been empty since October, and ad set and ad breakdowns are untested.",
    work: "Reconnect the Facebook data connector in Singular. Then request the same report by ad set and ad, and see whether trials come back at that level.",
    needs: "Singular account",
  },
  {
    title: "Android install referrers",
    why: "Gives Android what AppsFlyer gives it: a deterministic match to the campaign, ad set and ad for Meta installs, including view-through. No partner needed.",
    work: "Read the Play and Meta install referrers in the Android install ping, decrypt Meta's on the server, store the IDs on the install.",
    needs: "App release + DAD",
  },
  {
    title: "Apple Ads token",
    why: "Deterministic campaign and keyword for every Apple Ads install, which also settles whether non-brand search can pay back.",
    work: "Turn on AdServices token collection in the app and read the result from RevenueCat, or resolve the token ourselves.",
    needs: "App release",
  },
  {
    title: "A website-objective Meta campaign on the /l link",
    why: "The only way to get click-matched installs on iOS, and how MeAgain buys (website campaigns through AppsFlyer links). It is also the only source of trial-to-paid by ad.",
    work: "Rerun with enough budget per ad set and optimize on trial_qualified. Lead bought low-intent installs, and start-trial was too sparse at $17 a day.",
    needs: "Ad account",
  },
  {
    title: "Fix the audience sync",
    why: "The suppression audience is empty, so ads may be reaching people who already subscribe.",
    work: "Find why the weekly cron stopped enumerating RevenueCat customers, then rerun it.",
    needs: "DAD only",
  },
  {
    title: "SKAN: later windows and modeled nulls",
    why: "Windows 2 and 3 would carry trial-to-paid by campaign. Modeling the nulls turns SKAN from a floor into an estimate.",
    work: "Investigate why only window 1 arrives. Spread RevenueCat's iOS trials across campaigns by SKAN install share.",
    needs: "DAD only",
  },
  {
    title: "Cost for Apple Ads and TikTok",
    why: "Blended cost is Meta-only today.",
    work: "Daily Apple Ads spend sync from the existing API client. TikTok when ads run there.",
    needs: "DAD only",
  },
  {
    title: "Install classification",
    why: "First opens run well above real downloads because updates and reinstalls look like new installs.",
    work: "Have the install ping say new, reinstall or update, and match only new installs and reinstalls.",
    needs: "App release + DAD",
  },
  {
    title: "A standing switchback",
    why: "No attribution method, bought or built, says what Meta adds over organic. The holdout does.",
    work: "Run the Meta Switchback for its full length and repeat it each quarter.",
    needs: "Ad account",
  },
  {
    title: "Context through the install on Android, and creator links",
    why: "The OneLink equivalent: the app learns which link or creator sent the user.",
    work: "Pass a click ID through the Play referrer. Keep typed codes on iOS.",
    needs: "App release + DAD",
  },
  {
    title: "Fraud checks",
    why: "Only matters once spend goes to click-link ad networks.",
    work: "Flag installs with an implausible click-to-install time and publishers with flood patterns.",
    needs: "DAD only",
  },
];

export interface CantCopy {
  what: string;
  substitute: string;
}

export const CANT_COPY: CantCopy[] = [
  {
    what: "Meta's row-level attribution for iOS (Advanced Mobile Measurement)",
    substitute: "Singular's reports for installs and trials by campaign, website-objective campaigns on the /l link for an ad-level sample, and SKAN as a cross-check.",
  },
  {
    what: "The claim APIs of Meta, Google and TikTok",
    substitute: "Treat each network's own numbers as a claim and check the total against RevenueCat and the holdout test.",
  },
  {
    what: "TikTok's feed of ad exposures for users who declined tracking",
    substitute: "TikTok's Events API for modeled conversions, and SKAN for installs.",
  },
];

export const BUY_OPTION =
  "A partner is the only route to the three items above, and DreamMe already has one: Singular is in the app with Meta's measurement terms accepted since August 11. AppsFlyer would give the same partner access. At today's volume its Growth plan is about $430 a month against about $310 for Singular's (estimates from the published per-conversion rates).";
