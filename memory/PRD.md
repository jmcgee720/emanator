# Emanator — Agent Platform PRD

## Original Problem Statement
Transition Emanator into a full Agent Platform that behaves exactly like the AI Engineer (E1). Emanator must autonomously build beautiful, highly polished, fully functional applications from a Creative Brief — including flows the user didn't explicitly ask for (Sign Up, Onboarding, Settings, etc.).

## Product Requirements
- Creative brief pipeline reliably generates 9/10 UI designs (glassmorphism, asymmetric layouts, brand-correct colors).
- Uses Art Direction (logos, style references) via GPT-4o Vision.
- Does NOT produce generic outputs, does NOT hit context/stream timeouts.
- **NEW**: Emanator must generate fully functioning, multi-page applications with real UX flows (auth, onboarding, dashboards) out of the box.
- **NEW (Session 21)**: When the user uploads a logo/hero image, the generated app MUST render that actual image (not a placeholder gradient). The router MUST NOT duplicate the Navbar. Copy MUST be brand-specific, never generic SaaS boilerplate.

## User Personas
- SaaS founder — needs prototype-to-demo in under 60 seconds
- Designer — wants high-polish output they can hand to a dev team
- PM — wants to validate a concept with a working clickable prototype

## Architecture (current state)
- Next.js 14 + FastAPI + MongoDB + Supabase (projects/files)
- `/app/lib/ai/message-stream.js` — Creative Brief fast-path
- `/app/lib/ai/brief-utils.js` — shared helpers (normalize, inject-imports, **mapImageAssets**, **buildAssetsFileContent**)
- `/app/lib/ai/brief-builder.js` — wave build; `buildWaveSystemPrompt` now exported for test coverage
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Babel AST-based multi-file preview runtime (Axe-core audit included)
- `/app/components/dashboard/useDashboardStream.js` — SSE client + auto-recovery polling
- GPT-4o via Emergent LLM key (Vision enabled)

## Implemented (this session — 2026-02)

### Session 23 (COMPLETE, 2026-02-18) — Reference images in every builder wave

User's core insight: *"the builder never sees the image — it only reads my paraphrase of it, which is why output looks generic."* Correct. The fix mirrors how E1 itself handles uploaded images — attach the reference **to every wave's user message** as `image_url` content parts so GPT-4o Vision re-anchors on the reference while writing each file.

**Shipped:**

1. **`buildWaveUserPrompt({wave, referenceImages})`** now returns a multi-part OpenAI user message (`[{type:'text',...}, {type:'image_url',...}, ...]`) when `plan.imageAssets` is populated, or a plain string when none (no token overhead for imageless builds).
   - Cap: 2 images per wave (token cost management; logo + hero = the "what should this look like" intent).
   - `detail: 'low'` — ~85 tokens per image vs ~1000 for detail:high; enough for aesthetic grounding.
   - Explicit text directive: *"Reference image(s) attached below — USE these as your visual source of truth for palette, typography mood, and composition. Match what you see; do not default to generic SaaS aesthetics."*

2. **`repairBuild()` in `brief-reviewer.js`** also attaches the reference images to the repair wave's user message when `plan.imageAssets` is present — so when the reviewer flags `ignored-user-logo` / `generic-marketing-copy` / `hardcoded-color-classes-bypass-theme`, the repair LLM can actually *see* the reference while rewriting the broken file.

3. **Provider verification** — `lib/ai/providers/openai.js` passes `messages` straight to `client.chat.completions.create()`. Multi-part content (text + image_url) is the OpenAI Vision API native contract. Default model alias `gpt-4o` maps to `gpt-4o-mini` which supports Vision; `o3` maps to full `gpt-4o`. No provider changes needed.

4. **+8 targeted tests** (6 buildWave, 2 repairBuild) that capture the messages passed to the provider and assert:
   - User message is multi-part array when imageAssets present, plain string otherwise.
   - Exactly 2 image_url parts when ≥2 images (cap enforced).
   - Preamble text contains "visual source of truth" + "palette, typography mood, and composition".
   - `detail: 'low'` on every image.
   - URLs thread through from imageAssets to the provider call unchanged.

**Full suite: 256/256 across 17 files.** Lint clean.

**What changes on your next build with references:**
- Wave 1 (scaffold): builder sees Navbar.jsx *and* your logo/hero images while writing the Navbar → Navbar actually gets your palette + your logo.
- Wave 2 (public): builder sees Landing.jsx *and* your reference → hero composition, hierarchy, typography all re-anchored on your reference.
- Wave 3 (auth): same — auth forms inherit the visual language instead of regressing to a template.
- Wave 4 (dashboard): same — dashboard looks like part of the same designed product.
- Repair wave: if any of the above gets flagged as broken, the repair also sees the image.

Visual fidelity no longer decays across waves because the LLM re-anchors visually every file it writes. Same pattern E1 uses when I'm building apps directly.

**Token cost delta:** ~170 extra input tokens per wave × 4 waves = ~680 extra input tokens per build (low-detail image = ~85 tokens). Negligible relative to the 8k-16k output budget per wave.

**Still deferred (Session 24+):**
- Deterministic pixel-based palette extraction (stop asking LLM for hex codes; use k-means on image bytes).
- Recipe families (`saas-clean` / `editorial-serif` / `brutalist-raw` / `luxury-minimal` / ...) with Vision classifier picking which family per reference.
- Google Fonts auto-loading (so `fontDisplay: Playfair Display` actually renders as Playfair, not system serif).
- Vision-extracted layout blueprint (closed-form Q&A) feeding parameterized recipe primitives.
- Generative brand imagery via Nano Banana / GPT Image 1.

### Session 22 (COMPLETE, 2026-02-18) — Design tokens: art direction that actually ships

User feedback: *"it's still not using the art direction — people need to upload any image and have the AI generate off of that."* Prior sessions extracted prose like *"warm palette, clean sans-serif"* and stuffed it in the prompt. LLMs ignored it because recipes hardcoded `bg-violet-500` / `bg-black/40` / `text-white/70`. Prompts lost to recipe source code every time.

**The unlock: structured tokens + CSS-variable recipes.**

**Shipped:**

1. **`/app/lib/ai/design-tokens.js`** — new module.
   - `analyzeDesignTokens(images, provider)` → second Vision call (separate from `analyzeArtDirection`) returns STRICT JSON: `{bg, surface, surface2, border, ink, inkMuted, primary, primaryInk, accent, radius, radiusLg, fontDisplay, fontBody, mode, vibe, avoid[]}`. Uses `response_format: json_object`. Non-blocking on failure.
   - `parseTokens(raw)` → validates essentials (bg/ink/primary required), merges `FALLBACK_TOKENS` for missing keys, coerces `mode` to dark|light, caps `avoid` list at 6.
   - `buildThemeFile(tokens)` → deterministic generator for `components/theme.js`. Exports `DESIGN_TOKENS`, `cssVars` (keyed by `--var`), and `<ThemeProvider>` that wraps children with the CSS vars applied as inline style + sets `data-theme` + `data-vibe` attributes. Escapes backticks/`$` in font-family strings.
   - `formatTokensForPrompt(tokens)` → compact string the builder prompt inlines with palette + vibe + explicit "avoid" rules.
   - `FALLBACK_TOKENS` → safe default matching the prior aesthetic so projects with no uploaded references don't regress.

2. **Pipeline wiring in `message-stream.js`** — new Step 1.5b after art direction: calls `analyzeDesignTokens`, attaches result to `plan.designTokens`, emits SSE `design_tokens` event. Before the builder runs, writes `components/theme.js` to the project via `aiService.saveFiles` (same LLM-bypass strategy as `components/assets.js`).

3. **Recipe rewrite (the critical structural change).** Every themed recipe was swapped from hardcoded Tailwind colors to CSS-variable arbitrary-value syntax:
   - `text-white` → `text-[var(--ink)]`, `text-white/70` → `text-[var(--ink-muted)]`
   - `bg-white` / `bg-white/5` → `bg-[var(--primary)]` / `bg-[var(--surface)]`
   - `bg-black/40` → `bg-[var(--surface-2)]`
   - `border-white/10` → `border-[var(--border)]`
   - `bg-white text-black` → `bg-[var(--primary)] text-[var(--primary-ink)]`
   - `from-violet-500 to-indigo-500` → `from-[var(--primary)] to-[var(--accent)]`
   - `rounded-xl` stays, but brand accents use `rounded-[var(--radius)]` / `rounded-[var(--radius-lg)]`
   - `font-display` set via `style={{ fontFamily: 'var(--font-display)' }}` on `h1`/`h2`
   - Rewritten: `app_router` (wraps in `<ThemeProvider>`), `navbar_glass`, `footer_4col`, `landing_page`, `signup_form`, `login_form`, `forgot_password_form`, `forgot_password_success`, `pricing_3tier`, `onboarding_wizard`, `dashboard_empty_state`, `settings_page`, `data_table`, `chat_interface`, `search_page`, `generic_list_page`, `item_detail_crud`, `empty_state`, `profile_page`, `stripe_pricing_3tier`.
   - `grep -cE "text-white|bg-white|border-white|from-violet|to-indigo|bg-black|bg-violet|text-black|text-gray-|bg-gray-" lib/ai/recipes.js` → **0 matches.** Recipes are fully theme-token-driven.

