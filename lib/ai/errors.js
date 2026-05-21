/**
 * Provider Error Classification
 * Detects and classifies AI provider errors into actionable categories
 */

export class ProviderError extends Error {
  constructor({ error_type, provider, model, status_code, raw_error, user_message }) {
    super(user_message)
    this.name = 'ProviderError'
    this.error_type = error_type        // 'billing' | 'auth' | 'rate_limit' | 'unavailable' | 'context_length' | 'unknown'
    this.provider = provider
    this.model = model
    this.status_code = status_code
    this.raw_error = raw_error
    this.user_message = user_message
  }

  toJSON() {
    return {
      error_type: this.error_type,
      provider: this.provider,
      model: this.model,
      status_code: this.status_code,
      user_message: this.user_message,
      raw_error: this.raw_error,
    }
  }
}

const PROVIDER_NAMES = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', google: 'Google Gemini' }

function friendlyProvider(id) {
  return PROVIDER_NAMES[id] || id
}

function friendlyModel(model) {
  const map = {
    'gpt-5.2': 'GPT-5.2',
    'gpt-5.1': 'GPT-5.1',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o mini',
    'o3': 'o3',
    'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
    'claude-opus-4-5-20251101': 'Claude Opus 4.5',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-3-flash-preview': 'Gemini 3 Flash',
  }
  return map[model] || model
}

/**
 * Classify an error thrown by an AI provider SDK into a ProviderError
 */
