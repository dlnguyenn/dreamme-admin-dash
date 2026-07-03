# Growth AI — Build Log

**Built:** July 2–3, 2026 · **Branch:** `claude/dreamme-dashboard-Cut5m` (prod, auto-deploys to Vercel)
**Scope:** 13 commits · ~13,700 lines added · 5 migrations (0039–0043) · 6 new cron jobs · 15 AI tools
**What it is:** a Motion + Runneth clone built into the DreamMe admin dash — an all-in-one paid-social command center for consumer apps: easy-to-read creative analytics plus an AI marketing brain, wired to DreamMe's live Meta + RevenueCat + SKAN data.

Companion doc: [growth-ai.md](./growth-ai.md) (architecture reference). This file is the deliverables inventory.

---

## The tab at a glance

**Growth AI** (admin-only, sidebar between Spend and Marketing Efficiency) — six subtabs:

| Subtab | What it does |
| --- | --- |
| **Overview** | This-week-at-a-glance KPIs with WoW deltas (spend, Meta CPT, RC-truth trials, blended CAC, 7d MER, LTV:CAC payback, creatives launched) · anomaly-alerts strip · spend-vs-trials chart with hover tooltip · performance shifts (Scaling / Declining / **Fatiguing** / New / Paused) · top spending creative with AI thought-starters |
| **Creatives** | Visual leaderboard (thumbnails, theme tags, WoW spend deltas, weeks on board, trials, CPT, hook/hold/CTR) + **New Launches** sprint view (launch weeks vs editable target, Hit/Promising/No-trials goal chips) |
| **Insights** | **Messaging Themes wall** from AI tags (spend, WoW, hit rate, Testing/Scaling/Proven/Declining ladder) · compare-by-dimension bars (visual format / theme / audience / video-vs-static / campaign / persona) · "formats you haven't tried" chips |
| **Inspo** | Viral organic content from **other apps** on TikTok + Instagram (≥50k views): trending-apps strip, filterable grid, favorites, post drawer with AI "why it hit" + **Adapt for DreamMe** briefs, watchlist manager with discovery-sweep toggle |
| **Competitors** | Meta **Ad Library tracking**: type a brand name → pick their page → every ad pulled + AI-analyzed (format/angle/hook/offer/why-notable) → monitored Tue/Fri with NEW badges, running-days longevity signal, ended-ad archive, **Counter-this-ad** briefs |
| **AI Analyst** | Runneth-style chat that pulls live data before answering (15 tools), **confirm-gated actions** (pause/budget/duplicate proposals → you click Confirm → audit-logged), weekly recap panel with DB history |

Everything opens a shared **AdDrawer** for DreamMe's own ads (tags + re-tag, copy, daily sparkline, attention funnel, WoW strip, confirm-gated pause/resume).

---

## Feature inventory

### 1. Core analytics + AI analyst (v1)
- Weekly KPI computation, performance shifts, creative leaderboard — all client-side over the already-synced `ad_insights_daily` / `rc_account_metrics_daily` / `blended_marketing_efficiency`.
- Analyst chat: bounded Claude tool-use loop (`src/lib/growth-tools.ts: runGrowthAgent`), Sonnet 4.6 default / Opus 4.7 toggle, tool-trace chips, localStorage transcripts.
- One-click **Weekly Recap** in Runneth's format: deterministic stats + AI-written top/bottom performers (WHY / WHO / WHAT NEXT), creative patterns, prioritized actions.

### 2. AI creative tagging (Motion's core feature)
- Every spending ad tagged by Haiku vision (image bytes + copy): **Visual Format** (UGC talking head, screen recording, letter/text, post-it…), **Messaging Theme** (label + description, drift-controlled by injecting the existing registry into every call), **Audience**, **Hook type**.
- `source_hash` staleness → unchanged ads never re-billed. Daily cron 07:40 UTC; on-demand + per-ad re-tag from the UI.
- All ~70 ads tagged: 5 themes, 9 formats. First insight surfaced: **Gamification is the only PROVEN theme (249 trials @ $37)** while "Finally Gets It" burned $13.4K at a 13% hit rate.

### 3. Fatigue detection (Runneth use-case)
- Flags ACTIVE ads (≥$50/14d) where trailing-7d CTR or hook rate fell ≥25% while spend held, or CPT rose two consecutive weeks. Surfaces as the "Fatiguing" shift tab + `fatigue_check` tool.

### 4. Confirm-gated AI actions
- The analyst proposes (never executes) pause / activate / set-budget / duplicate via `propose_action` → ActionCard in chat → ConfirmDialog → `POST /api/growth/act` → executes via the existing Meta helpers → row in `growth_action_log` (success or failure). Duplicates always land PAUSED; card state persists on the saved message so reloads can't re-fire.

