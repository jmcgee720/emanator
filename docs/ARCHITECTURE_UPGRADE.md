# Emanator → Agent Platform: Architecture Upgrade Spec

**Status:** DRAFT — awaiting approval before implementation
**Scope:** The three unlocks that close 80% of the gap to E1 behavior
**Owner:** Main agent
**Last updated:** 2026-02

---

## 0. Problem recap (one paragraph)

Emanator's current Creative Brief fast-path produces a single `app/page.jsx` file via one forced `create_files` call with `max_tokens: 16384`. For any non-trivial brief (SaaS, marketplace, social app), the model cannot fit a full app in one completion and silently truncates — shipping a beautiful hero followed by a placeholder. It also only builds pages/flows the user *explicitly* names, so archetype-required flows (Sign Up, onboarding, settings) are routinely missed.

Three changes close this gap:

1. **Archetype inference** — a pre-build classifier that returns required routes + flows for the detected app type
2. **Multi-file output** — stop forcing `app/page.jsx` and use the AST transform that already exists in `PreviewTab.jsx`
3. **Plan-then-build, chunked** — architect call → build waves → self-review, instead of one shot

Everything in this spec is additive to the existing fast-path. No existing behavior regresses. Rollback = one env flag.

---

## 1. Architecture overview

### 1.1 Current flow (as-is)

```
User submits brief
  → message-stream.js line 112 fast-path detected
  → extractField() parses brief into {brand, colors, pages, features, ...}
  → briefSystemPrompt built (forces one file, inline components)
  → provider.chatWithToolsStream() with tool_choice: create_files
  → single create_files tool call received
  → saveFiles() → preview refresh
  → DONE
```

**Problem:** one LLM call, 16k output cap, one file, no planning, no self-check.

### 1.2 New flow (to-be)

```
User submits brief
  → message-stream.js fast-path detected
  → Phase A: ARCHITECT
     • extractField() as today
     • classifyArchetype(brief) → archetype + required flows
     • generatePlan(brief + archetype) → {routes, components, flows, dataShapes}
     • Plan validated against archetype manifest (required routes present)
     • Plan streamed to client as status event (user sees "Planning: 7 routes, 12 components")
  → Phase B: BUILD (chunked)
     • Wave 1: scaffold (app/layout, router, AuthContext, MockAPI) + navbar + footer
     • Wave 2: public routes (landing, features, pricing)
     • Wave 3: auth routes (login, signup, forgot)
     • Wave 4: app routes (dashboard, settings, product pages)
     • Each wave:
        - Receives FULL plan + files-built-so-far as context
        - Emits only its subset of files via create_files
        - Streams to preview
  → Phase C: REVIEW
     • Self-critique pass: "List flows from the plan that are missing or dead"
     • If gaps found → one REPAIR wave fills them
  → DONE
```

---

## 2. The three unlocks — detailed specs

### 2.1 Unlock #1: Archetype inference

**Goal:** Emanator infers Sign Up, Onboarding, Settings, etc. without being told, because it knows "SaaS tool" requires them.

#### 2.1.1 Archetype manifest

New file: `/app/lib/ai/archetypes.js`

