# DreamMe Admin Dashboard

Internal-only dashboard for managing DreamMe's GLP-1 creator content
pipeline. Used by the team to review n8n-ingested deliveries, generate
AI captions, curate references, and track spend.

## Stack

- **Next.js 15.0** App Router, React 19 RC, TypeScript strict
- **Vercel** serverless. Default 60s, scrape routes use `maxDuration = 300`.
- **Supabase** REST API. Service-role key on the server, anon key on the
  client. Bucket: `dreamme-admin-internal-images`.
- **Anthropic Claude** for caption generation (Sonnet 4.6 + Opus 4.7 — see
  `src/lib/models.ts`). Apify `clockworks/tiktok-scraper` for slideshow
  scraping. Gemini for image work (`src/lib/gemini.ts`).
- Node `>=20.0.0 <21.0.0`.

## Branching & shipping

- **Prod branch is `claude/dreamme-dashboard-Cut5m`.** Push there, Vercel
  picks it up. PRs are optional, not required.
- Default working branch matches prod.
- Apply DB migrations with `npm run db:migrate` after merging schema
  changes. Migrations live in `supabase/migrations/000N_*.sql` and run in
  order via `scripts/apply-migrations.ts`.

## Common scripts

```
npm run dev          # next dev (port 3000)
npm run build        # next build
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run db:migrate   # apply pending Supabase migrations
```

Always `npx tsc --noEmit` before committing — strict mode catches a lot
of cross-file issues that lint won't.

## Auth model

Two passwords (see `src/components/Gate.tsx`):
- `dreamme` → `user` role (read-only viewer)
- `dreammeAdmin` → `admin` role (curate, generate, edit, delete)

Role lives in `sessionStorage` (`dreamme.role`). Threaded through
components as `isAdmin: boolean`. Server routes also gate via
`checkIngestAuth()` in `src/lib/auth-ingest.ts`.

## Persona system

Source of truth: `Downloads/personas.md` (in user's Downloads, NOT in
repo). Two in-repo files keep voice + UI in sync:

- `src/lib/personas.ts` — IDs, display names, colors, UI metadata. The
  `PersonaId` type is the canonical key.
- `src/lib/persona-profiles.ts` — editorial detail used by AI prompts:
  age, location, archetype, voice, contentTerritory, startWeightLbs,
  goalWeightLbs, writingStyle. **Update both files when changing a
  persona.**

Nine personas: andrea, emma, olivia, mia, abby, diane, sydney, maddy, hannah.

## Caption generation

All caption flows live in `src/lib/caption-generator.ts` and call the
Anthropic API directly (no Anthropic SDK — bare `fetch`, see the
`callClaudeText` helper). Prompts are split out into
`src/lib/prompts/` modules so structure is testable in isolation.

Three caption flavors, each with its own char ceilings:

| Flavor                | Target | Hard ceiling | Prompt module                              |
| --------------------- | ------ | ------------ | ------------------------------------------ |
| TikTok                | 3500   | 4000         | inline in `caption-generator.ts`           |
| Instagram             | 1200   | 2000         | `prompts/instagramCaption.ts`              |
| Before-transformation | 600    | 1200         | `prompts/beforeTransformationCaption.ts`   |

Conventions:
- TikTok and Instagram captions can use `GLP-1` or `GLP1` plainly — no
  emoji substitution required. The `GL🫛-1` pea-emoji swap is only
  enforced for before-transformation captions
  (`prompts/beforeTransformationCaption.ts`).
- Never the syringe emoji — write `shot` instead.
- Captions never include hashtags (the creator adds their own). Strip
  trailing hashtags via `stripTrailingHashtags`.
- Prompt-cache the system block (`cache_control: { type: "ephemeral" }`).
- TikTok tip headers use keycap number emojis (1️⃣–🔟) — one per tip,
  in order. Sub-points use ONE of 👉 / 💡 / 🔑 picked at random per
  caption in `caption-generator.ts` and applied uniformly to all
  sub-points; never mix bullets within a single caption.
