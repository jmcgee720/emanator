import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'

/**
 * Some provider model IDs need a prefix when routed through the
 * Emergent OpenAI-compatible proxy. Google models are identified as
 * `gemini/<id>` in the proxy catalog; Anthropic + OpenAI use their
 * native IDs.
 */
export function normalizeModelForProxy(providerName, model) {
  if (!model) return model
  const p = String(providerName || '').toLowerCase()
  if ((p === 'gemini' || p === 'google') && !model.startsWith('gemini/')) {
    return `gemini/${model}`
  }
  return model
}

/**
 * AI Provider Factory
 *
 * The `providerName` is the canonical key the rest of the codebase uses
 * (`openai` | `anthropic` | `gemini`). When the Emergent proxy is in
 * play (`options.baseURL` set), ALL three providers route through the
 * OpenAI-compatible proxy — so we return an OpenAIProvider with the
 * proxy URL + a prefix-normalized model ID. When the user has set a
 * direct provider API key, we instantiate the native SDK.
 */
export function createProvider(providerName, apiKey, model, options = {}) {
  const name = String(providerName || 'openai').toLowerCase()

  // All non-OpenAI providers go through the OpenAI-compatible Emergent
  // proxy when baseURL is set. Prefix Gemini IDs so the proxy routes
  // them to Google's LLM.
  if (options.baseURL) {
    const proxyModel = normalizeModelForProxy(name, model)
    return new OpenAIProvider(apiKey, proxyModel, options)
  }

  switch (name) {
    case 'openai':
      return new OpenAIProvider(apiKey, model, options)
    case 'anthropic':
      return new AnthropicProvider(apiKey, model)
    case 'gemini':
    case 'google':
      return new GeminiProvider(apiKey, model, options)
    default:
      throw new Error(`Unknown provider: ${providerName}. Supported: openai, anthropic, gemini`)
  }
}

/**
 * Canonical provider + model catalog the UI + service layer share.
 * Model IDs match the Emergent universal-key catalog as of 2026-02.
 * Updating here updates the dropdown AND the routing layer in lockstep.
 */
export const AVAILABLE_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.2',     name: 'GPT-5.2',     strengths: 'Latest flagship — best all-round code quality', badge: 'Latest' },
      { id: 'gpt-5.1',     name: 'GPT-5.1',     strengths: 'Emergent-recommended balance of quality + speed', badge: 'Recommended' },
      { id: 'gpt-4o',      name: 'GPT-4o',      strengths: 'Fast, versatile, proven at code + Vision', badge: null },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', strengths: 'Ultra-fast for quick edits and chat', badge: 'Fast' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', strengths: 'Top-tier JSX generation + instruction adherence', badge: 'Balanced' },
      { id: 'claude-opus-4-5-20251101',   name: 'Claude Opus 4.5',   strengths: 'Deep reasoning + long context (200K)',           badge: 'Powerful' },
      { id: 'claude-haiku-4-5-20251001',  name: 'Claude Haiku 4.5',  strengths: 'Ultra-fast Claude for quick tasks',             badge: 'Fast' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google',
    models: [
      { id: 'gemini-2.5-pro',            name: 'Gemini 2.5 Pro',         strengths: 'Emergent-recommended Gemini — strong Vision + JSON', badge: 'Recommended' },
      { id: 'gemini-3-flash-preview',    name: 'Gemini 3 Flash',         strengths: 'Preview of Gemini 3 — faster + multimodal',         badge: 'Preview' },
      { id: 'gemini-2.5-flash',          name: 'Gemini 2.5 Flash',       strengths: 'Fastest Gemini for bulk low-latency calls',          badge: 'Fast' },
    ],
  },
]

export { OpenAIProvider, AnthropicProvider, GeminiProvider }