```js
export const ARCHETYPES = {
  saas_tool: {
    label: 'SaaS tool / B2B software',
    triggers: /saas|platform|dashboard|workspace|tool for|team|organization|workflow|automation/i,
    requiredRoutes: ['landing', 'features', 'pricing', 'login', 'signup', 'forgot_password', 'dashboard', 'settings'],
    requiredFlows: [
      { id: 'auth', desc: 'signup → email verify (mock) → onboarding → dashboard' },
      { id: 'logout', desc: 'logout clears auth state and redirects to landing' },
      { id: 'pricing_cta', desc: 'pricing buttons route to signup with tier preselected' },
    ],
    dataShapes: ['User', 'Workspace', 'Item'],
  },
  marketplace: {
    label: 'Marketplace / two-sided platform',
    triggers: /marketplace|buyer|seller|listing|vendor|shop|browse/i,
    requiredRoutes: ['landing', 'browse', 'item_detail', 'login', 'signup', 'dashboard', 'my_listings', 'checkout'],
    requiredFlows: [
      { id: 'browse_to_buy', desc: 'browse → item detail → checkout → success' },
      { id: 'seller_onboard', desc: 'become-a-seller → create listing' },
    ],
    dataShapes: ['User', 'Listing', 'Order'],
  },
  social_app: { /* feeds, profiles, posts, follows */ },
  content_site: { /* blog, articles, newsletter */ },
  portfolio: { /* hero, projects, about, contact */ },
  ecommerce: { /* catalog, cart, checkout, orders */ },
  dashboard: { /* internal admin, data tables, filters */ },
  chat_app: { /* conversations, messages, presence */ },
  utility_tool: { /* single-purpose, input→output */ },
  // ... 10–15 total
}

export function classifyArchetype(brief) {
  // 1. Try trigger regex match first (cheap, deterministic)
  // 2. Fall back to LLM classification if ambiguous
  // Returns { archetype: 'saas_tool', confidence: 0.9, merged: {routes, flows, dataShapes} }
}
```

#### 2.1.2 LLM fallback classifier

Used only when regex triggers are ambiguous (multiple archetypes match, or none match).

```js
const classifierPrompt = `Classify this app brief into ONE archetype.
Archetypes: ${Object.keys(ARCHETYPES).join(', ')}
Brief: """${briefText}"""
Respond with JSON: {"archetype": "saas_tool", "confidence": 0.0-1.0, "reasoning": "..."}
If hybrid, pick the dominant one.`

// model: gpt-4o-mini, max_tokens: 150, temperature: 0, response_format: json_object
```

Latency: ~400ms. Cost: negligible.

#### 2.1.3 Merge with user input

```js
function mergeArchetypeWithBrief(archetype, userRequestedPages, userRequestedFeatures) {
  const routes = new Set([
    ...archetype.requiredRoutes,                        // always include
    ...userRequestedPages.map(normalizePageName),        // union with user's list
  ])
  const flows = archetype.requiredFlows                  // never drop required flows
  return { routes: [...routes], flows, dataShapes: archetype.dataShapes }
}
```

**Key invariant:** the user can *add* routes/flows, never *subtract* archetype-required ones.

---

### 2.2 Unlock #2: Multi-file output

**Goal:** Emanator emits a real file tree (10–20 files) instead of cramming everything into `app/page.jsx`.

#### 2.2.1 Why this is safe today

The handoff summary claims multi-file is fragile. It isn't anymore. `/app/components/dashboard/tabs/PreviewTab.jsx` lines 362–444 contain a Babel AST plugin that:

- Rewrites local imports (`./components/Navbar`) into `__lazy('Navbar')` calls
- Resolves asset imports (`.svg`, `.png`) to stubs
- Resolves package imports (`react-router-dom`) to globals
- Handles `export default`, named exports, re-exports
- Pre-registers every file's component name on `window` so bare identifier refs work

**Conclusion: multi-file is a solved problem in the preview runtime.** The fast-path prompt is fighting a ghost.

#### 2.2.2 Target file structure

Emitted per build (example for SaaS archetype):

```
app/
  page.jsx                    # root router component
components/
  Navbar.jsx                  # shared across public routes
  Footer.jsx
  AuthContext.jsx             # MOCK auth — useState + localStorage
  MockAPI.jsx                 # MOCK backend — in-memory store + localStorage
  ui/
    Button.jsx                # brand-consistent primitives
    Card.jsx
    Input.jsx
pages/
  Landing.jsx
  Features.jsx
  Pricing.jsx
  Login.jsx
  Signup.jsx
  ForgotPassword.jsx
  Dashboard.jsx
  Settings.jsx
  Onboarding.jsx
```

`app/page.jsx` is a thin router:

```jsx
export default function App() {
  const [route, setRoute] = useState('landing')
  const nav = (r) => setRoute(r)
  return (
    <AuthProvider>
      <MockAPIProvider>
        {route === 'landing'  && <Landing onNavigate={nav} />}
        {route === 'features' && <Features onNavigate={nav} />}
        {/* ... etc */}
      </MockAPIProvider>
    </AuthProvider>
  )
}
```