### 5. Recap automation
- Recaps persist to `growth_recaps` with a history picker; Monday 13:00 UTC cron auto-generates and emails via an n8n webhook (skips with a note until the env var is set — see Outstanding).
- Recaps now carry two deterministic bonus sections: **📱 From the app world** (top fresh viral app posts) and **👀 Competitor watch** (new competitor launches + running counts).

### 6. Viral App Inspo (organic virality of other apps)
- **Pipeline** (`src/lib/viral-apps.ts`): 68-account watchlist (34 TikTok + 34 Instagram, health/tracker-skewed) + discovery sweeps (4 TikTok hashtags, 2 IG keyword searches, toggleable in the UI) → 50k-view floor → one Haiku-vision call per new post (is-it-an-app gate, app name — 'Multiple (listicle)' for roundups — category, format, hook type, OCR'd on-screen hook, why-it-hit) → covers re-hosted to the bucket → engagement refreshed on re-scrape without re-billing.
- Actors: `clockworks~tiktok-scraper` (existing) + `apify~instagram-reel-scraper` (one bulk run per watchlist) + `patient_discovery~instagram-search-reels`.
- Seeded with **~142 real viral posts** (Calm's 9.8M-view "hurkle-durkle" reel, Duolingo, BeReal, Oura, ClickUp… plus discovery finds like Rork and Haven). Dead handles: `noom` (TikTok), `rocketmoney` (IG) — flagged in the UI.
- `viral_app_inspo` analyst tool — verified by having it adapt Headspace's 182K "what happens to your body" hook into a GLP-1 brief.

### 7. Competitor Ad Tracker
- **Pipeline** (`src/lib/competitor-ads.ts`): ScrapeCreators Ad Library API (company search + cursor-paginated ads pull) → normalizer pinned by unit tests against a real 100-ad MeAgain sample → diff on `ad_archive_id` (new → Haiku analysis + cover re-host; vanished-while-active → marked ended) → brand badge counts.
- Real-data gotchas encoded: ad-level `page_id` can differ from the queried brand page (ads store under the brand's), `body` is `{text}`, platforms key is `publisher_platform`, video thumbs come from `video_preview_image_url`, collapsed variants can be media-less (copy-only analysis).
- Seeded with MeAgain (verified page_id). `competitor_ads` analyst tool + Competitor-watch recap section.

### 8. Deep Research mode (Lightreel-style, shipped Jul 3)
- **Pipeline** (`src/lib/growth-research.ts`, migration 0044): question → Sonnet plans adjacent categories + 6-8 seed searches in **native viewer language** → TikTok search sweeps (≥20k-view floor) → Haiku mines round-1 captions for recurring phrases → round-2 searches → per-candidate inspection: creator-baseline **outlier score** (spy-outlier) + **Gemini watches the actual video** (app visibility 0-3, hook transcript, works-without-app) → Sonnet memo (format clusters w/ REPLICATE/TEST/SKIP verdicts, copy/avoid, 3 repeatable series, replication searches).
- **Client-stepped**: run state persists in `phase_state` jsonb; the browser loops `POST /api/growth/research/step` (3 videos/step in the inspect phase) so 5-10-min runs fit serverless limits and resume from anywhere.
- Strong finds (visibility ≥2 or ≥3× creator median) with a visible app feed the Inspo feed automatically. `research_reports` analyst tool (16 total) pulls memos into chat.
- UI: Deep Research rail in the Analyst subtab (question input + suggestions, phase progress, Resume/Retry, history pills, memo + strong-finds strip). Manual-trigger only, ~$2-3.50/run.
- E2E'd head-to-head on the exact Lightreel question ("viral B2C app videos with a food scanner or in the health niche"): 14 searches → 141 candidates → 14 watched (13 true video, 1 slideshow cover-fallback) → found EXPOSR (2 videos, vis 3), Munchee (vis 2), Fastic (vis 3) → memo correctly isolated the "Brand Scandal Scan Reveal" as the only load-bearing format and called out the untapped GLP-1 angle. Cover-only coding proved measurably worse than video coding (it hallucinated TMZ as an app) — the video pass earns its cost.
- Gotcha encoded: local `.env.local` `GOOGLE_API_KEY` was stale/dead (image gen only ever ran in prod) — replaced from the ops repo. There is NO plain `gemini-3.1-flash`; the video default is **`gemini-3.5-flash`** (env `GEMINI_VIDEO_MODEL`).

---

## Database (migrations 0039–0044, all auto-applied)

| Table | Purpose |
| --- | --- |
| `ad_creative_tags` | AI tags per DreamMe ad (format/theme/audience/hook, source-hash staleness) |
| `growth_recaps` | Weekly recap history (stats + recap jsonb, manual/cron source, sent_at) |
| `growth_action_log` | Append-only audit of confirmed AI actions |
| `app_watchlist` | 68 app brand accounts (TikTok + IG), dead-handle detection |
| `viral_app_posts` / `viral_app_favorites` | ~142 enriched viral posts + saves |
| `viral_app_settings` | Singleton toggles (discovery sweep on/off) |
| `competitor_brands` / `competitor_ads` | Tracked competitors + their analyzed Ad Library ads |
| `growth_research_runs` | Deep Research runs (question, status ladder, phase_state jsonb, memo) |

## Cron schedule (additions)

| Cron | Schedule (UTC) | Job |
| --- | --- | --- |
| `growth-tag` | daily 07:40 | Tag new/changed DreamMe creatives |
| `growth-recap` | Mon 13:00 | Generate + persist + email the weekly recap |
| `scrape-viral-apps?platform=tiktok` | Tue/Fri 04:30 | Viral apps, TikTok leg |
| `scrape-viral-apps?platform=instagram` | Tue/Fri 05:15 | Viral apps, Instagram leg |
| `scrape-competitor-ads` | Tue/Fri 05:45 | Competitor Ad Library diff |

## Running costs (estimates)

- Viral apps scraping: **~$55–70/mo** Apify (2×/week, both platforms) — reducible via the discovery-sweep toggle, fewer accounts, or 1×/week.
- AI enrichment: Haiku vision, pennies (~$0.002/item, only NEW items, 40–60 caps per run).
- Competitor tracking: a few ScrapeCreators credits per brand per scrape + Haiku for new ads only.
- Analyst chat/recaps: Sonnet 4.6 per use (~$0.05–0.15/question); tracked by the existing Anthropic org-spend cron.

## Verification highlights

- Typecheck clean + **143 tests pass** at every ship point (5 new normalizer tests against real API fixtures — they caught the page_id mismatch before it hit prod).
- Live E2E on real data: tagger (70 ads, hash-skip re-runs), TikTok + IG scrapes (~142 posts, thumbnails re-hosted), analyst chat with correct tool routing and quality recommendations (correctly identified the Comic Sans hook-rate problem and Kylie/Maggie as scale candidates), recap persistence + history, action guards (400 without confirm, 401 without auth, dismiss survives reload), cron auth + graceful degradation, UI walkthroughs of all six subtabs.
- Known workaround: headless preview tabs stall on "Syncing with Supabase" because `App.refresh()` skips hidden documents — force `document.hidden=false` when testing.

## Commits

```
a1e33a2  Growth AI tab: Motion/Runneth-style creative analytics + AI marketing brain
86ebc2a  Growth AI v2 phase 1: AI creative tagging, fatigue detection, data joins
1c7b011  Growth AI v2: Insights + Launches + ad drawer + confirm-gated AI actions + recap automation
9c00361  Viral App Inspo phase 1: watchlist + TikTok pipeline + classifier + cron
34dff7d  Viral apps: raise scrape concurrency, pool classification, listicle label
1d01a32  Viral App Inspo phase 2: Instagram source (watchlist reels + keyword discovery)
45cb708  Viral apps cron: one invocation per platform
8c8189c  Viral App Inspo phase 3: Inspo subtab UI
c40e683  Viral App Inspo phase 4: analyst tool + recap "From the app world"
e9c3895  Viral apps: discovery-sweep toggle (DB-backed setting)
ab7722a  Competitor Ad Tracker: brand search, ad-library pull + AI analysis, new-launch monitoring
54e008f  Competitors: surface search API errors inline
```

## Outstanding (needs Dan)

1. **ScrapeCreators**: account is **out of credits** (402) — top up at scrapecreators.com, then add `SCRAPECREATORS_API_KEY` to **Vercel env** (already in local `.env.local`). Then hit "↻ Scrape now" on Competitors and add Glowise/Shotsy via search.
2. **Recap email**: create the n8n webhook→email workflow (2-minute recipe in [growth-ai.md](./growth-ai.md)) and set `N8N_GROWTH_RECAP_WEBHOOK_URL` in Vercel. Until then, recaps generate + persist but skip delivery.
3. **First live AI action**: the confirm/audit plumbing is verified up to the Meta boundary — your first "Confirm & apply" click exercises the final hop.
