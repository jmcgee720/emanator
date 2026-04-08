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

  // Provider status check — lightweight, no actual API calls
  if (route === '/providers/status' && method === 'GET') {
    const results = {}
    
    // Check OpenAI — key presence only, never ping the API
    const openaiKey = process.env.OPENAI_API_KEY
    if (openaiKey && openaiKey.startsWith('sk-')) {
      results.openai = { status: 'ready' }
    } else if (openaiKey) {
      results.openai = { status: 'configured' }
    } else {
      results.openai = { status: 'no_key', detail: 'API key not configured' }
    }
    
    // Check Anthropic — key presence only, never ping the API
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey && anthropicKey.startsWith('sk-ant-')) {
      results.anthropic = { status: 'ready' }
    } else if (anthropicKey) {
      results.anthropic = { status: 'configured' }
    } else {
      results.anthropic = { status: 'no_key', detail: 'API key not configured' }
    }
    
    return handleCORS(NextResponse.json(results))
  }

  return null
}
