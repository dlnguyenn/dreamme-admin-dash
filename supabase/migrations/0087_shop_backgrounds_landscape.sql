-- Background Studio: a wide version of each background for the home-screen
-- preview card (CompanionPreviewCard: full width x 200pt). Same environment
-- redrawn at 16:9, not a crop of the tall image. Null until generated.

alter table public.shop_backgrounds add column if not exists landscape_url text;
