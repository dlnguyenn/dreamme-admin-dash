/**
 * Doublespeed is paused: Dan, 2026-11-06, "we no longer use it".
 *
 * While this is true the DAD makes no request to Doublespeed's API, reading or
 * writing, and the Overview hides the panels that only report on it. Stored
 * rows (social_posts, slideshow_batches, morning_posts) are left alone, so past
 * views still count. Set it to false to bring everything back.
 *
 * A plain constant rather than an env var so client components can read it too.
 */
export const DOUBLESPEED_PAUSED: boolean = true;

export const DOUBLESPEED_PAUSED_MESSAGE = "Doublespeed is paused";
