import { NextResponse } from 'next/server'
import { handleCORS } from '@/lib/api/helpers'

export async function handle(route, method, path, request) {
  // Get deployments for project
  if (route.match(/^\/projects\/[^/]+\/deployments$/) && method === 'GET') {
    // Deployment system not yet implemented — return empty list
    return handleCORS(NextResponse.json([]))
  }

  // Create deployment (not implemented)
  if (route.match(/^\/projects\/[^/]+\/deployments$/) && method === 'POST') {
    return handleCORS(NextResponse.json({ error: 'Deployment not yet implemented. Coming in Phase 2.' }, { status: 501 }))
  }

  return null
}
