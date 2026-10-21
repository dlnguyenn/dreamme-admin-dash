-- Support Inbox: manual "Move to Feature requests".
-- Set when Dan files a thread into the Feature requests folder by hand. The
-- thread stays there (and counts as a feature request) until the customer
-- writes again, i.e. while feature_request_moved_at >= last_inbound_at.
-- See inFeatureRequestFolder in src/lib/support/types.ts.
alter table public.support_threads
  add column if not exists feature_request_moved_at timestamptz;