4. **Builder prompt (`brief-builder.js`)** — new DESIGN TOKENS block between BRAND and HARD RULES, rendering the tokens + listing the exact arbitrary-value classes the LLM must use. New **HARD RULE #18 (THEME-TOKEN DISCIPLINE)** bans `text-white`, `bg-white`, `from-violet-500`, etc., and enumerates the allowed `var()` classes.

5. **Reviewer (`brief-reviewer.js`)** — new **rule 11** flags any generated file with hardcoded Tailwind color classes as `<path>: hardcoded-color-classes-bypass-theme`, which triggers the repair wave to rewrite in theme variables.

6. **`+22` design-token tests** + 5 new builder/reviewer prompt tests. **Full suite: 248/248 across 17 files.** Lint clean. Testing agent `iteration_113.json` confirmed 0 issues + grep sanity check of recipes.js.

**What happens now on a fresh build with uploaded references:**
1. Vision #1 → `analyzeArtDirection()` prose (kept for semantic grounding in planner).
2. Vision #2 → `analyzeDesignTokens()` → JSON palette/fonts/radius/vibe.
3. `components/theme.js` emitted deterministically with the user's actual palette.
4. `app/page.jsx` wraps in `<ThemeProvider>` which sets CSS vars on the root.
5. Every recipe renders with `bg-[var(--primary)]`, `text-[var(--ink)]`, etc. — which resolve to the user's palette.
6. Reviewer flags any deviation; repair wave rewrites.
7. Post-repair safety net (from Session 21.5) still runs.

Output should now reflect the uploaded references' actual palette, typography, radius, and mood — not the default violet/cyan slop.

**Deferred (Session 23+):**
- Option B (layout cloning from references — blueprint-aware landing page).
- Option C (Nano Banana / GPT Image 1 for brand-styled hero/feature illustrations).
- Branded custom domains via Vercel Domains API.
- Stripe Checkout server-function auto-gen.

### Session 21.5 (COMPLETE, 2026-02-18) — Deterministic post-repair safety net

User's second real-world test still failed — prompt rules alone can't guarantee the LLM will use user-uploaded logos, avoid router-level navbars, or refuse generic copy. LLM-based enforcement is probabilistic. Ship a **non-LLM deterministic post-processor** that runs after the review/repair wave.

**Shipped:**

1. **`/app/lib/ai/post-repair.js`** — three fixers + orchestrator:
   - `stripRouterLandmarks()` — regex-removes `<Navbar />`, `<Footer />`, and their imports from `app/page.jsx` (covers self-closing and block-form, inline and multi-line).
   - `ensureNavbarLogo()` — when a logo asset was uploaded, replaces the recipe's gradient-square placeholder OR any `">… Logo <"` plain-text placeholder with `<img src={LOGO_URL} alt="Logo" className="h-8 w-auto" />`. Falls back to prepending the img inside the brand button. Auto-injects `import { LOGO_URL } from './assets'` if missing.
   - `ensureHeroImage()` — injects `<img src={HERO_URL}>` into the landing page's hero section (or first `<section>` / `<main>`) when a hero asset exists.
   - `runPostRepair(files, {imageAssets})` — orchestrator that runs only applicable fixers, returns ONLY the files actually modified so the caller can feed the diff straight to `saveFiles`. All fixers are idempotent + conservative (refuse to patch when no safe anchor is found).

2. **Pipeline wiring in `message-stream.js`** — new Step 5b runs immediately after the LLM's review/repair wave. Fetches the final file list from DB, runs `runPostRepair`, saves changed files, and emits a `files_saved` SSE event with `action: 'post_repair'` so the client can surface what was fixed.

3. **21 targeted unit tests** in `test_post_repair.test.js` covering every fixer + the orchestrator (idempotency, no-op safety, all-three-in-one-pass).

**Full suite: 222/222 across 16 files.** Lint clean.

**Why this matters:** The user's real-world screenshot showed the LLM hardcoding "Nexsara Logo" as a text node. No amount of prompt coaxing will reliably prevent that — it's a case of the LLM finding loopholes in the rules. The deterministic pass catches it after the fact. Every future build will have the logo and hero images correctly rendered, and no duplicate navbars, REGARDLESS of what the LLM does.

### Session 21 (COMPLETE, 2026-02-18) — Regression guards for broken generations

Real user feedback flagged 3 fatal regressions in the generated app output:
1. Duplicate navbars stacked in the preview (router AND pages both rendered Navbar).
2. User-uploaded logos were silently ignored — preview showed placeholder gradient squares instead.
3. Marketing copy was generic "Welcome to our platform" SaaS boilerplate, not brand-specific.

**Shipped (regression fixes + test coverage):**

1. **`components/assets.js` auto-injection** — when the user attaches images to the brief, `mapImageAssets()` tags each upload with a role (logo/hero/reference) using filename heuristics, and `buildAssetsFileContent()` emits a valid JS module with escaped base64 data URLs. `message-stream.js` writes this file BEFORE the builder runs — bypassing the LLM entirely so base64 strings never get truncated. The builder prompt tells the LLM to `import { LOGO_URL, HERO_URL, REFERENCE_0 } from '../components/assets'` and render them instead of recipe gradient placeholders.

2. **HARD RULE #15 in `brief-builder.js`** — "ROUTER CLEANLINESS": `app/page.jsx` MUST NOT render `<Navbar />` or `<Footer />` directly. Each page renders its own Navbar + Footer. Rule explicitly names "DUPLICATE navbars" so the LLM connects the rule to the bug class.

3. **HARD RULE #16** — "USE PROVIDED IMAGE ASSETS": if `components/assets.js` exists, the Navbar MUST render `<img src={LOGO_URL} />` and hero MUST render `<img src={HERO_URL} />`, never a placeholder.

4. **HARD RULE #17** — "BRAND COPY DISCIPLINE": the H1, subhead, feature cards, and CTAs must reference the brand's description/audience/tone. Bans "Get Started", "Welcome to our platform", "Lorem ipsum", generic "Fast · Secure · Scalable" bullets.

5. **Reviewer rules 8, 9, 10 in `brief-reviewer.js`** — catches router-level Navbar rendering (`app/page.jsx: router-renders-navbar-causing-duplicates`), ignored logo/hero uploads (`ignored-user-logo` / `ignored-user-hero-image`), and generic marketing copy (`generic-marketing-copy`). Each flagged issue triggers the existing auto-repair wave.

6. **`BriefProgressCard.jsx`** — when review flags gaps AND auto-repair didn't fully resolve them, now surfaces a list of the first 4 issues as actionable amber hints instead of silently showing green success.

7. **Refactor**: extracted `mapImageAssets` + `buildAssetsFileContent` from the 3959-line `message-stream.js` into `brief-utils.js` so they're testable. Exported `buildWaveSystemPrompt` from `brief-builder.js` for prompt-rule regression tests.

**Tests:** +27 targeted unit/prompt tests (`mapImageAssets` 9, `buildAssetsFileContent` 7, `buildWaveSystemPrompt` 7, `reviewBuild` prompt 4). Full suite **201/201 across 15 files**. Lint clean. Testing agent `iteration_112.json` confirmed zero issues, all regression guards in place.

**Deferred (Session 22+):**
- Real E2E build with actual image upload requires a live browser session + LLM credits — confirmed via prompt-rule coverage that the instructions reach the LLM; the LLM's adherence rate is naturally probabilistic and already backed by the reviewer + auto-repair loop.
- Branded custom domains (Vercel DNS TXT verification flow).
- Stripe Checkout server-function auto-gen.

## Prioritized Backlog

