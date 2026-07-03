# Growth AI tab — how it works

The all-in-one paid-social command center (Motion + Runneth equivalent):
creative analytics, AI tags, an analyst chat with confirm-gated actions,
and an auto-generated weekly recap.

## Sub-views

| Subtab | What's in it |
| --- | --- |
| Overview | Alerts strip (marketing_alerts), weekly KPI glance w/ WoW deltas + LTV:CAC payback card, spend-vs-trials chart (hover tooltip), performance shifts incl. **Fatiguing**, top spending creative + AI thought starters |
| Creatives | Leaderboard (thumbnails, theme tags, WoW deltas, hook/hold/CTR) + **New launches** sprint view (weekly cadence vs target, goal chips) |
| Insights | Messaging Themes wall (AI-tag driven: spend, hit rate, Testing/Scaling/Proven/Declining) + compare-by-dimension bars + "formats you haven't tried" |
| Inspo | Viral app content from TikTok + IG (`viral_app_posts`, scraped Tue/Fri, ≥50k views): trending-apps strip, filterable grid, post drawer w/ why-it-hit + "Adapt for DreamMe", watchlist manager |
| Competitors | Competitor Meta Ad Library tracking (`competitor_brands`/`competitor_ads` via ScrapeCreators, scraped Tue/Fri 05:45): brand search → track, NEW badges on fresh launches, running-days longevity signal, per-ad AI analysis (format/angle/hook/offer/why-notable), "Counter this ad" briefs. **Requires `SCRAPECREATORS_API_KEY`** (in `.env.local`; add to Vercel env for prod). |
| AI Analyst | Tool-use chat over live data (15 tools incl. `viral_app_inspo` + `competitor_ads`), **propose_action** confirmation cards, weekly recap panel w/ DB history + "From the app world" + "Competitor watch" sections |

Everything opens the shared **AdDrawer** (tags + re-tag, copy, daily
sparkline, attention funnel, WoW strip, confirm-gated pause/resume).

## AI creative tagging

- `src/lib/growth-tagging.ts`, table `ad_creative_tags` (migration 0039).
- Haiku 4.5 vision over creative image bytes (fetched server-side — Meta CDN
  URLs expire) + ad name/headline/primary text.
- Theme labels are drift-controlled: the existing registry is injected into
  every call with "reuse when the angle matches".
- `source_hash` over creative fields → unchanged ads are never re-billed.
- Runs daily via `/api/cron/growth-tag` (07:40 UTC, after sync-ad-insights);
  on-demand via `POST /api/growth/tag { limit, force, ad_ids }`.
- Full re-tag escape hatch: `POST /api/growth/tag {"force":true,"limit":25}`
  repeatedly (~$0.50 for ~100 ads).

## Confirm-gated actions

- The analyst can emit `propose_action` (pause/activate ad, set ad set or
  campaign budget, duplicate ad set). It NEVER executes — the chat renders
  an ActionCard; Confirm posts `/api/growth/act { confirm: true }`.
- Every attempt (applied or failed) is one row in `growth_action_log`.
- Card state persists on the saved chat message, so reloading can never
  re-execute. Duplications always land PAUSED.
- The AdDrawer's Pause/Resume button uses the same route (`source: "ad_drawer"`).

## Weekly recap

- `src/lib/growth-recap.ts`: deterministic stats (buildWeeklyStats) + one
  structured Claude call → persisted to `growth_recaps`.
- Manual: the Analyst panel button (history picker shows the last 12).
- Auto: `/api/cron/growth-recap` Mondays 13:00 UTC → persist → email.

### Email delivery setup (one-time, ~2 min)

The recap email goes out through an n8n webhook (no email vendor in this
repo; n8n already holds the dreamme.life SMTP credential). Until the env
var is set, the cron skips delivery with a note — recaps still persist.

1. In n8n (n8n.dreammeops.us) create a workflow:
   - **Webhook** node — method POST, path `growth-recap-email-<long-random-suffix>`
     (the unguessable path IS the auth), respond "Immediately".
   - **Send Email** node — credential **"SMTP account"** (same one the
     "DreamMe TEST - Dan & David" workflow uses, sends from
     rachel@dreamme.life), To: your inbox,
     Subject: `={{ $json.body.subject }}`, HTML: `={{ $json.body.html }}`.
   - Connect webhook → email, activate.
2. Set `N8N_GROWTH_RECAP_WEBHOOK_URL=https://n8n.dreammeops.us/webhook/growth-recap-email-<suffix>`
   in Vercel env (and `.env.local` for local testing).

The payload also includes `week_start`, `headline`, `summary` if you want a
Slack branch later.

## Data sources (all pre-existing, anon-readable)

`ad_insights_daily`, `rc_account_metrics_daily`, `blended_marketing_efficiency`,
`marketing_alerts`, `payback_summary`, `campaign_ltv_cohorts`,
`payer_retention_cohorts`, `skan_health`, `skan_reconciliation` + the new
0039 tables. No breakdowns (age/placement) — those aren't synced.

## Gotchas

- "Launched/newly launched" uses the TRUE first appearance across the full
  56d fetch — window-sliced `first_seen` is always inside the window.
- Meta-reported trials are a RANKING signal (ATT under-counting); blended
  CAC (spend ÷ RC trials) is the truth layer. The AI system prompt encodes
  this so the analyst never quotes account ROAS as paid ROAS.
- Fatigue thresholds live in TWO places (client `growth/data.ts`
  `detectFatigue`, server `growth-tools.ts` `fatigue_check`) — keep in sync.
