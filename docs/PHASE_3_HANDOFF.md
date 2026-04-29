# Self-improving hooks — Phase 3 & 4 handoff

Pause point: 2026-04-29 (Phase 2.1 just shipped, holding 7 days for
real fatigue data before Phase 3).

## Current state

| Phase | PR | Merged | Status |
| --- | --- | --- | --- |
| 1 — performance labels + auto-link | #33 (`dc33929`) | 2026-04-28 | live |
| 2 — embeddings, families, fatigue, prompt | #34 (`898efd8`) | 2026-04-28 | live |
| 2.x — voyage-3-large + column-name fixes | `a97cefe` | 2026-04-28 | live |
| 2.1 — clustering threshold 0.92 + category gate | #35 (`d0aaff0`) | 2026-04-29 | live |
| 3 — comment resonance | — | — | **planned** |
| 4 — hardening | — | — | **planned** |

Verified after 2.1 rebuild: 53 families, 178/178 posts attached,
20/20 generated hooks attached, fatigue cron clean (no cooldowns yet —
expected; needs deploy/flop history to accrue).

## Pre-Phase-3 verification (run after ~7 days of natural cron data)

The point of waiting is to see whether the fatigue signal actually
populates and whether it steers the generator. Before greenlighting
Phase 3, run these in the Supabase SQL editor:

```sql
-- Should show non-zero fatigue scores by now
select exemplar_text, member_count, fatigue_score, fatigue_reason,
       cooldown_until, last_use_at
from hook_families
order by fatigue_score desc
limit 10;

-- Should show the auto-link in action
select count(*) filter (where posted_post_id is not null) as linked,
       count(*) filter (where match_source = 'auto_normalized') as t1,
       count(*) filter (where match_source = 'auto_embedding') as t2,
       count(*) as total
from generated_hooks;

-- Performance class distribution per persona
select persona, performance_class, count(*)
from tiktok_posts
where last_scraped_at > now() - interval '7 days'
group by 1, 2
order by 1, 2;

-- Have any families actually entered cooldown?
select count(*) from hook_families where cooldown_until > now();
```

**Healthy signal**: ≥3 families with `fatigue_score > 0`, ≥1 in
cooldown, at least a handful of `match_source` = `auto_normalized` or
`auto_embedding` rows. **Stuck signal**: `fatigue_score = 0` everywhere,
zero matches — means the auto-link isn't catching deployed hooks. If
stuck, debug the matcher before adding Phase 3 inputs to the prompt.

Also worth eyeballing: is the top family at 64 members shrinking,
holding, or growing? If growing, scenario 2 from the post-2.1 review
is real and we need to weight the under-explored category nudge more
heavily before adding comment data.

## Phase 3 — Comment resonance

Goal: top-20% of posts per persona get their comments scraped and
LLM-summarized, so the generator sees *why* a hook resonated, not
just that it did.

### Schema (migration `0012_comment_summaries.sql`)

```sql
create table public.post_comment_summaries (
  post_id uuid primary key references public.tiktok_posts(id) on delete cascade,
  persona text not null,
  scraped_at timestamptz not null default now(),
  raw_top_comments jsonb,           -- top ~50 verbatim
  resonance_summary text,           -- 2-sentence Haiku summary
  themes text[],                    -- 3-5 extracted themes
  pain_signals text[],              -- explicit pain points named
  total_scraped int
);
create index post_comment_summaries_persona_idx
  on public.post_comment_summaries (persona);
```

### New code