- Every TikTok caption ends with an engagement-led CTA following the
  formula in `caption-style-guide.md` (identity question + specific
  low-friction action + 👇 + reciprocity beat + warmth emoji). Warmth
  emoji rotates among 🌿 / 🌱 / 🤍, picked per caption in
  `caption-generator.ts`. Never close on a save prompt alone.

## Repositories & schemas

- `src/lib/repositories/` — typed Supabase queries (one file per table)
- `src/lib/schemas/` — Zod schemas for ingestion + scrape payloads
- `src/lib/types.ts` — domain types. Each row has a `*Row` shape (snake
  case from Supabase) and a domain shape (camelCase). Mappers live next
  to `API` methods in `src/lib/supabase.ts`.

## Storage

Single bucket: `dreamme-admin-internal-images`. Path conventions:

- `resources/{uuid}.{ext}` — admin-uploaded reference images
- `references/{refId}/slide-{i}-{shortId}.{ext}` — scraped TikTok
  slideshow images
- `transformations/{deliveryId}/...` — generated transformation outputs

Server-only helper: `src/lib/storage.ts` `fetchToStorage(remoteUrl, path)`
fetches a remote URL and uploads to our bucket. Use this whenever we
re-host third-party CDN URLs (TikTok slides, etc.) — never persist the
external URL.

## UI conventions

- **Inline styles, not CSS modules.** Existing components use inline
  `style={{}}` objects with CSS variables (`--ink`, `--surface`, `--p-emma`,
  etc.). Match that pattern; don't reach for Tailwind in new files.
- **Responsive via `useIsMobile()`** (`src/lib/useIsMobile.ts`) — boolean
  hook checking viewport width. Use it inline rather than CSS media
  queries: `padding: isMobile ? 14 : 16`.
- **Mobile breakpoint is 640px** (whatever the hook reports).
- **Persistence**: UI toggles persist to `localStorage` keys prefixed
  `dreamme.*` (e.g. `dreamme.resourcesSubtab`,
  `dreamme.contentPipeline.mode`).
- **Subtab nav pattern** lives at `Resources.tsx:SubtabNav` and
  `ContentPipeline.tsx` mode toggle. Copy that styling for any new
  segmented controls — don't invent new ones.
- **Empty states + error banners** also follow a shared pattern (dashed
  border, serif italic title, accent banner). See `Resources.tsx` /
  `References.tsx`.
- **Icons** are inline SVG components in `src/components/Icons.tsx`.
  Pass `size={N}` and `stroke="var(--ink-2)"` etc.

## Architecture: SPA with state, not URL routes

The whole app is one route (`/`) plus `/item/[id]`. Navigation between
"Pipeline / Captions / Hooks / Transformation / Resources / Spend / Feature
Requests" is `useState` in `App.tsx`, not the router. Trade-offs:

- Pro: zero route plumbing, fast tab switching, all state co-located.
- Con: no deep links, no browser back, no per-tab refresh.

If you add a new top-level dashboard, add it to `Shell.tsx`'s
`NAV_ITEMS` array and switch on it in `App.tsx` — don't add a new route.

## Domain model — Content Pipeline

The core flow is `delivery → caption → posted`. A **delivery** is one
piece of content ingested from n8n (text + image + persona + hooks).
Modes in `ContentPipeline.tsx`:

- **after** mode — standard daily deliveries with IG caption generation
- **before** mode — "before transformation" photos with reflective
  captions (`isBefore: true` flag, distinct prompt anchored to Emma's
  template)

Both modes share the `DetailDrawer`. Caption generation buttons are
gated on `item.isBefore` — IG button shows when false, before-caption
button when true.

## Resources tab

Two subtabs (`Resources.tsx`):

- **Library** — flat grid of admin-curated reference images + external
  links (`resources` table)
- **References** — TikTok slideshow scraper. Paste a TikTok URL, Apify
  scrapes, slides re-host to our bucket, admin annotates each slide
  with a creator-facing note (`resource_references` table, slides as
  `jsonb`).