Each page imports `Navbar`, `Footer`, `ui/*` from `./components/...`. The AST plugin resolves these to `__lazy()` wrappers automatically — no config needed.

#### 2.2.3 Prompt changes (word-for-word)

Current (line 147 of `message-stream.js`):

```
RULES: One file `app/page.jsx`. All components inline. No imports from local files.
No react-router. No `import React`. Use only standard Tailwind classes.
useState for navigation. Default page: 'home'. 800-1000 lines.
Call create_files immediately — no explanations.
```

New:

```
RULES:
- Emit a MULTI-FILE structure. One file per route (pages/*.jsx), one file per shared component (components/*.jsx).
- `app/page.jsx` is a thin router: renders the current view based on `useState` route.
- Import local files with relative paths: `import Navbar from '../components/Navbar'`.
- NO `import React` (React is global). NO react-router (use state-based routing).
- NO external packages — Tailwind classes only, inline SVGs only.
- Every page receives `onNavigate` prop to switch routes.
- Wrap the app in `<AuthProvider>` and `<MockAPIProvider>` (you will create these).
- Call create_files with THIS WAVE's files only — no explanations.
```

#### 2.2.4 Required building blocks (always emitted)

Every build includes these regardless of archetype:

- `components/AuthContext.jsx` — `useContext` + `localStorage` persistence, exposes `{user, login, signup, logout, isAuthenticated}`
- `components/MockAPIProvider.jsx` — in-memory CRUD + `localStorage` per resource (`users`, `items`, etc.), seeded with realistic demo data
- `components/ui/Button.jsx`, `Card.jsx`, `Input.jsx` — brand-themed primitives

These are **recipe-driven** (see §2.3.4) — the AI doesn't reinvent auth plumbing each time. It composes from templates.

---

### 2.3 Unlock #3: Plan-then-build, chunked

**Goal:** never rely on one 16k-token completion. Plan first, build in waves, self-review, repair.

#### 2.3.1 Plan schema (JSON)

```ts
type BuildPlan = {
  archetype: string               // 'saas_tool'
  brand: { name, colors, tone }
  routes: Route[]                 // [{ id, name, file, description, components: [...] }]
  components: Component[]         // [{ name, file, usedBy: [routeIds], props }]
  flows: Flow[]                   // [{ id, steps: ['landing→signup', 'signup→onboarding→dashboard'] }]
  dataShapes: Shape[]             // [{ name, fields: [...] }]
  waves: Wave[]                   // build ordering: [{ id, files: [filePath] }]
}
```

The plan is produced by one `gpt-4o` call (~800 tokens out, ~1.5s). This is cheap and its output dramatically improves completeness because subsequent build calls have a contract to fulfill.

#### 2.3.2 Wave ordering (deterministic, not AI-decided)

```js
const WAVE_ORDER = [
  { id: 'scaffold', includes: ['app/page.jsx', 'components/AuthContext.jsx', 'components/MockAPIProvider.jsx', 'components/Navbar.jsx', 'components/Footer.jsx', 'components/ui/*.jsx'] },
  { id: 'public',   includes: ['pages/Landing.jsx', 'pages/Features.jsx', 'pages/Pricing.jsx', 'pages/About.jsx'] },
  { id: 'auth',     includes: ['pages/Login.jsx', 'pages/Signup.jsx', 'pages/ForgotPassword.jsx', 'pages/Onboarding.jsx'] },
  { id: 'app',      includes: ['pages/Dashboard.jsx', 'pages/Settings.jsx', /* archetype-specific pages */] },
]
```

Each wave:

1. Gets the full plan as context
2. Gets a list of files already built (with sizes, not contents, to save tokens)
3. Is asked to emit only its wave's files via `create_files`
4. Streams to preview immediately (user sees progress)

Token budget per wave: `max_tokens: 8000`. Well under the 16k cap. Each wave produces 4–6 files of ~300 lines each.

