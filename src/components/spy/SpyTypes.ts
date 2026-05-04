export interface SpyVideoRow {
  id: string;
  source_hashtag: string;
  source_type: "hashtag" | "search";
  tiktok_id: string | null;
  post_url: string;
  author_handle: string | null;
  posted_at: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  caption: string | null;
  first_slide_url: string | null;
  first_slide_text: string | null;
  hook_normalized: string | null;
  category: string | null;
  slide_count: number | null;
  is_viral: boolean;
  viral_first_seen_at: string | null;
  why_it_hit: string | null;
  views_per_hour: number | null;
  author_baseline_median: number | null;
  author_baseline_count: number | null;
  outlier_score: number | null;
  last_scraped_at: string;
  created_at: string;
}

export interface SpyTrends {
  ok: true;
  windowDays: number;
  samples: number;
  topHooks: Array<{ hook: string; views: number; postId: string }>;
  categories: Array<{ category: string; posts: number; views: number }>;
  hashtags: Array<{
    hashtag: string;
    posts: number;
    views: number;
    viralCount: number;
  }>;
  searchQueries: Array<{
    query: string;
    posts: number;
    views: number;
    viralCount: number;
  }>;
}
