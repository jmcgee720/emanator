import { NextResponse } from 'next/server'
import { handleCORS } from '@/lib/api/helpers'

export async function handle(route, method, path, request) {
  if (route === '/' && method === 'GET') {
    return handleCORS(NextResponse.json({ message: 'MyMergent API v2.0 (Supabase)' }))
  }

  if (route === '/health' && method === 'GET') {
    return handleCORS(NextResponse.json({ 
      status: 'healthy', 
      database: 'supabase',
      timestamp: new Date().toISOString() 
    }))
  }

  // Provider status check
  if (route === '/providers/status' && method === 'GET') {
    const results = {}
    
    // Check OpenAI
    const openaiKey = process.env.OPENAI_API_KEY
    if (openaiKey) {
      try {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey: openaiKey })
        await client.models.list()
        results.openai = { status: 'ready' }
      } catch (err) {
        const msg = (err?.message || '').toLowerCase()
        const status = err?.status || err?.statusCode || null
        if (status === 401 || msg.includes('invalid') || msg.includes('api key')) {
          results.openai = { status: 'auth_issue', detail: 'Invalid or revoked API key' }
        } else if (status === 402 || msg.includes('billing') || msg.includes('quota') || msg.includes('credit')) {
          results.openai = { status: 'billing_issue', detail: 'Insufficient billing/credits' }
        } else {
          results.openai = { status: 'unavailable', detail: err.message }
        }
      }
    } else {
      results.openai = { status: 'no_key', detail: 'API key not configured' }
    }
    
    // Check Anthropic
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey) {
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic({ apiKey: anthropicKey })
        // Lightweight check: send a tiny message
        await client.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }]
        })
        results.anthropic = { status: 'ready' }
      } catch (err) {
        const msg = (err?.message || '').toLowerCase()
        const status = err?.status || err?.statusCode || null
        if (status === 402 || msg.includes('billing') || msg.includes('credit') || msg.includes('insufficient') || msg.includes('balance is too low')) {
          results.anthropic = { status: 'billing_issue', detail: 'Insufficient billing/credits' }
        } else if (status === 401 || msg.includes('invalid api key') || msg.includes('invalid x-api-key') || msg.includes('authentication')) {
          results.anthropic = { status: 'auth_issue', detail: 'Invalid or revoked API key' }
        } else if (status === 429 || msg.includes('rate')) {
          // Rate limit during status check = provider is actually working
          results.anthropic = { status: 'ready' }
        } else {
          results.anthropic = { status: 'unavailable', detail: err.message }
        }
      }
    } else {
      results.anthropic = { status: 'no_key', detail: 'API key not configured' }
    }
    
    return handleCORS(NextResponse.json(results))
  }

  return null
}