Active subtab persists to `localStorage["dreamme.resourcesSubtab"]`.

## Spy Tool

Admin-only competitive-intel surface for browsing what's going viral in
the GLP-1 niche on TikTok. Distinct from Hook Analytics (which tracks
OUR personas). Lives at `src/components/SpyTool.tsx` with sub-components
under `src/components/spy/`.

- **Discovery**: Apify `clockworks/tiktok-scraper` in hashtag mode (the
  same actor we use for personas, just with `hashtags: [...]` body).
  Hashtag list lives in `src/lib/spy-hashtags.ts` — edit + redeploy to
  add/remove hashtags.
- **Cron**: `/api/cron/scrape-spy` runs daily at 03:00 UTC, before the
  baseline + scrape + fatigue + generate sequence.
- **Viral threshold**: `view_count >= 50K within 7d` OR `view_count >= 10K
  within 48h` (early velocity catches rocketships before they fully blow
  up). Logic in `src/lib/spy-viral.ts:computeIsViral`.
- **Storage**: re-hosted first slides at `spy/{hashtag}/{post_id}.{ext}`
  in the existing `dreamme-admin-internal-images` bucket.
- **Tables**: `spy_videos` (one row per scraped post) + `spy_favorites`
  (admin saves). Schema in `supabase/migrations/0015_spy_videos.sql`.
- **API**: `/api/spy/{videos, favorites, trends, why/[id]}`. The `why`
  endpoint lazy-computes a 1-2 sentence Haiku "why this hit" summary on
  first card click and caches it on `spy_videos.why_it_hit`.
- **Sub-tabs**: Browse / Trends / Favorites; persists to
  `localStorage["dreamme.spyTab"]`.
- **Cost**: ~$0.30/hashtag/day × 9 hashtags = ~$2.70/day = ~$80/month
  Apify spend. Trim `SPY_HASHTAGS` if it climbs.

## Things that have bitten us

- **Shell cwd resets between Bash calls.** Wrap commands in
  `bash -c 'cd "<abs-path>" && <cmd>'` when the cwd matters.
- **Caption truncation**: `slice(N)` plus `maxHeight + overflow:hidden`
  silently swallows content. Prefer `overflowY: auto` so users can
  scroll instead of clipping.
- **Fixed-px column widths break mobile.** Anything wider than ~150px
  fixed needs an `isMobile` branch — see References.tsx ReferenceCard
  for the pattern.
- **Don't bypass copyright/privacy rules** even on internal tooling — no
  scraping facial images, no embedding sensitive data in URLs, no
  auto-clicking unfamiliar links.

## File map cheat sheet

```
src/app/api/                  # Next route handlers (serverless)
  ingest/                     # n8n webhook intake
  generate/caption/           # Caption generation routes
  resources/                  # Library + references CRUD
  scrape/                     # Apify wrappers
  modify/                     # Image modify (Gemini)
  personas/                   # Persona feed endpoints
  spend/                      # Spend tracking
  cron/                       # Scheduled jobs
  feature-requests/           # Feature request CRUD
  deliveries/                 # Delivery CRUD

src/components/               # All UI (inline styles, no CSS modules)
src/lib/
  supabase.ts                 # Client API + row mappers
  caption-generator.ts        # Anthropic API calls
  prompts/                    # Per-flavor prompt builders
  apify.ts                    # TikTok scraper wrapper
  storage.ts                  # Supabase Storage helpers
  models.ts                   # Anthropic model IDs
  personas.ts                 # Persona ID + UI metadata
  persona-profiles.ts         # Persona voice + journey detail
  auth-ingest.ts              # Server-side auth gate
  schemas/                    # Zod schemas
  repositories/               # Typed table queries
  types.ts                    # Row + domain types
  useIsMobile.ts              # Responsive hook

supabase/migrations/          # Sequential 000N_*.sql migrations
scripts/                      # Migration + maintenance scripts
tests/                        # Vitest specs + fixtures
```
