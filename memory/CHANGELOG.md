# Changelog

All notable changes per session, newest first.

---

## 2026-02-XX — Preview timeout fix, v2 attachments, 529 retry

### Shipped (Vercel deploy in flight — commit `66cfc05`)

- **`/api/previews/[projectId]/start` maxDuration 300 → 800s.** Vercel
  was killing the boot before Fly finished `npm install` + dev-server
  bind, breaking the preview iframe. Now sized to match Vercel Pro
  Fluid Compute's 800s ceiling, matching the catch-all API route.
- **Attachments in v2 project chats.** Extracted
  `attachmentToContentBlock` + `buildUserContent` helpers in
  `lib/api/stream-handler-v2.js`. Text files, code files, and PDFs
  (with server-side extracted text) now flow into Claude's prompt as
  fenced text blocks alongside image vision blocks. Previously only
  images survived; PDFs/text were saved to message metadata but
  silently dropped from the LLM context. Both the current-message
  path and `loadPriorMessages` (history) use the same helper, so a
  follow-up turn can still reference a file uploaded earlier.
  Attachments >30k chars are truncated with a `[…truncated]` marker
  to bound context-window usage.
- **Anthropic 529 retry in compose phase.** Wrapped stream +
  non-stream tool calls in `withOverloadedRetry` (exponential 1s →
  2s → 4s + up to 500ms jitter, capped at 3 retries). 529 detected
  by `status === 529/503/502/504` OR message-text match (`overloaded`,
  `overloaded_error`, `service unavailable`). Non-transient errors
  (parse failures, format issues) short-circuit immediately.

### Tests added

- `tests/test-stream-handler-v2-attachments.test.mjs` — image, text,
  pdf attachments produce correct content blocks; unknown types
  gracefully degrade to plain text.
- `tests/test-phase-5-compose-retry.test.mjs` — retry succeeds after
  transient 529s, short-circuits on non-overloaded errors, bounded
  by `maxRetries`.

---


## 2026-02-XX — File-storage rewrite, /project-bin URL, Brief navigation fix

### Shipped (Vercel + Fly deploys live)

- **commit `11f5e33` — Single-source-of-truth file storage**
  - `lib/supabase/file-storage.js`: all text files always inline in
    `project_files.content`. Storage only used for `_assets/*` binary
    rows. `INLINE_SIZE_LIMIT = Infinity`, `MAX_FILE_BYTES = 2MB`.
    Oversized writes throw `FILE_TOO_LARGE` instead of silent spill.
  - `preview-runner/index.js`:
    - `/sync-from-supabase` loud-fails (502) when files are missing,
      no more silent skips on Storage 504s.
    - Removed `ensureNextHeadersOverride` (next.config shim).
    - Removed CRA `ajv-trio` overrides + craco patcher.
    - Removed Next.js `tailwindcss/postcss/autoprefixer` sidecar.
    - Removed legacy `/sync` endpoint.
    - Removed COEP headers from vite override (kept allowedHosts).
    - Boot log: `[runner v5.clean]`.
  - `next.config.js`: removed COEP/COOP/CORP headers entirely (no
    longer needed without WebContainers; resolves Firefox iframe
    "security configuration doesn't match" block).
  - `PreviewTab.jsx`: engine locked to `server`. Babel + WebContainer
    toggles removed.
  - `scripts/wipe-projects.sql`: one-shot DB wipe for fresh start.
  - Tests: 17 new file-storage cases all green.
  - Net diff: +254 / -512.

- **commit `60d7e73` — Creative Brief sessionStorage bridge**
  - Symptom: brief → create project → empty chat.
  - Root cause: `pendingHeroPromptRef` (useRef on bin Dashboard)
    destroyed by route navigation `/` → `/project/[id]`. New Dashboard
    mount started with empty ref, HeroPromptEffect saw `pending: false`
    and silently no-oped.
  - Fix: mirror payload to `sessionStorage` in `ProjectGrid.jsx`
    on write, rehydrate in `Dashboard.jsx` on first effect tick.
    Entry cleared after consumption to prevent replay on refresh.
  - Tests: 5-case regression test all green.

- **commit `cad3531` — /project-bin URL**
  - New route `app/project-bin/page.js` renders AppShell.
  - AppShell auto-redirects authenticated users from `/` to
    `/project-bin` via useEffect+pathname check. Login stays at `/`.
  - All 4 `router.replace('/')` calls in Dashboard updated to
    `/project-bin` (close last tab, exit workspace, etc.).

### Currently blocked

- **Compose phase fails with `FUNCTION_INVOCATION_TIMEOUT`**
  - User reported 504 on `/api/build/compose` step of build wizard.
  - Diagnosis BLOCKED: Vercel logs for `emanator` project show no
    entries since May 15 (current date is May 17). Either:
    - `auroraly.co` is routing to a different Vercel project
    - or logs UI is filtered to a stale date range
  - User asked to confirm which Vercel project serves `auroraly.co`.
  - Next steps: once project ID confirmed, diagnose actual compose
    timeout source (edge vs function). If edge timeout, switch
    `/api/build/compose` to SSE streaming.

### Other observations from this session

- Image-loss during `/sync-from-supabase` was the root cause of the
  Tailwind crash saga — fixed structurally by the file-storage rewrite,
  not by the layers of band-aid sidecars (ajv-trio, craco, postcss
  force-install) that we deleted.
- Killing WebContainers removed COEP requirements, which
  resolved Firefox iframe block as a side effect.
- The runner now runs only `npm install --legacy-peer-deps` + the
  project's own `scripts.dev`. No mutation of user configs.