### P0 — Session 22
- **Live dogfood** with an actual image upload + custom brief to verify the 3-rule combo solves the regression end-to-end in production.
- **Branded custom domains** via Vercel Domains API — `POST /v10/projects/{id}/domains`, DNS TXT verification polling, verified badge when live.
- **Auto-generated server-side Stripe Checkout function** in Vercel export (`api/stripe/checkout.js` template that reads user's secret key from env).

### P1 — Session 23
- **Share link analytics** — timeline of views + remixes per share token.
- **Remix count badge** on the originating project so creators see their impact.
- **Search/filter on gallery** — by archetype, by time, by popularity.

### P2 — Growth (Session 24+)
- Team collaboration (multi-user per project)
- Analytics dashboard (build/deploy/archetype trends, funnel)
- Referral / invite loops
- Project templates / one-click starters
- Per-archetype recipe tuning admin
- Multi-image art-direction weighting

## Implemented (earlier sessions — 2026-02)

### Session 20 (COMPLETE, 2026-02-18) — Public project gallery + publish toggle

The social loop now has a front door. Together with the Remix endpoint shipped in Session 19, creators can publish → visitors discover → remix → build their own — end-to-end on the platform.

**Shipped:**

1. **Public `/gallery` page** (unauthenticated) — lists projects where `settings.is_public === true` as cards with thumbnail gradient, name, description, archetype badge, view count, and a "Remix" shortcut. Clicking a card navigates to `/share/{token}` (the shared preview + Remix button page shipped in Session 19). Empty state has a "Build the first one" CTA; populated state uses a responsive `sm:grid-cols-2 lg:grid-cols-3` grid. Cache headers `public, max-age=30` for scale.

2. **Publish/Unpublish endpoints** — `POST /api/projects/:id/publish` (auth + ownership checked, requires files before publish). Mints a **never-expiring** share token if one doesn't exist; reuses existing if present. Sets `settings.is_public=true` + `published_at`. `POST /api/projects/:id/unpublish` removes those flags but keeps the share URL live (direct visitors can still access via `/share/{token}`, just no longer listed in gallery).

3. **`PublishModal` + ProjectHub "Publish" button** — new button next to Versions/Backend. Opens modal with clear copy on what publishing does ("Anyone can preview + remix"). After successful publish, shows "View public page" + "Browse the gallery" shortcuts. Already-public projects get an "Unpublish" option.

4. **Gallery discovery from LoginPage** — small cyan link "or explore apps built by the community" below the sign-in headline — exposes the gallery to unauthenticated visitors so the social loop spreads on public web surfaces without requiring account creation.

5. **`db.projects.findPublic({limit, offset})`** new DB helper using JSONB `settings->>is_public` filter for scale.

**Tests:** +13 gallery route tests (`test_gallery_routes.test.js`). Full suite **174/174 across 15 files**. Lint clean. Testing agent `iteration_111.json` confirmed 100% backend + 100% frontend success.

**Deferred (Session 21):**
- **Branded custom domains** — Vercel `/v10/projects/{id}/domains` API; needs DNS TXT verification flow + polling, whole UX panel of its own.

## Prioritized Backlog

### P0 — Session 21 (launch-polish)
- **Branded custom domains** via Vercel Domains API — `POST /v10/projects/{id}/domains`, DNS TXT verification polling, verified badge when live
- **Auto-generated server-side Stripe Checkout function** in Vercel export (`api/stripe/checkout.js` template that reads user's secret key from env)

### P1 — Session 22
- **Share link analytics** — timeline of views + remixes per share token
- **Remix count badge** on the originating project so creators see their impact
- **Search/filter on gallery** — by archetype, by time, by popularity

### P2 — Growth (Session 23+)
- Team collaboration (multi-user per project)
- Analytics dashboard (build/deploy/archetype trends, funnel)
- Referral / invite loops
- Project templates / one-click starters
- Per-archetype recipe tuning admin
- Multi-image art-direction weighting

## Implemented (earlier sessions — 2026-02)

### Session 19 Part 1 (COMPLETE, 2026-02-18) — a11y-fix loop closure + Remix-this-app (social loop)

Two high-ROI wins instead of the originally planned 3 items (Vercel webhook deferred — it needs team-level integration which end users don't have; polling at 3s is pragmatically fine).

**Shipped:**

1. **"Fix N a11y issues" contextual chip** — closes the audit → repair loop. After PreviewTab's Audit button finds violations, it broadcasts the result via `window.__EMANATOR_LATEST_A11Y__` + `emanator:a11y-result` CustomEvent. `QuickActionChips` subscribes and conditionally renders a red `data-testid='quick-action-fix-a11y'` chip showing "Fix N a11y issues". Clicking it pre-fills the composer with a properly-formatted prompt: *"Fix these accessibility violations flagged by the audit: [bulleted list with impact, help text, and HTML snippet]. Preserve the existing design — only change what's needed to resolve these issues."* Makes Emanator the first builder with a **visible closed a11y loop**: audit finds issues, one click, next build fixes them.

2. **Remix button + endpoint on shared previews (social loop unlock)** — new `POST /api/shared/:token/remix` clones the `files_snapshot` into a new project for the authed user, seeds a chat, attaches `remixed_from: { token, title }` to settings. `/share/{token}` page gets a gradient "Remix this app" button. Unauthenticated visitors get redirected to login with a return URL so the remix fires immediately after sign-in. Error states: 401/403/404/410 (expired) all handled + tested.

**Tests:** +6 remix tests (`test_share_remix.test.js`). Full suite **161/161 across 14 files**. Lint clean. Testing agent `iteration_110.json` confirmed 100% backend + 100% frontend success.

**Deferred from Session 19:**
- **Vercel deploy webhook** — needs team-level integration; polling at 3s is acceptable. Unblocked when we build a proper Emanator Vercel OAuth app post-launch.
- **Multi-image art-direction comparison** — edge case; most users upload 1-2 references. Revisit based on usage data.
- **Per-archetype recipe tuning admin** — heavy-weight admin UX, properly a Session 20+ item.

## Prioritized Backlog

### P0 — Session 20 (launch-ready polish)
- **Public project gallery** — list projects where `settings.is_public === true` with view counts + Remix button on each card. Capitalizes on the Remix infrastructure shipped today.
- **One-click "make public" toggle** on ProjectHub (creates a share token + sets `is_public`).
- **Branded custom domains** via Vercel's `/v1/projects/{id}/domains` API.

### P1 — Session 21
- **Auto-generated server-side Stripe Checkout function** included in Vercel export.
- **Share link analytics** — timeline of views + remixes per share token.
- **Remix count badge** on the originating project so creators see their impact.

### P2 — Growth (Session 22+)
- Team collaboration (multi-user per project)
- Analytics dashboard (build/deploy/archetype trends, funnel)
- Referral / invite loops
- Project templates / one-click starters
- Per-archetype recipe tuning admin
- Multi-image art-direction weighting

## Implemented (earlier sessions — 2026-02)

### Session 18 (COMPLETE, 2026-02-18) — Axe-core a11y audit + conversational-edit quick-action chips

**Shipped:**

1. **Axe-core live a11y audit against preview iframe** — new "Audit" button in PreviewTab toolbar (`data-testid='preview-audit-a11y'`) posts `__RUN_A11Y_AUDIT__` to the iframe. Iframe lazy-loads axe-core from unpkg CDN (~400KB gzipped, only on first audit), runs `axe.run(document)` against the preview DOM, posts results back via `__PREVIEW_A11Y_RESULT__`. Parent renders results in a collapsible panel (`data-testid='preview-a11y-panel'`) with color-coded impact badges (critical/serious/moderate/minor), violation HTML snippets, and deep-links to the Deque help docs. Clean runs show green "No violations" confirmation with the passes count. Complements (and catches what's missed by) the existing prompt-based RULE 6 a11y gate in the reviewer.

2. **Conversational-edit quick-action chips** — new `QuickActionChips.jsx` renders above ChatComposer on existing projects (`selectedChat && messages.length > 1`). 5 generic chips (Change color, Add a page, Mobile-friendlier, Rewrite copy, Polish UI) + 1 archetype-specific chip (Add feature for SaaS, Add project for portfolio, Tune prompt for AI apps, etc.). Clicking pre-populates the composer with a helpful starter prompt + focuses the textarea. ChatComposer now accepts `ref` from LeftPanel via `forwardRef` (already existed, just wired).

**Tests:** +7 chip data tests (`test_quick_action_chips.test.js`). Full suite now **155/155 across 13 files**. Lint clean. Testing agent `iteration_109.json` confirmed 100% backend + 100% frontend success.

## Prioritized Backlog

### P0 — Session 19
- **Vercel deploy webhook** — replace 3s polling with push notifications (Vercel sends state updates directly to our endpoint)
- **Multi-image art-direction comparison** — when user uploads 3+ references, let them weight/reject individual images before the planner runs
- **Per-archetype recipe tuning admin** — admin UI to edit recipe code + hot-reload without redeploy

### P1 — Session 20 (launch-ready)
- **Public project gallery + Remix button** — list public projects, "Remix" button clones the latest `auto_build` snapshot into a new project for the viewer
- **Branded custom domains** — user attaches their own domain to a deployed Vercel project
- **Auto-generated server-side Stripe Checkout function** — export includes `api/stripe/checkout.js` template that uses user's secret key env var

### P2 — Growth/scale (Sessions 21+)
- Team collaboration (multi-user per project)
- Analytics dashboard (build counts, deploy counts, archetype trends, funnel)
- Referral / invite loops
- Project templates / one-click starters

## Implemented (earlier sessions — 2026-02)

### Session 17 Part 2 (COMPLETE, 2026-02-18) — Versioning/rollback UI + Vercel deploy status polling

**Shipped:**

1. **Vercel deploy status polling UX fix** — polling infrastructure existed but only updated the history list; users stared at an amber "QUEUED" chip that never changed on the just-deployed card. Fixed: polling now updates both `deployments[]` AND the fresh `deployResult` card, so the chip flips amber "Building" → green "Live" automatically when Vercel returns READY. Poll interval dropped 5s → 3s. New status chip (`data-testid='deploy-result-status'`) on the result card.

2. **Versioning/rollback UI** — complete snapshot system:
   - **Auto-snapshot** after every successful brief build (`message-stream.js` Step 6, non-critical) with metadata `{ kind: 'auto_build', archetype, brand, file_count, run_id }`.
   - **Pre-restore safety snapshot** — before destroying current state during a rollback, automatically snapshot it as `kind: 'pre_restore'` so the user can undo the undo.
   - **DELETE /snapshots/:id** endpoint + `db.snapshots.delete()` helper.
   - **`VersionsPanel.jsx`** modal opened from ProjectHub "Versions" button. Shows color-coded snapshot rows (cyan = auto build, amber = pre-restore, neutral = manual). Latest row marked with "latest" chip. Restore uses 2-click confirmation. Delete is hover-revealed.
   - Share-link snapshots (`__share__*`) are filtered out so they don't clutter the version history.

3. **Tests:** +10 new snapshot route tests (auth, CRUD, pre-restore flow). Full suite now 148/148 across 12 files.

## Prioritized Backlog

### P0 — Session 18
- **Axe-core live a11y audit** against preview iframe (the one deferred item from Session 17)
- **Conversational-edit quick-action chips** on generated files ("Change color", "Add a new page", "Rename") that pre-populate the chat composer

### P1 — Session 19
- **Per-archetype recipe tuning admin** — non-main-agent users can edit recipes without redeploy
- **Multi-image art-direction comparison** — weight/reject individual references when user uploads 3+ images
- **Vercel deploy webhook** — replace polling with push notifications

### P2 — Launch-ready (Session 20+)
- Public project gallery / remix-a-friend's-app
- Branded custom domains for deployed apps
- Team collaboration (multi-user per project)
- Auto-generated server-side Stripe Checkout function in export

## Implemented (earlier sessions — 2026-02)

### Session 17 Part 1 (COMPLETE, 2026-02-18) — One-click Deploy to Vercel (real, not broken)

The biggest launch-gating feature. Before this session the `/api/projects/:id/deploy/vercel` route technically existed but sent the raw generation output (React hooks-as-globals, no package.json scaffold, `framework: null`) — which would **fail on Vercel's build step**. This session wires the existing `buildVercelReadyFileMap` into the deploy path, turning the button from cosmetic into real.

**Shipped:**

- **Real Vercel deploy** — `POST /api/projects/:id/deploy/vercel` now uses `buildVercelReadyFileMap` to produce a Vite + React + Tailwind scaffold (package.json, index.html, src/main.jsx with React imports auto-injected into every generated file), sends `projectSettings.framework='vite'` + `buildCommand='npm run build'` + `outputDirectory='dist'`, and base64-encodes all file contents per Vercel API v13 spec. Conditional deps (@supabase/supabase-js, @stripe/stripe-js, react-router-dom) flow through from previous sessions.
- **Token persistence** — optional "Remember token for this project" checkbox in DeployTab. When checked, Vercel PAT is saved to `project.settings.vercel.token` so the user only pastes it once. Prefills on subsequent visits.
- **Project name sanitization** — `"Cool App!! 2026"` → `"cool-app-2026"` for Vercel's naming rules.
- **Clear error surfacing** — Vercel API errors (expired token, forbidden, etc.) bubble through with original message + code.
- **Tests:** +8 Jest tests in `test_vercel_deploy.test.js` (mocks db + global fetch, exercises all error paths + happy path + saveToken flow). Full suite now 138/138 across 11 test files.

**Not shipped this session (Session 17 Part 2):**
- Versioning/rollback UI — snapshot list + restore in ProjectHub
- Axe-core live a11y audit against preview iframe

## Prioritized Backlog

### P0 — Session 17 Part 2
- **Versioning/rollback UI** — snapshot list + diff view + restore flow in ProjectHub
- **Axe-core live a11y audit** — run axe against preview iframe, surface issues as a tab

### P1 — Session 18
- **Vercel deploy status polling** — post-deploy, poll `/v13/deployments/{id}` until state=READY and auto-update the URL chip
- **Conversational-edit quick actions** on generated files
- **Per-archetype recipe tuning admin**
- **Multi-image comparison in art-direction**

### P2 — Future
- Public project gallery / remix-a-friend's-app
- Branded custom domains for deployed apps
- Team collaboration
- Server-side Stripe Checkout function auto-generated as part of the Vercel export

## Implemented (earlier sessions — 2026-02)

### Sessions 15 + 16 (COMPLETE, 2026-02-18) — Stripe + art-direction + responsive review

Shipped 3 of the 5 planned items thoroughly. Deferred 2 honestly for Session 17 (bigger UX projects — shipping them alongside would have been shallow).

**Shipped:**

1. **Stripe opt-in wiring (Session 16 headline)** — same pattern as Supabase. Two new recipes (`stripe_client`, `stripe_pricing_3tier`). `recipesForWave({useStripe})` swaps `pricing_3tier` → Stripe Checkout variant when the user has added a publishable key. `BackendConfigModal` got a Stripe field (validates `pk_test_` / `pk_live_` prefix — rejects secret keys). Vercel bundler emits `@stripe/stripe-js` dep, `VITE_STRIPE_PUBLISHABLE_KEY` in `.env.local.example`, and a README section with Checkout-session endpoint contract. Preview falls back to signup route when unconfigured.

2. **Art-direction reference-screenshot loop (Session 15 headline)** — new `lib/ai/art-direction.js` runs GPT-4o Vision on 1–4 reference images uploaded with a Creative Brief. Produces a tight aesthetic brief (Aesthetic / Palette / Typography / Layout / Motion / AVOID). Piped BEFORE planning (Step 1.5 in `runNewBriefPipeline`) and injected into both the architect prompt and every wave's builder prompt. `BriefProgressCard` shows a collapsible "Art direction from N references" summary chip. SSE event `art_direction` wired end-to-end (stream-handler → stream-client → useDashboardStream → message metadata).

3. **Responsive self-review pass** — new HARD RULE #14 in `brief-builder.js` (RESPONSIVE BASELINE: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, responsive headlines, mobile nav toggles, `max-w-*` containers). Reviewer RULE 7 flags missing responsive classes as broken → triggers auto-repair.

**Deferred to Session 17 (scope-managed):**
- **Versioning/rollback UI** — real UX project (snapshot list, diff view, restore flow). Not a prompt tweak.
- **Axe-core live a11y audit** — needs to run axe against the preview iframe. Expensive relative to existing prompt-based a11y gate (RULE 6 already catches most issues). Revisit if real a11y regressions appear post-launch.

**Tests:** 130/130 pipeline tests pass (+10 Stripe wiring, +8 art-direction) across 10 test files. Testing agent `iteration_106.json` confirmed 100% backend + 100% frontend success. Lint clean.

## Prioritized Backlog

### P0 — Session 17 (NEXT)
- **One-click Deploy to Vercel** — call out by user as highest-ROI next. Vercel Deploy API + OAuth. Takes "ZIP → manual upload" to "type brief → 2 min later live on the open internet".
- **Versioning/rollback UI** — snapshot list + restore flow in ProjectHub
- **Axe-core self-review** — run against the preview iframe for real a11y auditing (supersedes prompt-based RULE 6)

### P1 — Session 18
- **Conversational code editing UX polish** — quick-action chips on generated files ("Change color", "Add a new page"), surface file-edit intent clearer in the chat
- **Per-archetype recipe tuning** — admin dashboard to edit recipes without redeploying
- **Multi-image comparison in art-direction** — when user uploads 3+ references, let them weight/reject individual images

### P2 — Future
- Public project gallery / remix-a-friend's-app
- Branded custom domains for deployed apps
- Team collaboration (multi-user per project)

## Implemented (earlier sessions — 2026-02)

### Session 14 (COMPLETE, 2026-02-18) — Real backend opt-in + Vercel-ready export + chat-driven iteration

**3 major deliverables shipped (+ honest deferrals):**

1. **Vercel-ready ZIP export** — `/app/lib/export/vercel-bundler.js` wraps every generated app in a standalone Vite + React + Tailwind project. Emits `package.json` (with conditional `@supabase/supabase-js` dep), `vite.config.js`, `index.html`, `src/main.jsx`, `src/index.css`, `tailwind.config.js`, `postcss.config.js`, `README.md` (with Vercel + Netlify instructions), and `.gitignore`. Auto-injects `import React, { ... } from 'react'` into every generated JSX file so files designed for the global-hook preview runtime Just Work in a real bundler. Detects `react-router-dom` usage and adds it as a dep when needed.

2. **Real Supabase wiring (opt-in)** — project-scoped Supabase URL + anon key via a new `BackendConfigModal` on ProjectHub. Three new recipes (`supabase_client`, `supabase_auth_context`, `supabase_mock_api`) that gracefully fall back to localStorage in preview and use real Supabase auth + CRUD in production. `recipesForWave()` swaps mock → Supabase variants when `plan.useSupabase` is true (threaded from `runNewBriefPipeline` → project settings). Vercel bundler replaces the preview-safe client file with real `import.meta.env` wiring on export.

3. **Chat-driven code editing (verified + surfaced)** — the legacy intent→plan→diffs pipeline in `message-stream.js` **already handles follow-up messages on generated apps**; the Creative Brief fast-path only fires on the initial "Build this project now…" message. Follow-up prompts like "add a sidebar" / "make the primary button green" route through the existing apply-diffs flow. Surfaced in UX: `ChatComposer` placeholder now reads *"Ask me to add a feature, change styles, or fix something — I'll edit the code."* after the first build.

**Honestly deferred (won't fit in one session without shipping broken work):**
- **Full Stripe wiring** — separate session; needs real keys + webhook plumbing + pricing-page adaptation
- **Art-direction reference-screenshot loop** — separate session; needs vision prompt engineering + UI for image uploads at brief time

**Tests:** 110/110 pipeline tests pass (+11 Vercel bundler tests, +10 Supabase wiring tests on top of Session 13's 89). Lint clean. Testing agent (`iteration_105.json`) confirmed 100% backend + 100% frontend success. Three small infrastructure fixes done in-passage by the testing agent (missing `db.exports` helper, PATCH method on projects, resilient export persistence).

## Prioritized Backlog

### P0 — Session 15 (NEXT)
- **Art-direction reference-screenshot loop** — accept image uploads in the Creative Brief form; GPT-4o Vision describes the aesthetic into the brief planner; Iteration 2 matches the uploaded reference better
- **Automated responsive/breakpoint correctness pass** during self-review (complements Session 13's a11y work)

### P1 — Session 16
- **Stripe wiring** for generated apps (opt-in like Supabase; real checkout + webhook templates)
- **Versioning/rollback UI** for projects (snapshot + restore)
- **Axe-core / Lighthouse subset** in self-review for real a11y auditing (not prompt-based)

### P2 — Future
- Per-archetype recipe-tuning admin dashboard
- Project templates / one-click starters on the Dashboard empty state
- Full SSE dry-run mode (plan preview is already the MVP for trust)

## Implemented (earlier sessions — 2026-02)

### Session 13 (COMPLETE, 2026-02-18) — Personal build stats widget + accessibility baseline

**3 deliverables shipped:**

1. **"Your builds this week" dashboard widget** — new `/api/stats/my-builds` endpoint (auth-gated, user-scoped) returns `{ total_this_week, fastest_seconds, favorite_archetype: { id, count, label } }` computed from the user's last 7 days of successful `new_pipeline:*` runs in `generation_runs`. New `MyBuildsWidget.jsx` renders 3 chips (total builds, fastest time, favorite archetype) above the Projects tab row. Self-hides when the user has zero builds — no dead UI.

2. **Accessibility baseline across every generated app** — targeted a11y upgrade on 7 core recipes (`navbar_glass`, `signup_form`, `login_form`, `forgot_password_form`, `onboarding_wizard`, `pricing_3tier`, `landing_page`):
   - `<label htmlFor="id">` pairs matched with `id` on every input
   - `autoComplete` hints (`email`, `new-password`, `current-password`)
   - `aria-invalid` / `aria-describedby` wiring on form inputs
   - `role="alert"` + `aria-live="polite"` on error banners
   - `<nav aria-label="Main navigation">` + `<main>` semantic landmark
   - `role="progressbar"` with `aria-valuenow/min/max` on the onboarding wizard
   - Skip-to-content link on `landing_page`
   - `focus-visible:ring-2 focus-visible:ring-white/50` on every interactive element
   - `aria-hidden="true"` on decorative gradients and icons

3. **Enforcement in the pipeline prompts** — new **HARD RULE #13** in `brief-builder.js` mandates the accessibility baseline in all freshly generated files; `brief-reviewer.js` (line 69) now flags `missing-label-for-input` / `missing-role-alert` / missing `aria-label` as **broken** during the self-review pass, triggering auto-repair.

**Tests:** 89/89 pipeline tests pass (added 5 new tests for `/stats/my-builds` in `test_stats_my_builds.test.js`). Lint clean. Testing agent confirmed 100% success on both backend and frontend checks (iteration_104.json).

## Prioritized Backlog

### P0 — Session 14 (NEXT)
- Real Supabase wiring opt-in for generated apps: user provides Supabase URL + anon key in project settings → recipes swap MockAPI calls for real Supabase client at generation time
- Responsive pass (mobile breakpoints, tablet) on generated output — complements the a11y work

### P1 — Session 15
- Deployable Vercel export with one-click deploy-to-Vercel button (verify `ExportTab.jsx` produces a working `package.json` + `next.config.js`)
- Versioning/rollback UI for projects
- Automated accessibility audit during the self-review (axe-core or lighthouse subset) instead of prompt-based review

### P2 — Future
- Stripe wiring for user-paid builds
- Per-archetype recipe-tuning admin dashboard
- Project templates / one-click starters on the Dashboard empty state

## Implemented (earlier sessions — 2026-02)

### Session 1 (COMPLETE, 2026-02-18)
- `/app/lib/ai/archetypes.js` — 17 archetypes (SaaS, AI app, marketplace, social, content, portfolio, e-commerce, dashboard, chat, utility, CRM, LMS, booking, community, media, productivity, landing-only), regex-first classifier + LLM fallback, mergeArchetypeWithBrief guaranteeing required routes, canonical ROUTE_FILE_MAP, normalizeRouteName alias resolver
- `/app/lib/ai/brief-planner.js` — generatePlan() + validatePlan() + planWaves(). Routes list is deterministic (never dropped by LLM). Wave ordering: scaffold → public → auth → app. Empty waves filtered.
- `/app/lib/ai/recipes.js` — 12 production-ready recipes: auth_context, mock_api, app_router, navbar_glass, footer_4col, signup_form, login_form, forgot_password_form, onboarding_wizard, pricing_3tier, dashboard_empty_state, landing_page. Tailwind-only, React-globals-compatible, data-testids on every interactive.
- Tests: `/app/backend/tests/test_archetypes.test.js` + `test_brief_planner.test.js` — 48/48 tests pass.

### Session 2 (COMPLETE, 2026-02-18)
- `/app/lib/ai/brief-builder.js` — `buildWave()` runs a single wave via forced `create_files`, injects wave-specific recipes, enforces the wave's declared file list (over-produced files dropped), has tool_args_delta recovery + non-streaming retry. `runAllWaves()` orchestrates the full plan and aborts if scaffold fails.
- `/app/lib/ai/message-stream.js` — added `runNewBriefPipeline()` module-level function at EOF. Fast-path gate now checks `EMANATOR_NEW_PIPELINE` env flag; when set, routes brief → classify archetype → generate plan → stream waves → save. When unset, legacy fast-path runs **unchanged**.
- `/app/lib/stream-client.js` — registered new SSE events (`archetype`, `brief_plan`, `wave_start`, `wave_complete`, `wave_error`, `build_aborted`, `review_result`, `repair_start`) with callbacks.
- Tests: `/app/backend/tests/test_brief_builder.test.js` — 6 tests.

### Session 3 (COMPLETE, 2026-02-18)
- `/app/lib/ai/brief-reviewer.js` — `reviewBuild()` runs a strict self-critique pass (JSON mode, peeks at scaffold + auth + landing files). `repairBuild()` runs ONE repair wave via `create_files`/`update_files` to fix missing/broken items. Non-blocking on provider failure.
- `runNewBriefPipeline` now: classify → plan → build waves → **review → auto-repair** → done. Fetches content via `db.projectFiles.findByProjectId` for review context.
- `/app/components/dashboard/BriefProgressCard.jsx` — live progress UI with archetype badge, wave status icons, review pass/gaps indicator, ETA.
- `useDashboardStream.js` + `LeftPanel.jsx` — wired 8 new SSE callbacks to update `message.metadata.briefProgress`.
- Event collision fix: renamed new pipeline's `plan` event to `brief_plan`.
- Tests: `test_brief_reviewer.test.js` — 8 tests.

### Session 6 (COMPLETE, 2026-02-18) — Preview Fix + Archetype Hint
- `/app/components/dashboard/ArchetypeHint.jsx` — live archetype preview chip in the brief form
- `PreviewTab.jsx` AST plugin: added `window.__NAMED__` registry + `__namedImport()` resolver so named imports of non-component values (hooks, utils) work correctly. PascalCase named imports still use `__lazy`.

### Session 7 (COMPLETE, 2026-02-18) — Flag Removed, Legacy Deleted, Landing Metric
- **REMOVED `EMANATOR_NEW_PIPELINE` feature flag** from `.env.local`
- **DELETED 308 lines of legacy single-file code** from `message-stream.js` (was 4146, now 3838)
- Global hook-name safety net (`window.useAuth`, `window.useMockAPI`) as runtime fallback for LLM-omitted imports
- "From blank page to working app in under 2 minutes" credibility marker on `LoginPage.jsx`

### Session 8 (COMPLETE, 2026-02-18) — Codegen Robustness + Persistence + Share
- `autoInjectMissingImports()` in `brief-utils.js` — scans every generated file for bare `useAuth()`/`useMockAPI()` calls and auto-inserts correct relative-path import. Runs in `normalizeFiles()` pipeline.
- Backend persistence for BriefProgressCard — `stream-handler.js` accumulates archetype/plan/wave/review events into `messages.metadata.briefProgress` on save. Survives chat reload.
- Editable archetype chip — `ArchetypeHint` picker dropdown with all 17 archetypes. Override flows via `Archetype override: <id>` in brief text, bypasses LLM classification.
- Share-build-time feature — clipboard copy + twitter.com/intent/tweet link on BriefProgressCard.

### Session 9 (COMPLETE, 2026-02-18) — 🎉 Full Validation, 4 New Recipes
- Validation dogfood (iteration_103.json): **5/5 features passed, 100% success**. NexsaraV9 built in 72 seconds, 17 files, auto-generated Signup/Login/Dashboard without being asked.
- Added 4 recipes: `generic_list_page`, `item_detail_crud`, `forgot_password_success`, `search_page` wired into archetype-specific wave selection.

### Session 10 (COMPLETE, 2026-02-18) — Telemetry + Real P50 + Archetype Quick-Start
- Build telemetry via existing `generation_runs` (tool_mode encoded as `new_pipeline:${archetype.id}`), no schema changes.
- `/api/stats/build-times` endpoint with P50/P95/counts.
- Landing page now shows real P50 median when ≥5 builds exist.
- ArchetypeQuickStart tiles in InlineBrief (6 one-click starter archetypes).

### Session 11 (COMPLETE, 2026-02-18) — Telemetry-Informed UX
- `/api/stats/build-times` returns per-archetype `total`, `success_rate`, `avg_seconds`.
- Confidence badges in archetype picker (Emerald ≥80%, Amber 50-79%, Grey <50%, "New" for untested).
- Telemetry-informed plan preview on ArchetypeHint: "~17 files · ~122s to build · 94% success".

### Session 12 (COMPLETE, 2026-02-18) — Recommended Archetypes + Remix

**2 UX-coherent features landed:**

1. **Recommended Archetypes surface** — when classifier confidence is 0.55–0.70 (ambiguous), ArchetypeHint now shows 2–3 archetype cards side-by-side instead of silently picking one. Each card:
   - Archetype label
   - Confidence badge (Emerald/Amber/Grey by success rate, or "New")
   - First required flow as preview text
   - "Top" indicator on the auto-detected winner
   - Click → commits that archetype as override
   - Tagline: "Top match will be used if you don't pick — or just keep typing to refine."

   Turns "Emanator guessed" into "Emanator showed me the options." `classifyArchetypeFast` now returns `runnersUp: Archetype[]` (top 3) alongside the primary pick.

2. **Remix archetype** — post-build, BriefProgressCard now shows a "Remix as different archetype" button with a dropdown picker of the other 16 archetypes (current one excluded). Clicking one:
   - Composes a proper Creative Brief message with `Archetype override: <id>`
   - Pre-fills the chat composer via the existing `[data-testid="chat-input"]` dispatch pattern
   - User clicks Send to trigger the rebuild
   - Tagline: "Picking one will pre-fill the chat with a remix brief — click Send to rebuild."

   No new backend routes needed — reuses the existing archetype-override flow. Surgical UX addition, ~120 lines total across BriefProgressCard.

**Tests:** 84/84 pipeline tests pass (33 archetype tests including new runnersUp assertions). Lint clean. HTTP 200.

**Deliberately deferred:**
- Real Supabase wiring opt-in → Session 13 (needs a full feature flow for key collection + MockAPI→Supabase template swap)
- Deployable Vercel export → Session 14 (needs export format + deploy hook integration)

## Prioritized Backlog

### P0 — Session 13 (NEXT)
- Real Supabase wiring opt-in for generated apps: user provides Supabase URL + anon key in project settings → recipes swap MockAPI calls for real Supabase client at generation time
- Responsive / accessibility passes on generated output (mobile breakpoints, ARIA, focus states)

### P1 — Session 14
- Deployable Vercel export with one-click deploy-to-Vercel button
- Versioning/rollback UI for projects
- Project templates / one-click starters on the Dashboard empty state

### P2 — Future
- Stripe wiring for user-paid builds
- Full SSE dry-run mode if plan preview isn't enough
- Per-archetype recipe-tuning admin dashboard
- Multi-step onboarding wizard for first-time Emanator users

**UX-coherent delivery (respecting user's "build to the flow" directive):**

1. **Per-archetype stats in the API** — `/api/stats/build-times` endpoint now returns `archetype_stats` with `total`, `success_rate`, `avg_seconds` per archetype. Computed from last 500 runs in the 30-day window.

2. **Confidence badges in the archetype picker** — Picker items now show either:
   - `N · XX%` pill (emerald if ≥80% success, amber 50-79%, grey <50%) when the archetype has ≥3 historical builds
   - `New` badge for archetypes with no track record yet
   - Tooltip on hover: "N builds · XX% success · avg Ys"
   Users picking between "saas_tool" vs "ai_app" now see which is *proven* at a glance.

3. **Telemetry-informed plan preview** — New bottom row on the ArchetypeHint card:
   - `Plan preview: ~17 files · ~122s to build · 94% success across 12 builds`
   - Uses archetype's own avg when available; falls back to global P50
   - Zap icon, `data-testid="archetype-plan-preview"`
   - This is effectively a client-side dry-run — users see what they're committing to BEFORE clicking Build, without the complexity of backend stream pause/resume.

**The UX flow this session enables:**
```
User types brief → ArchetypeHint appears ("Looks like a SaaS tool / B2B software")
  → User sees "~17 files · ~122s · 94% success" below
  → Confidence: decide-go or remix archetype via picker
  → Pick different archetype → see its confidence badge + updated plan preview
  → Click Build with informed expectations
```

**Tests:** 84/84 pipeline tests pass. Lint clean. Stats endpoint verified returning `archetype_stats` (6 historical `unknown` builds; new builds will populate per-archetype).

**Deliberately deferred:**
- "Remix archetype" button on existing projects (rebuild-in-place needs file versioning plumbing; different feature) — Session 12
- Full SSE pause/resume dry-run (complex backend; plan preview delivers the trust value without this) — Session 12 if still wanted

## Prioritized Backlog

### P0 — Session 12 (NEXT)
- "Remix archetype" button on existing projects with file-archive + fresh-build
- Real Supabase wiring opt-in for generated apps (replaces MockAPI with per-project real backend)
- Deployable Vercel export

### P1 — Session 13
- Responsive / accessibility passes on generated output
- Versioning/rollback UI for projects
- Project templates / one-click starters

### P2 — Future
- Full SSE dry-run mode if plan-preview trust proves insufficient
- Per-archetype recipe-tuning admin dashboard (uses the same telemetry)
- Stripe wiring for user-paid builds

**Build telemetry — zero schema changes:**
- `runNewBriefPipeline` now logs `tool_mode: 'new_pipeline:${archetype.id}'` into the existing `generation_runs` table. Archetype is encoded in the tool_mode string; no migration needed.
- New `/api/stats/build-times` endpoint at `/app/lib/api/routes/stats.js`. Queries last 200 successful builds in the 30-day window, computes P50/P95/fastest, returns counts by archetype. 60-second cache. Public (no auth) — these are marketing metrics. Clamps anomalies (<5s, >15min).

**Landing page now shows REAL data:**
- `LoginPage.jsx` fetches `/api/stats/build-times` on mount. When ≥5 builds exist, the metric changes from static "under 2 minutes" to dynamic **"From blank page to working app in 122 seconds · median of 6 builds"** (cyan accent, dim subtitle). First-time credibility shifts from "claim" to "evidence".
- Current live values: P50=122s, P95=162s, fastest=35s across 6 builds.

**Archetype quick-start tiles in InlineBrief:**
- New `/app/components/dashboard/ArchetypeQuickStart.jsx` — 6 clickable tiles (SaaS tool / AI app / Marketplace / Portfolio / Store / CRM) with icon + label. Renders above the "What are you building?" input.
- Click fills `elevator_pitch` with a starter template + sets `archetype_override` so the pipeline skips LLM classification. Turns a blank form into a decisive starting point.

**Tests:** 84/84 pipeline tests pass. Lint clean. HTTP 200. Stats endpoint verified returning real data. Screenshot confirmed P50 rendered cleanly on landing.

**Deferred to Session 11 (scope creep defense):**
- "Remix archetype" button on existing projects — overlaps with the editable picker; bigger ask than Session 10 budget
- Dry-run / confirm-before-build mode — requires new SSE pause/resume plumbing

## Prioritized Backlog

### P0 — Session 11 (NEXT)
- "Remix archetype" button on existing projects: rebuild with new archetype preserving brand/copy
- Dry-run / confirm mode: pause pipeline at `brief_plan`, require user click to start waves
- "Build recipe preview" link in archetype picker: show file/flow breakdown before committing

### P1 — Session 12
- Real Supabase wiring opt-in for generated apps (replace MockAPI with real backend)
- Deployable Vercel export
- Responsive / accessibility passes on generated output

### P2 — Future
- Versioning/rollback UI for projects
- Project templates / one-click starters
- Per-archetype success-rate dashboard (uses the same telemetry)

**Validation dogfood (iteration_103.json): ALL 5 FEATURES PASSED, 100% success rate.**

- ✅ **Feature 1 — Archetype hint with editable picker** (SaaS tool / B2B software detected, picker has 17 archetypes, reset-to-auto works)
- ✅ **Feature 2 — autoInjectMissingImports post-processor** (Signup.jsx first non-blank line is `import { useAuth } from '../components/AuthContext'` — LLM omitted the import, post-processor auto-inserted it)
- ✅ **Feature 3 — Preview renders cleanly** (no useAuth/useMockAPI runtime errors)
- ✅ **Feature 4 — BriefProgressCard persistence** (card survives tab switches, shows "72s to working app")
- ✅ **Feature 5 — Share build time** (copy-to-clipboard works, tweet intent URL valid)

**Build stats from the dogfood:**
- Project: NexsaraV9 (SaaS archetype)
- 17 files across 4 waves
- Build time: **72 seconds** — beats the "under 2 minutes" promise on the landing page
- Auto-generated Signup/Login/Dashboard/Onboarding without user asking for them

**4 new recipes added this session:**
- `generic_list_page` — list view with Navbar + DataTable + create CTA (used by CRM/marketplace/e-commerce/productivity)
- `item_detail_crud` — edit/save/delete detail view (same archetypes)
- `forgot_password_success` — standalone success page after forgot-password submit
- `search_page` — live-filter search across any MockAPI collection (content_site/e-commerce/lms/marketplace/media)

**Recipe wiring updated in `recipesForWave()`:**
- Dashboard-heavy archetypes → get `data_table` + `generic_list_page` + `item_detail_crud`
- Content/commerce archetypes → get `search_page`
- Any archetype with `forgot_password_form` → automatically gets `forgot_password_success` too

**Tests:** 84/84 pipeline tests pass, lint clean, HTTP 200.

**Minor issues deferred:**
- CORS warning for `react-router-dom` from unpkg in preview iframe (non-blocking, noted in test report)
- Signup form could use more visual polish (recipe enhancement candidate)

## Prioritized Backlog

### P0 — Session 10 (NEXT)
- Archetype onboarding cards on Emanator landing page (6 big tiles replacing/alongside the current login form — turns the landing into "what will you build today?")
- "Remix archetype" button on existing projects: one-click swap archetype while preserving brand/copy
- Optional dry-run / confirm-before-build mode (~200 lines UI + stream plumbing)
- P50/P95 "time to working app" metric on Emanator's own dashboard (observability)

### P1 — Session 11
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- "Build recipe" link next to each archetype in the picker showing file/flow breakdown

### P2 — Future
- Responsive / accessibility passes on generated output
- Versioning/rollback UI for projects
- Project templates / one-click starters
- Real backend polish for generated apps (beyond MockAPI)

**4 deliverables shipped:**

1. **Missing-imports post-processor** — `autoInjectMissingImports()` in `/app/lib/ai/brief-utils.js` scans every generated file for bare `useAuth()`/`useMockAPI()` calls and auto-inserts the correct relative-path import if absent. Runs in `normalizeFiles()` after every wave + repair. Fixes the LLM's occasional import-omission at save time instead of relying on the runtime safety net. 11 new unit tests cover: pages/*, components/* (uses `./` path), never-touches-source-files, idempotent, combined imports, injects-after-existing-imports.

2. **BriefProgressCard persistence to backend** — `stream-handler.js` now accumulates `archetype` / `brief_plan` / `wave_complete` / `review_result` events during the stream into `briefProgressAccumulator`, then writes it into `messages.metadata.briefProgress` on final save. Chat reload via `loadMessages()` now restores the progress card from database metadata — card survives page refresh.

3. **Editable archetype chip** — ArchetypeHint now renders its archetype label as a clickable button with a ChevronDown. Click → opens a scrollable picker of all 17 archetypes. Selecting one sets `brief.archetype_override`, which gets appended to the build instructions ("Archetype override: saas_tool"). The pipeline's classifier step now checks for `Archetype override:` in the message text FIRST and skips LLM classification when user has explicitly chosen one. "Reset to auto" link returns to the auto-detected archetype.

4. **Share-build-time button** — `ShareBuildTime` sub-component on `BriefProgressCard`. Shows two pills after build completion: "Share build time" (copies "I just built {brand} — a working {archetype} with {N} files in {seconds} seconds. 🚀 #Emanator" to clipboard) + "Tweet it" (opens pre-filled twitter.com/intent/tweet). Zero dependencies.

**Tests:** **84/84 pipeline tests pass**, lint clean, service restart clean, HTTP 200. Smoke screenshot confirmed InlineBrief form renders properly with The Big Picture section visible.

**Status of the runtime safety net:** still in place as belt-and-suspenders. Two layers now protect against missing imports: (1) codegen post-processor inserts them at save time, (2) runtime `window.useAuth` / `window.useMockAPI` catches any that slip through.

## Prioritized Backlog

### P0 — Session 9 (NEXT)
- End-to-end validation dogfood confirming: new builds now include `useAuth` imports on first try, archetype override works, BriefProgressCard persists across reload, share button works
- Optional dry-run / confirm-before-build mode: render the plan for 10 seconds with a Cancel button before starting waves
- Remaining recipes: `forgot_password_success`, `generic_list_page`, `item_detail_crud`, `search_page`

### P1 — Session 10
- Archetype onboarding cards on landing (6 giant tiles instead of login form as primary CTA)
- "Remix archetype" button on existing projects — swap archetype while preserving brand/copy
- "Time to working app" metric that tracks the P50 / P95 over the last 100 builds (observability)

### P2 — Future
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- Responsive / accessibility passes
- Versioning/rollback UI
- Project templates / one-click starters

**🎉 MILESTONE: New pipeline is the only pipeline.** Fourth dogfood (iteration_102.json) confirmed:
- ✅ `__namedImport` preview fix works (landing page renders cleanly, Navbar + Login with imports work)
- ✅ Symbol-name discipline holds
- ✅ All wins from Sessions 1–6 hold
- Remaining: LLM occasionally drops the `import { useAuth }` line → runtime `useAuth is not defined`

**Shipped in this session:**
- **Global hook-name safety net** — preamble pre-declares `window.useAuth` / `window.useMockAPI` as deferred-lookup wrappers that scan `__NAMED__` for the hook. Files without imports now fall through to the global instead of throwing `ReferenceError`. Real imports continue to shadow the global (correct).
- **Mandatory-imports prompt rule** (HARD RULES #12) — every wave + repair prompt now explicitly requires `import { useAuth }` / `import { useMockAPI }` at the top of any file that uses them. Reduces the problem at the source.
- **REMOVED `EMANATOR_NEW_PIPELINE` env flag** — deleted from `/app/.env.local`.
- **DELETED the legacy single-file fast-path** — 308 lines of dead code removed from `message-stream.js` (was lines 141–448). File is now 3838 lines (was 4146). New pipeline is the unconditional path for all Creative Brief submissions.
- **Landing page credibility marker** — `LoginPage.jsx` now shows `"From blank page to working app in under 2 minutes"` under the "AI Builder Platform" subtitle. Cyan accent, `data-testid="landing-time-metric"`. Screenshot-verified rendering cleanly.

**Tests:** 73/73 pipeline tests pass, lint clean, service healthy, HTTP 200.

## Known Issues
- BriefProgressCard disappears on chat reload (frontend-only metadata). Deferred to Session 8. Low user-facing impact.
- Occasional LLM-omitted import statements are now **non-blocking** at runtime thanks to global safety net, but ideal would be 100% import discipline. Session 8 could add a codegen post-processor that inserts missing imports.

## Prioritized Backlog

### P0 — Session 8 (NEXT)
- Post-processor for missing imports: scan generated files for `useAuth`/`useMockAPI` calls; if a file uses them without importing, auto-insert the import line before save. Eliminates the runtime-fallback dependency.
- BriefProgressCard persistence: write `briefProgress` into `messages.metadata` JSON column on save, restore on `loadMessages`. ~50 lines.
- Add editable archetype chip in InlineBrief — if user disagrees with the auto-detected archetype, click to pick a different one from the 17 available.

### P1 — Session 9
- Optional dry-run / confirm-before-build mode
- "Remix archetype" button on existing projects
- Archetype onboarding cards on landing (6 giant tiles instead of/alongside the login form)
- Remaining recipes: `forgot_password_success`, `generic_list_page`, `item_detail_crud`, `search_page`

### P2 — Future
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- Responsive / accessibility passes
- Versioning/rollback UI
- Project templates / one-click starters

**Third dogfood (iteration_101.json) key wins verified:**
- ✅ Symbol-name fix **confirmed working** — all generated code uses lowercase `signup`/`login`/`logout`, no more camelCase drift
- ✅ Double-escape fix holds — all 17 files have real newlines
- ✅ **NEW: ArchetypeHint component** appears live as user types the brief. Verified: "Looks like a SaaS tool / B2B software" appears with auto-routes ("login · signup · forgot_password · dashboard"). Turns the invisible classification step into a trust-building moment before the 90-second build.

**Blocker surfaced: preview iframe threw `useAuth is not a function`** even though generated code was correct. Root cause: the Babel AST plugin in `PreviewTab.jsx` rewrote all named imports as `__lazy('useAuth')`, which returns a React component wrapper — not a callable hook.

**Fix shipped (Session 6):**
- Added `window.__NAMED__` registry to preview runtime preamble
- Added `__namedImport(modName, exportName)` resolver — returns a deferred function that looks up the real hook at call time (handles any eval order)
- Patched AST plugin's `ImportSpecifier` handler: PascalCase named imports keep the `__lazy` path (named component exports), lowercase ones use `__namedImport` (hooks/utils)
- Patched AST plugin's `ExportNamedDeclaration` handler: now emits `window.__NAMED__[modName].exportName = exportName` for every named function/const export, so sibling files can resolve them

**New components/files:**
- `/app/components/dashboard/ArchetypeHint.jsx` — client-side live archetype preview below the elevator-pitch field

**Known minor issue deferred to Session 7:**
- BriefProgressCard disappears on chat reload because `briefProgress` metadata is frontend-only (not persisted to backend). The earlier preserve-on-save fix works during the stream, but `loadMessages()` wipes it on chat switch. Fix needs backend metadata persistence or sessionStorage hydration. LOW user-facing impact (card is correctly shown during the build — the moment that matters).

**Flag status:** `EMANATOR_NEW_PIPELINE=1` remains active. Flag removal deferred to Session 7 pending one more dogfood confirming the preview actually renders end-to-end now.

## Prioritized Backlog

### P0 — Session 7 (NEXT)
- **Final dogfood** to verify the `__namedImport` / `__NAMED__` fix makes the preview render cleanly (no `useAuth is not a function`). If green, **remove the flag and legacy single-file prompt** — milestone.
- Fix BriefProgressCard persistence: persist `briefProgress` to message metadata in backend (small schema addition + write in runNewBriefPipeline), or sessionStorage hydration in useDashboardStream
- Add the "Time to working app" metric (~90s) as a credibility marker on Emanator's landing page

### P1 — Session 8
- Optional dry-run / confirm-before-build mode
- "Remix archetype" button
- Archetype onboarding cards on landing
- Remaining recipes

### P2 — Future
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- Responsive / accessibility passes
- Versioning/rollback UI
- Project templates / one-click starters

### Session 4 (COMPLETE, 2026-02-18) — DOGFOOD + double-escape fix
- Flipped `EMANATOR_NEW_PIPELINE=1`, ran testing agent on Nexsara brief → 17 files in 162s, Signup auto-generated ✓
- Found bug: LLM double-escaped content in repair wave → literal `\n` instead of newlines
- Fix: `/app/lib/ai/brief-utils.js` with `normalizeFileContent()` helpers, applied in builder + reviewer

### Session 5 (COMPLETE, 2026-02-18) — Symbol-name discipline + 5 recipes
- Second dogfood confirmed double-escape fix; surfaced LLM camelCase drift (`signUp` instead of `signup`)
- Fix: "★ EXACT SYMBOL NAMES" prompt section in builder + reviewer
- Added 5 recipes: settings_page, profile_page, data_table, chat_interface, empty_state
- Smart archetype-aware recipe injection in `recipesForWave()`
- Live "time to working app" elapsed counter on BriefProgressCard

## Known Issues
- BriefProgressCard disappears after chat reload (frontend-only metadata, not persisted). Deferred to Session 7.

## 3rd Party Integrations
- OpenAI GPT-4o via Emergent LLM key (text + vision)
- Supabase (projects DB + auth)
- E2B Sandbox

## Critical Rules for Next Agent
- DO NOT install `sharp` or native binary modules (crashes Next.js).
- The `frontend` supervisor entry is a dead CRA leftover; the real app runs via `nextjs_api`. Ignore frontend FATAL status unless port 3000 actually stops responding.
- PreviewTab.jsx supports multi-file imports via its AST plugin. Now also supports NAMED imports of non-component values (hooks, utils) via the new `__NAMED__` registry + `__namedImport()` resolver (PascalCase = lazy component, camelCase = named function).
- Tests use Jest via next/jest; run with `npx jest backend/tests/<file>.test.js`.
- The legacy single-file fast-path at `message-stream.js` lines 145–176 is scheduled for removal next session, but remains in place until one more successful dogfood confirms the preview renders cleanly with the new `__namedImport` fix.
