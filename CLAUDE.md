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
- **Migrations apply automatically.** The `db-migrate.yml` GitHub
  workflow runs `npm run db:migrate` on every push to the prod branch
  whenever `supabase/migrations/**` changes, and exposes a manual
  `workflow_dispatch` trigger. **Never instruct the user to run
  `npm run db:migrate` themselves** — they don't need to. New
  migrations under `supabase/migrations/000N_*.sql` ship to prod when
  the branch is merged into the prod branch (or fire the workflow
  manually from the Actions tab). The workflow needs these repo
  secrets set: `SUPABASE_ACCESS_TOKEN` and either
  `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_PROJECT_REF`.
- The Supabase MCP server attached to Claude Code sessions points at
  the **DreamMe consumer app DB**, not the admin-dash DB. Do NOT use
  `mcp__*__apply_migration` for admin-dash schema changes — it would
  pollute the wrong database. Use the workflow above instead.

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

- **Discovery**: Apify `clockworks/tiktok-scraper` runs in two modes
  per scrape — hashtag mode (`hashtags: [...]` from
  `src/lib/spy-hashtags.ts`) and free-text search mode (`searchQueries:
  [...]` from `src/lib/spy-queries.ts`). Same actor, same `APIFY_KEY`.
  Each row in `spy_videos` is tagged with `source_type='hashtag'` or
  `'search'` so the UI / trends can split the two streams. Edit the
  config files + redeploy to add/remove either kind of source.
- **Cron**: `/api/cron/scrape-spy` runs Mon/Wed/Fri at 03:00 UTC, before the
  baseline + scrape + fatigue + generate sequence. (Was daily; throttled to
  3×/week to keep Apify spend ~$22/month.)
- **Viral threshold**: SpyTok-style outlier-first. For each newly-surfaced
  post we scrape that author's last 10 profile posts, compute the median,
  and store `outlier_score = view_count / baseline_median`. Viral when
  `outlier_score >= 5×`. Falls back to absolute thresholds (50K/7d or
  10K/48h) when baseline is unavailable. Velocity (`views_per_hour`) is
  also stored as a tiebreaker signal. Logic in `src/lib/spy-outlier.ts`.
- **Library floor**: posts with `view_count < 10K` are skipped at insert
  time (no OCR, no rehost, no profile scrape, no row). Existing rows still
  get view-count updates so we can see if a post stalls.
- **Storage**: re-hosted first slides at `spy/{hashtag}/{post_id}.{ext}`
  in the existing `dreamme-admin-internal-images` bucket.
- **Tables**: `spy_videos` (one row per scraped post) + `spy_favorites`
  (admin saves). Schema in `supabase/migrations/0015_spy_videos.sql`.
- **API**: `/api/spy/{videos, favorites, trends, why/[id]}`. The `why`
  endpoint lazy-computes a 1-2 sentence Haiku "why this hit" summary on
  first card click and caches it on `spy_videos.why_it_hit`.
- **Sub-tabs**: Browse / Trends / Favorites; persists to
  `localStorage["dreamme.spyTab"]`.
- **Cost**: ~$0.15/source/run × (9 hashtags + 7 search queries) × 3 runs/week
  ≈ $32/month for the main scrape. Author baseline scrapes (1 per unique
  newly-surfaced author) add roughly $10-15/month assuming the 10K floor
  filters ~half the noise. Total ≈ $40-50/month. Trim `SPY_HASHTAGS` /
  `SPY_QUERIES`, drop scrape frequency, or raise the 10K floor in
  `scrape-spy.ts:MIN_VIEWS_FOR_LIBRARY` if it climbs.

## Image Studio + self-hosted MCP server

In-dash image generation panel + a Streamable-HTTP MCP server that
claude.ai connectors and Claude Code can attach as a custom tool
provider. Single endpoint, four tools.