#### 2.3.3 Self-review (one pass, optional)

After all waves complete, one final call:

```
SYSTEM: You are reviewing the app you just built. Given the plan and the list
of files produced, identify any flow from the plan that is NOT fully wired.

A flow is "wired" if:
- Every route in the flow exists as a file
- Every button/form that should trigger navigation has onClick/onSubmit
- Auth flows persist to localStorage via AuthContext
- Forms actually submit to MockAPI

Respond with JSON: {"missing": [...], "broken": [...]}.
If both arrays are empty, respond {"ok": true}.
```

If gaps exist, one repair wave fires with `update_files` to fix them. Max one repair pass — prevents infinite loops.

#### 2.3.4 Recipe library (the quality multiplier)

New file: `/app/lib/ai/recipes.js`

```js
export const RECIPES = {
  auth_context: { /* exact AuthContext.jsx template as string */ },
  mock_api: { /* exact MockAPIProvider template */ },
  signup_form: { /* exact signup page template with validation */ },
  pricing_3tier: { /* pricing page template with 3 cards */ },
  dashboard_empty_state: { /* dashboard template with onboarding card */ },
  // ...
}
```

When a wave needs to produce a file that matches a recipe, the prompt includes the recipe as a reference:

```
For pages/Signup.jsx, use this structure as your starting point (adapt styling
to the brand, but keep the logic identical):

<RECIPE: signup_form>
${RECIPES.signup_form}
</RECIPE>
```

This is the biggest quality unlock. The AI is not inventing auth logic on every build — it's adapting a known-good template to the brand. This is how E1 stays consistent.

---

## 3. Implementation plan

### 3.1 File changes (exhaustive list)

| File | Change | Est. lines |
|------|--------|-----------|
| `/app/lib/ai/archetypes.js` | NEW — archetype manifest + `classifyArchetype()` | ~300 |
| `/app/lib/ai/recipes.js` | NEW — recipe library (auth, api, forms, pages) | ~600 |
| `/app/lib/ai/brief-planner.js` | NEW — `generatePlan(brief, archetype)` | ~200 |
| `/app/lib/ai/brief-builder.js` | NEW — `buildWave(plan, waveId, filesBuilt)` | ~250 |
| `/app/lib/ai/brief-reviewer.js` | NEW — `reviewAndRepair(plan, files)` | ~150 |
| `/app/lib/ai/message-stream.js` | REFACTOR fast-path (lines 106–427) to call planner → builder loop → reviewer | ~-250 / +150 net |
| `/app/lib/ai/tools.js` | ADD `update_files` to fast-path allowlist | ~5 |
| `/app/components/dashboard/useDashboardStream.js` | ADD handling for new `plan` and `wave_start` events | ~30 |
| `/app/components/dashboard/InlineBrief.jsx` | No changes to form. Show plan summary in chat log after submit. | ~40 |

Total: ~5 new files, 1 major refactor, 3 small additions. No breaking changes to existing routes or DB schema.

### 3.2 Rollout strategy (risk-controlled)

**Phase 1: Ship behind a flag** (1 session)
- Env var: `EMANATOR_NEW_PIPELINE=1`
- When unset → current single-file fast-path runs unchanged
- When set → new planner → builder → reviewer pipeline runs
- Default OFF during dev, flip ON after smoke tests pass

**Phase 2: Dogfood with you** (1 session)
- Flip flag ON
- Run 3 briefs: Nexsara (SaaS), a marketplace, a portfolio
- Collect screenshots + side-by-side comparisons
- Tune prompts / recipes based on output

**Phase 3: Remove flag, delete old fast-path** (1 session)
- After 2 successful dogfood runs, remove env flag
- Delete legacy single-file prompt (line 145–176)
- Keep the `create_files` forcing machinery — it's still used per wave

### 3.3 Event stream additions (SSE)

New events the backend will emit, consumed by `useDashboardStream.js`:

