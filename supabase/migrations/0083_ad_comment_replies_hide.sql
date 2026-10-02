-- ad_comment_replies: two more statuses for competitor mentions.
--
-- Why: comments on our ads that name a competing app (e.g. "MeAgain is free")
-- are now hidden by /api/cron/price-comment-replies. Hidden, never deleted:
-- Meta keeps the comment visible to its author and their friends, and it can be
-- unhidden from the post. 'hidden' is final; 'would_hide' is the dry-run twin
-- (logged while PRICE_REPLIES_LIVE is off) and is re-decided on later ticks.
--
-- Also new, with no schema change: rows with comment_id 'announce:<object id>'
-- record the one-off free-version announcement comment per post (?announce=1).
alter table public.ad_comment_replies
  drop constraint if exists ad_comment_replies_status_check;
alter table public.ad_comment_replies
  add constraint ad_comment_replies_status_check check (status in
    ('replied','dry_run','hidden','would_hide','not_price','own_comment',
     'already_answered','dup_commenter','error'));