- **Endpoint**: `POST /api/mcp/image` (auth: `Authorization: Bearer
  ${MCP_IMAGE_BEARER_TOKEN}` *or* OAuth-issued access token — both
  validated by `validateBearer()` in `src/lib/mcp-oauth.ts`).
  Implementation lives at `src/app/api/mcp/image/route.ts` — bare
  JSON-RPC + Streamable-HTTP framing (no `@modelcontextprotocol/sdk`,
  it doesn't fit Next.js App Router cleanly).
- **OAuth 2.1 + PKCE** with dynamic client registration is wired up
  via `/api/oauth/{authorize,token,register}` and discovery at
  `/.well-known/{oauth-authorization-server,oauth-protected-resource}`.
  Required because claude.ai connectors don't accept static bearers.
  `MCP_IMAGE_BEARER_TOKEN` stays as the simple path for Claude Code.
- **Default model**: `gemini-3.1-flash-image-preview` (4K output).
  Pinned in `src/lib/image-generation.ts:MODEL`.
- **Storage**: every generated image lands in the public
  `mcp-image-generations` Supabase bucket with one
  `image_generations` row.
- **Rate limits**: `MCP_IMAGE_HOURLY_LIMIT` (default 50) and
  `MCP_IMAGE_DAILY_LIMIT` (default 100), enforced in
  `checkRateLimit()`. Counts apply globally (no per-caller identity)
  and span both the dashboard and MCP paths. Batch submissions
  reserve `items.length` against these caps at submission time.

### Tools exposed

| Tool                  | Sync? | Purpose                                                                                                          |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `generate_image`      | yes   | Text-to-image or image-to-image edit. Optional `count: 1-4` for parallel variations. Streams `notifications/progress` every 5 s so MCP client timeouts don't cut a slow Gemini call. |
| `proxy_upload`        | yes   | Generic byte-relay (GET source → PUT upload). Lets sandboxed sibling sessions copy bytes between Supabase and Azure Blob SAS URLs they can't reach directly. Hostname allowlists enforced. |
| `submit_image_batch`  | yes   | Submit ≤100 image-gen items to Gemini's async Batch API (50% off). Returns a `batch_id` immediately. Persists state in `image_generation_batches`.                                  |
| `get_image_batch`     | yes   | Lazy poll. When Gemini reports `SUCCEEDED`, downloads outputs, uploads to bucket, inserts `image_generations` rows so they show up in the gallery, caches results.                  |

### Streaming progress for `generate_image`

Slow Gemini calls (40-120 s on `gemini-3.1-flash-image-preview`) used
to time out at the client's 60 s tool-call ceiling. The route now:

- Always emits `notifications/progress` (synthesizes a `progressToken`
  if the client didn't supply one) on a 5 s ticker plus an immediate
  first-byte progress event.
- Sets `X-Accel-Buffering: no` on every SSE response so Vercel/Nginx
  proxies don't buffer it.
- Caps the auth fetch (`validateBearer`) and rate-limit Supabase reads
  at 8 s each so a hung infra call can't eat the client's budget.
- Bumps the reference-image fetch to 20 s with one retry on transient
  errors (Drive `lh3.googleusercontent.com` URLs in particular benefit).

`maxDuration` on the route is 300 s — Vercel has the budget; the 60 s
wall is purely on the client side.

### Async Batch (50% off)

`submit_image_batch` posts inline-format requests to
`generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchGenerateContent`
and stashes the resource name (`batches/abc…`) in the new
`image_generation_batches` table (migration
`0022_image_generation_batches.sql`). Status mirrors Gemini's
`BatchState`: `PENDING` → `RUNNING` → `SUCCEEDED` / `FAILED` /
`CANCELLED`. Turnaround is async — official SLA 24 h, typical 2-6 h.

`get_image_batch` is lazy-on-read: it only hits Gemini when the local
status is non-terminal. Once `SUCCEEDED`, it walks
`response.inlinedResponses[]`, uploads each output to the bucket via
`uploadBytesToStorage`, inserts an `image_generations` row per output
(reusing `insertRow` from the synchronous path), and persists the
results array. Per-item errors land in `results[i].error` — no
whole-batch failure.

`priceGeminiUsage({ isBatch: true })` halves all rates. Successful
batch outputs log to `ai_usage_events` at the discounted price so the
Spend dashboard reflects true cost.

For interactive UX, keep using `generate_image`. For multi-account
nightly batches where wall-clock latency doesn't matter, use Batch.

### `proxy_upload` byte relay

Sibling Claude Code sessions in hosted sandboxes can't egress to
`*.supabase.co` or `*.blob.core.windows.net`. `proxy_upload` runs the
GET+PUT here in unsandboxed Vercel:

- `source_url` host must end in `.supabase.co` or `.blob.core.windows.net`.
- `upload_url` host must end in `.blob.core.windows.net`.
- No retries, no buffering tricks beyond `arrayBuffer()` (fine for
  images <8 MB; revisit if we ever push huge files).
- HTTP twin at `POST /api/proxy/upload` shares the same logic via
  `src/lib/proxy-upload.ts:proxyUpload()`.

### Auto-refresh on redeploy

Tool list changes propagate to active Claude Code sessions automatically
— no manual reconnect. Mechanics:

- `initialize` advertises `capabilities.tools.listChanged: true`, so
  the SDK opens a long-lived `GET /api/mcp/image` SSE stream.
- The GET handler tags every event with the running deploy's
  `TOOLS_VERSION` (derived from `VERCEL_GIT_COMMIT_SHA` at module
  load) as the SSE `id:` field.
- On reconnect, the SDK echoes its last seen id back as the
  `Last-Event-ID` header. When that mismatches `TOOLS_VERSION`
  (i.e. a redeploy happened mid-session), the server immediately
  pushes `notifications/tools/list_changed` and the SDK refetches
  `tools/list`. Within a single deploy the version never changes,
  so reconnects fire heartbeats only.
- Stateless: no `Mcp-Session-Id`, no Supabase/Redis pub/sub. The
  redeploy itself is the trigger — every running function dies and
  every SSE stream reconnects against a fresh instance.
- Heartbeat is a 25s SSE comment (`: ping\n\n`) to defeat proxy idle
  timeouts.
- claude.ai connectors may not honor this; behavior degrades to the
  pre-fix manual reload.

### Things that have bitten us (image-studio specific)

- **`generate_image` timeouts at exactly 60 s** are the MCP client's
  tool-call ceiling, **not** Vercel's `maxDuration`. Don't waste time
  bumping `maxDuration`; it's already 300 s. Look at the SSE stream
  / progress notifications first.
- **claude.ai connectors don't accept static bearers** — they require
  full OAuth 2.1 with PKCE, which is why `src/lib/mcp-oauth.ts` exists.
  Claude Code is fine with the env-var bearer.

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