| File | Role |
| --- | --- |
| `supabase/migrations/0012_comment_summaries.sql` | schema |
| `src/lib/apify-comments.ts` | `clockworks/tiktok-comments-scraper` wrapper, mirrors `src/lib/apify.ts` |
| `src/lib/handlers/scrape-comments.ts` | handler: per-persona top-20% selection, dedup against existing summaries < 7d old, fetch comments, summarize, persist |
| `src/lib/anthropic.ts` (extend) | `summarizeComments(comments)` Haiku helper — 2 sentences + 3-5 themes + pain signals |
| `src/app/api/cron/scrape-comments/route.ts` | new cron at `30 6 * * *` |
| `src/app/api/generate/hooks/route.ts` (modify) | fetch top-5 hits' summaries for the persona, secondary Haiku to compress summaries-of-summaries, inject "Comment resonance summary" section into the prompt |
| `src/lib/anthropic.ts` (modify `generateHooksForPersona`) | new prompt section between "top hits" and "flops" |
| `src/components/hook-analytics/CommentThemes.tsx` | drawer on post-detail rows showing summary + theme chips |
| `vercel.json` | add `30 6 * * *` cron entry |
| `tests/scrape-comments.test.ts` | mock Apify, assert dedup logic, summarizer trims comment list |

### Eligibility rule

Per persona, posts from last 30 days ranked by `performance_ratio`
desc. Take top 20%, cap 25/persona. Skip posts already in
`post_comment_summaries` with `scraped_at` < 7 days old.

### Cost guard

- Apify: ~50 posts/day × 1 comments call each. Stays well under the
  5-min `maxDuration`. Budget tracked via existing `/api/cron/spend/apify`.
- Anthropic: Claude Haiku 4.5, ~$0.0002 per summary call → ~$0.01/day.

### Required env

Reuses existing `APIFY_KEY` (the comments scraper actor uses the same
account token). No new env vars.

### Verification

- vitest on `summarizeComments` with mocked Apify fixtures
- Prod dry-run on andrea's top 5 yesterday; verify Apify cost stays
  under the daily budget tile
- Confirm next generation cycle's prompt cites resonance themes in the
  generated hooks' `rationale` text

## Phase 4 — Hardening

Smaller PRs, can be sequenced or parallelized.

### 4a. Backfill scripts

| Script | Purpose |
| --- | --- |
| `scripts/backfill-baselines.ts` | populate `persona_baselines` from history (currently relies on first cron run) |
| `scripts/backfill-comment-summaries.ts` | scrape comments for the top 20% of historical posts in one shot |

### 4b. Manual match override

When the auto-matcher misses a generated→post link, admin can fix it:

| File | Role |
| --- | --- |
| `src/app/api/hooks/[id]/match/route.ts` | POST `{ posted_post_id }` → updates `posted_post_id`, `deployed_at`, `match_confidence=1.0`, `match_source='manual'` |
| `src/components/hook-analytics/ManualMatchDialog.tsx` | "Link to post" action on HookCard footer; modal with persona-scoped post search |

### 4c. Cost surfacing

| File | Role |
| --- | --- |
| `src/app/api/cron/spend/voyage/route.ts` | Voyage spend nightly snapshot (mirrors existing `spend/anthropic` and `spend/apify`) |
| Spend dashboard tile | shows monthly Voyage spend alongside the other vendors |

### 4d. A/B threshold tuning

For one week, log to a new table `generation_decisions`:
- which hooks were considered
- which were skipped due to fatigue (and why)
- which were ultimately picked

After a week of data: compare actual performance of skipped vs picked
to validate the four thresholds:
- Family similarity 0.92
- Tier-2 match similarity 0.92
- Fatigue score 0.6
- Performance class 25%/200% baselines

If skipped hooks would have outperformed picks, raise the fatigue
threshold. If too many false-merges, raise the similarity threshold.

## Resumption prompt (paste into a fresh session)

```
I'm resuming the self-improving hooks project after a 7-day pause for
real fatigue data to accumulate. Phases 1, 2, 2.x, 2.1 are all live in
prod (claude/dreamme-dashboard-Cut5m branch). Read
docs/PHASE_3_HANDOFF.md for full context.

Please:
1. Run the four pre-Phase-3 verification queries from the doc and
   report results.
2. Eyeball whether the top family is shrinking, holding, or growing
   relative to the 64-member baseline from 2026-04-29.
3. Recommend whether to proceed with Phase 3 as spec'd, fix a
   precursor issue first, or adjust the Phase 3 scope based on what
   the data shows.

Do not start any code changes yet. I want your read on the data first.
```
