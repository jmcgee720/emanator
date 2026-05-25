// ────────────────────────────────────────────────────────────────────────
// web_search tool — Tavily-backed live web access for the project agent
// ────────────────────────────────────────────────────────────────────────
//
// Why this exists: Claude Sonnet 4.5's training data has a knowledge
// cutoff around early 2025. When users ask the project chat to help
// configure a 3rd-party console (Google Cloud OAuth, Stripe Dashboard,
// Supabase, Vercel, …), those UIs have often been reorganised since
// the model was trained. Without live web access the model either
// fabricates current-day instructions or sends the user in circles.
// The 2026-05-24 Nexsara incident is the canonical example: the model
// kept claiming "Test users" was on the OAuth consent screen page,
// because that was the layout in Google's 2024 docs. The actual answer
// (Test users moved under the "Audience" tab) was only discoverable
// via fresh web search.
//
// Tavily is purpose-built for LLM agents: clean JSON, short snippets,
// optional `answer` field with a synthesised summary, free tier of
// 1000 searches/month, and recency filters via topic="news" +
// time_range="year". We call the REST endpoint directly with fetch()
// rather than pulling in @tavily/core to keep the dependency footprint
// flat (no new package; the runtime is identical).
//
// Server-only: TAVILY_API_KEY is read from process.env and never
// surfaces in client bundles. The tool's execute() runs in the
// Vercel function context; the browser only sees Claude's final prose.

const TAVILY_URL = 'https://api.tavily.com/search'

// Bounded retry on rate-limit (429) + transient 5xx, respecting
// retry-after header when present. Anything else fails fast — the
// LLM gets a clear error and either retries the call with a different
// query or proceeds without web context.
const MAX_ATTEMPTS = 3

/**
 * Low-level Tavily search caller. Returns a normalised
 * { results, answer } shape regardless of which Tavily API version
 * is current. Throws on permanent failure (bad key, missing key,
 * persistent 5xx).
 */
async function callTavily(args, apiKey) {
  const body = {
    query: args.query,
    topic: args.topic || 'general',
    search_depth: args.search_depth || 'basic',
    max_results: Math.max(1, Math.min(10, args.max_results ?? 5)),
    include_answer: true,
  }
  if (args.time_range) body.time_range = args.time_range
  if (args.include_domains?.length) body.include_domains = args.include_domains

  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt))
        continue
      }
      throw new Error(`Tavily fetch failed: ${err?.message || 'network error'}`)
    }

    // Retryable: 429 (rate limit) or 5xx (server hiccup). Respect
    // retry-after if Tavily provides one, otherwise exponential.
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === MAX_ATTEMPTS) {
        const text = await res.text().catch(() => '')
        throw new Error(`Tavily ${res.status}: ${text.slice(0, 200) || 'transient error'}`)
      }
      const retryAfter = Number(res.headers.get('retry-after'))
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : 500 * attempt
      await new Promise((r) => setTimeout(r, delayMs))
      continue
    }

    // 4xx (auth / bad request) — surface immediately, no retry.
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Tavily ${res.status}: ${text.slice(0, 200) || res.statusText}`)
    }

    const json = await res.json()
    return {
      results: (json?.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        published_date: r.published_date || undefined,
      })),
      answer: json?.answer || undefined,
    }
  }
  throw lastErr || new Error('Tavily search failed after retries')
}

/**
 * Build the web_search tool definition for buildDefaultToolset.
 * If TAVILY_API_KEY is not configured, the tool is returned with an
 * execute() that explains the missing config so the model can fall
 * back to its training data instead of hallucinating.
 */
export function webSearchTool() {
  const apiKey = process.env.TAVILY_API_KEY
  return {
    name: 'web_search',
    description: [
      'Search the live web for up-to-date information.',
      '',
      'CALL THIS TOOL WHENEVER:',
      '  • The user is configuring a 3rd-party console / dashboard / docs',
      '    that may have been reorganised since your training data',
      '    (Google Cloud, Stripe, Supabase, Vercel, GitHub, OAuth providers, etc.)',
      '  • The user asks about something that happened in the last 12 months.',
      '  • You are about to instruct the user to "click X then Y" but are not',
      '    confident those labels exist in the current UI version. Verify first.',
      '  • The user has uploaded a screenshot showing UI elements / labels you',
      '    do not recognise from training data — search for the platform name +',
      '    "2025" or "latest" to confirm the current layout before answering.',
      '',
      'DO NOT CALL when the question is purely about the user\'s own code in the project.',
      '',
      'Returns: a JSON object with results[] (title, url, snippet, optional published_date) and optional answer (Tavily-synthesised summary).',
      '',
      'Cost: each call burns 1 Tavily credit. Make queries focused and specific. Prefer a single well-formed query over multiple shotgun searches.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description:
            'A focused natural-language search query (≤300 chars). Include specific platform names, version, year, or feature keywords. Examples: "Google Cloud OAuth consent screen Audience tab Test users 2025", "Stripe Checkout Sessions API tax behavior 2025".',
        },
        topic: {
          type: 'string',
          enum: ['general', 'news', 'finance'],
          description:
            'Use "news" when the user wants very recent (last few months) information — Tavily prefers news sources and includes published_date. Default "general" for documentation and reference lookups.',
        },
        time_range: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description:
            'Filter results to the recent past. Use "year" for "what changed recently" questions about platform UIs. Omit for evergreen facts.',
        },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description:
            'Number of result snippets to return. 3-5 is usually enough; 8-10 only for very ambiguous topics.',
        },
        search_depth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description:
            '"basic" (default) is fast and cheap. Use "advanced" only when basic returned weak results and you need deeper retrieval.',
        },
        include_domains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional allow-list of domains to restrict results to. e.g. ["cloud.google.com","developers.google.com"] when the user is configuring a Google service. Use sparingly — over-constraining returns no results.',
        },
      },
    },
    async execute(args) {
      if (!apiKey) {
        return [
          'web_search is unavailable: TAVILY_API_KEY is not configured on this deployment.',
          '',
          'Proceed using your training-data knowledge but warn the user that any platform-UI instructions may be out of date.',
          'Ask the project owner to add TAVILY_API_KEY in Vercel → Settings → Environment Variables (free tier: 1000 searches/month at tavily.com).',
        ].join('\n')
      }
      if (typeof args?.query !== 'string' || !args.query.trim()) {
        return 'web_search error: `query` is required and must be a non-empty string.'
      }
      try {
        const data = await callTavily(args, apiKey)
        // Format for the LLM — JSON-stringified so it parses as a tool_result
        // and the model can cite specific URLs without re-quoting our prose.
        return JSON.stringify(
          {
            query: args.query,
            answer: data.answer || null,
            results: data.results.slice(0, args.max_results || 5),
            usage_note:
              'Use these snippets to ground your answer. Cite the URL of any result you rely on. If results are stale or off-topic, refine the query and call web_search again — do NOT fall back to training-data guesses about current UI layouts.',
          },
          null,
          2,
        )
      } catch (err) {
        return [
          `web_search failed: ${err?.message || 'unknown error'}`,
          '',
          'You may either:',
          '  • Refine the query and call web_search again (e.g. broader terms, drop include_domains).',
          '  • Proceed without web context, but explicitly tell the user your answer is from training data and may be outdated.',
        ].join('\n')
      }
    },
  }
}
