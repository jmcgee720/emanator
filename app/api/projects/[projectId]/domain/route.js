import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { normaliseDomain, buildDnsInstructions, isDomainProvisioningAvailable } from '@/lib/custom-domains'
import { db } from '@/lib/supabase/db'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

/**
 * POST /api/projects/[projectId]/domain
 * Body: { domain: string }
 *
 * Validates the domain, persists the desired state onto the project,
 * and returns the DNS-record instructions. Does NOT call Vercel —
 * actual domain registration runs asynchronously when VERCEL_TOKEN is
 * configured (currently a preview-mode stub).
 */
export async function POST(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const project = await db.projects.findById(params.projectId)
  if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
  if (project.user_id !== dbUser.id) {
    return handleCORS(NextResponse.json({ error: 'Only the project owner can configure domains.' }, { status: 403 }))
  }

  let body
  try { body = await request.json() } catch { return handleCORS(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })) }

  const domain = normaliseDomain(body?.domain)
  if (!domain) {
    return handleCORS(NextResponse.json({ error: 'Please provide a valid domain like "app.example.com".' }, { status: 400 }))
  }

  const instructions = buildDnsInstructions(domain)
  const available = isDomainProvisioningAvailable()

  try {
    await db.projects.update(project.id, {
      metadata: { ...(project.metadata || {}), custom_domain: { domain, status: available ? 'pending' : 'preview', updated_at: new Date().toISOString() } },
    })
  } catch (err) {
    console.warn('[api/domain] failed to persist domain metadata:', err.message)
  }

  return handleCORS(NextResponse.json({
    domain,
    instructions,
    provisioning: available ? 'available' : 'preview',
    preview_note: available ? null : 'Custom domain provisioning runs in preview mode. Set VERCEL_TOKEN + VERCEL_PROJECT_ID on the server to enable live verification.',
  }))
}

/**
 * GET /api/projects/[projectId]/domain
 * Returns the currently-configured custom domain (if any) + DNS instructions.
 */
export async function GET(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const project = await db.projects.findById(params.projectId)
  if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
  if (project.user_id !== dbUser.id) {
    return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
  }

  const cd = project.metadata?.custom_domain
  const instructions = cd?.domain ? buildDnsInstructions(cd.domain) : null
  return handleCORS(NextResponse.json({
    domain: cd?.domain || null,
    status: cd?.status || null,
    updated_at: cd?.updated_at || null,
    instructions,
    provisioning: isDomainProvisioningAvailable() ? 'available' : 'preview',
  }))
}
