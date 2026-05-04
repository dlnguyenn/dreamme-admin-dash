-- Spy Tool — outlier-based viral detection
--
-- Adds the SpyTok-style signal stack to spy_videos:
--   views_per_hour          velocity since posted_at (cheap, math-only)
--   author_baseline_median  median view_count of the author's last ~10 posts
--   author_baseline_count   how many posts that median was computed from
--   outlier_score           view_count / max(author_baseline_median, 1)
--
-- Together these let us flag a 60K-view post from an unknown account as
-- "viral" while ignoring a 60K-view post from a 2M-follower account that
-- normally clears 800K. See src/lib/spy-outlier.ts for the formula.

alter table public.spy_videos
  add column if not exists views_per_hour numeric,
  add column if not exists author_baseline_median bigint,
  add column if not exists author_baseline_count smallint,
  add column if not exists outlier_score numeric;

create index if not exists spy_videos_outlier_idx
  on public.spy_videos (outlier_score desc nulls last, posted_at desc)
  where outlier_score is not null;

create index if not exists spy_videos_velocity_idx
  on public.spy_videos (views_per_hour desc nulls last)
  where views_per_hour is not null;
