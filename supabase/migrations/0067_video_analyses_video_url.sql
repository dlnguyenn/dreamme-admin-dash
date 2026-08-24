-- Re-hosted copy of the analyzed video: both source CDNs expire (TikTok in
-- hours, Meta fbcdn by signed expiry), so the storyboard tile offers OUR
-- durable copy for download.
alter table public.video_analyses add column if not exists video_url text;
