-- Feature Requests: the "what does this need" ticket body.
-- One jsonb blob written when a support thread is filed (Create ticket) or
-- on Regenerate: AI brief (kind, area, ask, why, needs, open questions,
-- effort), a frozen requester snapshot (plan, store, paid, member since),
-- the user's own words, in-app screenshots, and thread/Trello links.
-- Shape: FeatureRequestDetails in src/lib/types.ts.
alter table public.feature_requests
  add column if not exists details jsonb;
