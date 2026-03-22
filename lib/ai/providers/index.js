import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'

/**
 * AI Provider Factory
 */
export function createProvider(providerName, apiKey, model, options = {}) {
  switch (providerName.toLowerCase()) {
    case 'openai':
      return new OpenAIProvider(apiKey, model, options)
    case 'anthropic':
      if (options.baseURL) {
        // Route through proxy using OpenAI-compatible format
        return new OpenAIProvider(apiKey, model, options)
      }
      return new AnthropicProvider(apiKey, model)
    default:
      throw new Error(`Unknown provider: ${providerName}. Supported: openai, anthropic`)
  }
}

export const AVAILABLE_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', strengths: 'Fast, versatile, great at code & tool calling' },
      { id: 'o3', name: 'o3', strengths: 'Advanced reasoning for complex problems' },
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', strengths: 'Excellent balance of speed and intelligence' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', strengths: 'Most capable — deep analysis and long context' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', strengths: 'Ultra-fast for quick tasks and chat' },
    ]
  }
]

export { OpenAIProvider, AnthropicProvider }
