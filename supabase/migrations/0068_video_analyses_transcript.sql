-- Verbatim spoken transcript (dialogue/VO only), captured by the same
-- Gemini pass that builds the storyboard — on-demand per video, no bulk
-- extraction. Null on rows analyzed before this shipped.
alter table public.video_analyses add column if not exists transcript text;
