-- Price-comment auto-replier on live Meta ads (FB post + IG media of each ad).
--
-- Why: price objections ("how much?", "too expensive") are the most common ad
-- comment in the GLP-1 category; the answer is that DreamMe has a free version.
-- /api/cron/price-comment-replies classifies new comments with Claude Haiku and,
-- only when PRICE_REPLIES_LIVE=true, replies once as the DreamMe Page.
--
-- One row per comment looked at (dedupe + audit). Terminal statuses are never
-- revisited: replied, not_price, own_comment, already_answered, dup_commenter.
-- dry_run rows keep their classification and are re-decided on later ticks, so
-- flipping to live replies to comments first seen in dry run. error retries.
-- Scheduled by GitHub Actions (.github/workflows/price-comment-replies.yml).
create table if not exists public.ad_comment_replies (
  comment_id text primary key,
  platform text not null check (platform in ('fb','ig')),
  ad_id text,
  ad_name text,
  object_id text not null,              -- effective_object_story_id or effective_instagram_media_id
  author_key text,                      -- FB user id or IG username (null when Meta withholds it)
  comment_text text,
  comment_created_at timestamptz,
  intent text,                          -- 'price' | 'other' (Claude Haiku)
  confidence real,
  status text not null check (status in
    ('replied','dry_run','not_price','own_comment','already_answered','dup_commenter','error')),
  reply_text text,
  reply_id text,
  error text,
  processed_at timestamptz not null default now()
);

create index if not exists ad_comment_replies_processed_idx
  on public.ad_comment_replies (processed_at desc);
create index if not exists ad_comment_replies_replied_author_idx
  on public.ad_comment_replies (ad_id, author_key) where status = 'replied';

comment on table public.ad_comment_replies is
  'Price-comment auto-replier audit: one row per Meta ad comment classified; replies point price objections to the free version.';

alter table public.ad_comment_replies enable row level security;
-- service-role only.