export function classifyProviderError(err, provider, model) {
  const status = err?.status || err?.statusCode || err?.response?.status || null
  const msg = (err?.message || '').toLowerCase()
  const errBody = err?.error?.message || err?.response?.data?.error?.message || ''
  const combined = `${msg} ${errBody}`.toLowerCase()
  const pName = friendlyProvider(provider)
  const mName = friendlyModel(model)

  // Prompt-too-long (200K context window overflow). This is a
  // common Claude error that the old generic handler mis-routed as a
  // "try a different model" suggestion — which is misleading, since
  // every standard Anthropic model has the same 200K ceiling.
  // Surface the actual fix (start a fresh chat) clearly.
  const rawMsg = err.message || err?.error?.message || String(err)
  const promptTooLongMatch = rawMsg.match(/prompt is too long:\s*(\d+)\s*tokens?\s*>\s*(\d+)/i)
  if (promptTooLongMatch || /prompt is too long/i.test(rawMsg)) {
    const used = promptTooLongMatch ? Number(promptTooLongMatch[1]) : null
    const cap = promptTooLongMatch ? Number(promptTooLongMatch[2]) : 200_000
    const usedTxt = used ? `${used.toLocaleString()} tokens` : 'over the model maximum'
    return new ProviderError({
      error_type: 'context_overflow',
      provider, model, status_code: status,
      raw_error: rawMsg,
      user_message: [
        `This chat is too long (${usedTxt}, max ${cap.toLocaleString()}). ${mName} cannot read more than that in one request.`,
        ``,
        `**Fix:** start a fresh chat. Paste a one-paragraph summary of what you were working on into the first message and continue from there. A new chat starts at ~6K tokens and gives you ~194K of room.`,
        ``,
        `Auto-compaction now runs on chats over ~130K tokens — older turns are summarized by Haiku and replaced with a compact note, keeping you under the ceiling. If you are seeing this error, the auto-compaction either has not had a chance to run on this chat yet (it triggers on the NEXT turn after the threshold) or the most recent turn alone is too large (e.g. enormous file paste). Trimming the most recent message or starting fresh will resolve it.`,
        ``,
        `Switching models will NOT help — every standard Anthropic model has the same 200K context window.`,
      ].join('\n'),
    })
  }

  // Billing / credit / budget issues
  //
  // CRITICAL: this branch is ONLY for upstream PROVIDER billing errors
  // (Anthropic API spend cap, OpenAI quota, Emergent Universal Key
  // budget exhausted, etc). It is NOT for the user's Auroraly app
  // credit balance — that is checked server-side BEFORE we even call
  // the provider (see stream-handler-v2.js creditBalance check). If
  // we reach this branch, the user's app credits are fine but the
  // provider rejected the call.
  //
  // The previous message "You're out of credits. Tap Buy Credits in
  // the sidebar" was actively misleading — tapping Buy Credits would
  // top up Auroraly credits, which are not the problem. The user
  // had 1091.90 credits when this fired.
  if (
    status === 402 ||
    combined.includes('billing') ||
    combined.includes('budget') ||
    combined.includes('credit') ||
    combined.includes('insufficient_quota') ||
    combined.includes('exceeded your current quota') ||
    combined.includes('payment') ||
    combined.includes('plan') && combined.includes('limit')
  ) {
    // Detect Emergent proxy-level budget cap specifically
    // Raw error format: "Budget has been exceeded! Current cost: X, Max budget: Y"
    const proxyBudgetMatch = rawMsg.match(/Budget has been exceeded.*?Current cost:\s*([\d.]+).*?Max budget:\s*([\d.]+)/i)
    if (proxyBudgetMatch) {
      const currentCost = parseFloat(proxyBudgetMatch[1]).toFixed(2)
      const maxBudget = parseFloat(proxyBudgetMatch[2]).toFixed(2)
      return new ProviderError({
        error_type: 'proxy_budget',
        provider, model, status_code: status,
        raw_error: rawMsg,
        user_message: `Your Universal Key spending limit ($${maxBudget}) has been reached (used: $${currentCost}). Go to **Profile → Universal Key → Add Balance** to increase your limit. Your Auroraly app credits are unaffected.`,
      })
    }

    // Detect Emergent proxy responses more loosely (any mention of the
    // Universal Key budget without the exact regex match) so users get
    // a Universal-Key-specific message even when the upstream format
    // shifts slightly.
    if (/universal key|emergent.*budget|emergent.*credit|proxy.*budget/i.test(rawMsg)) {
      return new ProviderError({
        error_type: 'proxy_budget',
        provider, model, status_code: status,
        raw_error: rawMsg,
        user_message: `The Emergent Universal Key budget has been exhausted. Go to **Profile → Universal Key → Add Balance** to top it up. Your Auroraly app credits are unaffected.`,
      })
    }

    // Generic upstream-provider billing — explicitly tell the user
    // this is NOT their Auroraly credit balance. The "Buy Credits"
    // button does not fix this.
    return new ProviderError({
      error_type: 'provider_billing',
      provider, model, status_code: status,
      raw_error: err.message || String(err),
      user_message: `${pName} rejected this request with a billing/quota error. **This is not your Auroraly credit balance** — those credits are fine. The provider's own API key has hit a spending limit or quota. Top up the ${pName === 'Anthropic' ? 'Anthropic billing dashboard' : pName === 'OpenAI' ? 'OpenAI billing dashboard' : 'provider account'}, or contact support if you believe this is an error.`,
    })
  }

  // Model access / project-not-authorized (403 with "does not have access to model")
  if (
    status === 403 ||
    combined.includes('does not have access to model') ||
    combined.includes('model_not_found') ||
    (combined.includes('model') && combined.includes('not found')) ||
    combined.includes('does not have access')
  ) {
    return new ProviderError({
      error_type: 'model_access',
      provider, model, status_code: status,
      raw_error: err.message || String(err),
      user_message: `Your ${pName} account doesn't have access to ${mName}. Either request access on the ${pName} dashboard, or pick a different model from the dropdown.`,
    })
  }

  // Auth issues
  if (
    status === 401 ||
    combined.includes('invalid api key') ||
    combined.includes('incorrect api key') ||
    combined.includes('authentication') ||
    combined.includes('unauthorized')
  ) {
    return new ProviderError({
      error_type: 'auth',
      provider, model, status_code: status,
      raw_error: err.message || String(err),
      user_message: `${pName} rejected the API key. Check the API key configured for ${pName} and try again.`,
    })
  }

  // Rate limit
  if (
    status === 429 ||
    combined.includes('rate limit') ||
    combined.includes('too many requests') ||
    combined.includes('rate_limit')
  ) {
    return new ProviderError({
      error_type: 'rate_limit',
      provider, model, status_code: status,
      raw_error: err.message || String(err),
      user_message: `The AI is busy right now. Please wait a moment and try again.`,
    })
  }

  // Context length
  if (
    combined.includes('context length') ||
    combined.includes('maximum context') ||
    combined.includes('token') && combined.includes('exceed')
  ) {
    return new ProviderError({
      error_type: 'context_length',
      provider, model, status_code: status,
      raw_error: err.message || String(err),
      user_message: `This conversation has grown too long for ${mName}. Start a new chat to continue — your project files are preserved.`,
    })
  }

  // Server / unavailable
  if (
    status === 500 || status === 502 || status === 503 || status === 504 ||
    combined.includes('overloaded') ||
    combined.includes('temporarily unavailable') ||
    combined.includes('internal server error') ||
    combined.includes('service unavailable')
  ) {
    return new ProviderError({
      error_type: 'unavailable',
      provider, model, status_code: status,
      raw_error: err.message || String(err),
      user_message: `${mName} is temporarily unavailable. The ${pName} service may be experiencing issues. Please try again shortly.`,
    })
  }

  // Unknown / fallback — surface the actual underlying error so users
  // (and the agent) can debug. Never lie about what happened.
  const rawShort = String(err.message || err?.error?.message || err).slice(0, 240)
  return new ProviderError({
    error_type: 'unknown',
    provider, model, status_code: status,
    raw_error: err.message || String(err),
    user_message: `${mName} returned an error: ${rawShort}. Try a different model from the dropdown if this persists.`,
  })
}
