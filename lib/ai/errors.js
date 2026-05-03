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

  // Billing / credit / budget issues
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
    const rawMsg = err.message || err?.error?.message || String(err)
    const proxyBudgetMatch = rawMsg.match(/Budget has been exceeded.*?Current cost:\s*([\d.]+).*?Max budget:\s*([\d.]+)/i)
    if (proxyBudgetMatch) {
      const currentCost = parseFloat(proxyBudgetMatch[1]).toFixed(2)
      const maxBudget = parseFloat(proxyBudgetMatch[2]).toFixed(2)
      return new ProviderError({
        error_type: 'proxy_budget',
        provider, model, status_code: status,
        raw_error: rawMsg,
        user_message: `Your Universal Key spending limit ($${maxBudget}) has been reached (used: $${currentCost}). Go to **Profile → Universal Key → Add Balance** to increase your limit.`,
      })
    }

    return new ProviderError({
      error_type: 'billing',
      provider, model, status_code: status,
      raw_error: err.message || String(err),
      user_message: `You're out of credits. Tap **Buy Credits** in the sidebar to top up and keep building.`,
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