| Event | Payload | When |
|-------|---------|------|
| `archetype` | `{archetype, confidence}` | After classifier runs |
| `plan` | `{routes: [...], flows: [...], wavesTotal: 4}` | After architect call |
| `wave_start` | `{waveId, index, total, files: [paths]}` | Before each wave |
| `wave_complete` | `{waveId, filesBuilt: [paths]}` | After each wave saves |
| `review_result` | `{missing, broken}` | After self-review |

Client shows these as chat messages so the user sees the agent *thinking* — this alone dramatically improves perceived intelligence.

---

## 4. Testing strategy

### 4.1 Unit tests (`/app/backend/tests/` — pytest)

- `test_archetype_classifier.py` — feed 20 sample briefs, assert correct archetype
- `test_plan_validator.py` — assert every archetype's required routes appear in generated plan
- `test_recipe_integrity.py` — every recipe must parse as valid JSX, must export a component

### 4.2 Integration tests (testing_agent_v3_fork)

- Run the Nexsara brief end-to-end with the flag ON
- Assert: plan event fires, ≥4 wave_complete events fire, ≥8 files produced
- Assert: `pages/Signup.jsx` exists (was NOT in the brief — archetype inference must add it)
- Assert: clicking "Start Free Trial" in the preview navigates to signup (not dead)
- Assert: signing up navigates to onboarding, then dashboard
- Assert: refreshing the preview preserves login state (localStorage)

### 4.3 Visual regression (screenshot tool)

Take screenshots at:
- Landing (should match original quality)
- Signup (new — didn't exist before)
- Dashboard after signup (new — didn't exist before)

Compare against the Nexsara baseline screenshot in the handoff.

---

## 5. Success criteria

This upgrade is considered done when, given the Nexsara brief with no other input:

1. ✅ Emanator produces ≥ 8 files (vs. 1 today)
2. ✅ A working Sign Up page exists even though the brief never mentioned it
3. ✅ Clicking "Start Free Trial" → signup form → submit → dashboard works end-to-end in the preview
4. ✅ Refresh preserves auth state
5. ✅ The landing page is at least as polished as today's output
6. ✅ Total build time < 45 seconds for a typical brief
7. ✅ Stream does not time out (chunked calls stay under K8s 60s ingress limit)

---

## 6. Out of scope (on purpose)

These are real needs but NOT part of this upgrade. Calling them out so we don't scope-creep:

- Real backend wiring (Supabase): still mock-only in this phase
- Responsive/accessibility passes: follow-up phase
- Deployable export (Vercel): follow-up phase
- Follow-up build mode ("add a billing page"): works today via existing `update_files`, no changes needed here
- Versioning/rollback UI: separate feature
- Project templates / one-click starters: separate feature

---

## 7. Open questions for you

Before I implement:

1. **Archetype list** — I've sketched 9 archetypes in §2.1.1. Are there any specific app types you know users will want that I'm missing? (e.g., "AI chat app," "CRM," "LMS," "internal tool")
2. **Recipe source of truth** — should recipes live in code (`recipes.js` as template strings) or in a Supabase table (editable without deploy)? I'd recommend code for v1, migrate to DB later.
3. **Mock backend persistence** — `localStorage` per browser is fine for a demo, but if a user shares their preview URL with a client, they see different data. Acceptable for v1, or should I use a simple Supabase-hosted key-value store per project?
4. **Self-review strictness** — should the review pass be strict (auto-repair any missing flow) or informational only (report gaps, don't auto-fix)? Strict is better UX but costs another LLM call (~$0.01 per build).
5. **Flag behavior** — keep the `EMANATOR_NEW_PIPELINE` flag forever (power-user toggle), or delete after dogfood passes?

---

## 8. Estimated effort

- **Session 1:** `archetypes.js` + `recipes.js` (top 3 recipes: auth_context, mock_api, signup_form) + `brief-planner.js`
- **Session 2:** `brief-builder.js` (wave loop) + `message-stream.js` refactor + SSE event wiring
- **Session 3:** `brief-reviewer.js` + self-repair + testing_agent run + fixes
- **Session 4:** Polish, remaining recipes, dogfood with your briefs

Total: ~4 focused sessions. Each session is independently shippable behind the flag.
