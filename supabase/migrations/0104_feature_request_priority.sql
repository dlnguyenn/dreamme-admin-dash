-- Feature Requests: a Priority column (urgent / high / medium / low) plus a
-- one-line reason, so the tab can be sorted by what to build next.
-- New tickets get one from the AI brief at filing time; anyone can change
-- it from the drawer. The backfill below is the first auto-pass over the
-- 15 requests that existed on 2026-11-07; it only fills empty rows, so it
-- never overwrites a priority set by hand.

alter table public.feature_requests
  add column if not exists priority text
    check (priority in ('urgent', 'high', 'medium', 'low')),
  add column if not exists priority_reason text;

create index if not exists feature_requests_priority_idx
  on public.feature_requests (priority);

update public.feature_requests as fr
set priority = v.priority,
    priority_reason = v.reason
from (values
  ('179eca6f-d1db-4e89-93f0-e304fb3e22b7'::uuid, 'urgent',
   'Broken promise: 1,000 codes are out and redeemers get no pearls. Small fix.'),
  ('5732c7e6-6e18-4925-910e-5c823ffdcc3a'::uuid, 'urgent',
   'Surprise renewals after deletion drive refunds, chargebacks and App Review risk.'),
  ('475a9b29-e155-471d-8488-09afa7cf99c7'::uuid, 'high',
   'Ratings volume drives search rank; already in progress.'),
  ('f392c733-593a-4c5a-84fc-a3debe177437'::uuid, 'high',
   'AI chat unusable for a paid Android user. Small fix.'),
  ('7a6020ea-c11c-43e5-b6dd-98dffcc017f5'::uuid, 'high',
   'Trial users hitting the scan cap mid-shop is a conversion leak. Small change.'),
  ('9172fc37-0002-412a-b909-04cfbd03c22b'::uuid, 'high',
   'Wrong nutrition scores on whole fruit erode trust in core logging. Small fix.'),
  ('9dbff769-ba4d-4ef6-8891-eac0ae19ea28'::uuid, 'medium',
   'Fat vs muscle is core to GLP-1 progress; data already in Health. Small.'),
  ('49157e3c-da77-4707-b319-32bc0df4efed'::uuid, 'medium',
   'Common need for users on several meds; extends shot tracking.'),
  ('b7900181-3447-4f9d-af4d-e57a31508b67'::uuid, 'medium',
   'Rounds out the doctor report; pairs well with other-meds tracking.'),
  ('d72a8258-2303-4375-8aef-f023093f9074'::uuid, 'medium',
   'Wrong-for-me warnings erode trust; affects a minority of users.'),
  ('40894159-0173-4396-845e-406679391d59'::uuid, 'medium',
   'Retention for users who stop meds, but a large build.'),
  ('719df43a-bebf-4966-b6dc-c008b350f533'::uuid, 'low',
   'Nice personalization, not blocking anyone.'),
  ('31895b45-d341-4955-9f2a-55ca1e075880'::uuid, 'low',
   'Two list items; quick win whenever the activity list is touched.'),
  ('c324cd1d-77ea-4154-8005-30ac7b9813d7'::uuid, 'low',
   'Comfort tweak for a few users; companion works as is.'),
  ('3fc9feb3-fe00-4355-bfcb-b89b210cb58c'::uuid, 'low',
   'One user, large integration; Fitbit already writes to Health Connect on Android.')
) as v(id, priority, reason)
where fr.id = v.id
  and fr.priority is null;
