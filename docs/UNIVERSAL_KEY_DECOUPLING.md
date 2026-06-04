# Gemini ↔ Emergent Universal Key decoupling (2026-02)

## What changed

Auroraly's Gemini (Google) provider used to route through the Emergent
Universal Key OpenAI-compatible proxy when the user had no direct
`GEMINI_API_KEY` set. That meant Gemini calls were:

- shared across all Auroraly tenants on a single proxy key
- subject to the proxy's combined spend budget (one tenant's heavy use
  could exhaust the shared cap)
- invisibly substituted on the user's behalf — a "Gemini" turn was
  actually OpenAI-tunneled-through-proxy

As of 2026-02, the proxy fallback is **removed**. Gemini calls now go
direct to Google's endpoint using a Google API key the user provides.
If they don't have one, the AIService explicitly falls back to OpenAI
with a loud log line — no silent proxy substitution.

## Implementation

| Layer | Behavior |
|-------|----------|
| `lib/ai/service.js#_apiKey` | Returns the direct Google key from `GEMINI_API_KEY` or `GOOGLE_API_KEY`. Returns `null` if neither is set — does NOT fall through to proxy. |
| `lib/ai/service.js#_buildProvider` | When `_apiKey` returns null for Gemini, explicitly switches to OpenAI (using `OPENAI_API_KEY`) and logs the reason. |
| `lib/ai/service.js#_proxyOptions` | Returns `{}` — no proxy options ever attached. |
| `lib/ai/providers/index.js#createProvider` | Branches on `options.baseURL` for legacy proxy routing, but `_proxyOptions` never sets it now, so this branch is effectively dead in production. Left in place so an enterprise tenant who DOES configure a proxy via env can opt back in. |
| `lib/ai/providers/gemini.js` | Always constructs `GoogleGenerativeAI` with the direct key. Header doc updated to reflect direct-only mode. |

## Required environment variables

```
GEMINI_API_KEY=...        # OR GOOGLE_API_KEY — either works
OPENAI_API_KEY=...        # used as fallback if Gemini key missing
ANTHROPIC_API_KEY=...     # for Claude turns
```

`EMERGENT_PROXY_URL` and `EMERGENT_LLM_KEY` are no longer read by the
chat path. They remain available for the legacy proxy code path
(`options.baseURL` branch in `createProvider`) but are not wired into
the AIService.

## Backwards-compat notes

- The `wantsGemini` branch in `lib/ai/image-service.js` (Nano Banana
  image generation) was already using the direct key
  (`process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY`) — no
  change needed there.
- The phased pipeline (`lib/ai/message-stream.js` line ~148) already
  builds `GeminiProvider` from the direct key with no proxy options —
  no change needed there.

## How to test

```bash
# Unset Gemini keys to verify fallback fires
unset GEMINI_API_KEY GOOGLE_API_KEY
# Start a chat with Gemini selected — should log:
#   [AIService] no GEMINI_API_KEY/GOOGLE_API_KEY set — falling back to OpenAI ...
# and the actual turn should run on GPT-4o.
```

The contract is locked in `tests/test-gemini-decoupling.test.mjs`.
