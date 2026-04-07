import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  // Get deployments for project
  if (route.match(/^\/projects\/[^/]+\/deployments$/) && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = route.split('/')[2]
    try {
      const deployments = await db.deployments.findByProjectId(projectId)
      return handleCORS(NextResponse.json(deployments || []))
    } catch {
      return handleCORS(NextResponse.json([]))
    }
  }

  // Download project as ZIP
  if (route.match(/^\/projects\/[^/]+\/download$/) && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = route.split('/')[2]
    try {
      const files = await db.projectFiles.findByProjectId(projectId)
      if (!files || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files in project' }, { status: 404 }))
      }
      // Return files as JSON (frontend will use JSZip to create the ZIP client-side)
      const fileList = files.map(f => ({
        path: f.path,
        content: f.content || '',
        file_type: f.file_type,
      }))
      return handleCORS(NextResponse.json({ files: fileList, project_id: projectId }))
    } catch (err) {
      console.error('[Deploy] Download error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to fetch project files' }, { status: 500 }))
    }
  }

  // Deploy to Vercel
  if (route.match(/^\/projects\/[^/]+\/deploy\/vercel$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = route.split('/')[2]
    try {
      const body = await request.json()
      const { token, projectName } = body
      if (!token) return handleCORS(NextResponse.json({ error: 'Vercel token is required' }, { status: 400 }))

      const files = await db.projectFiles.findByProjectId(projectId)
      if (!files || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files to deploy' }, { status: 404 }))
      }

      // Build Vercel API payload
      const vercelFiles = files.map(f => ({
        file: f.path.startsWith('/') ? f.path.slice(1) : f.path,
        data: f.content || '',
      }))

      // Add a basic package.json if not present
      const hasPackageJson = files.some(f => f.path === 'package.json' || f.path === '/package.json')
      if (!hasPackageJson) {
        vercelFiles.push({
          file: 'package.json',
          data: JSON.stringify({
            name: (projectName || 'emanator-project').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
            version: '1.0.0',
            private: true,
            scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
            dependencies: { next: 'latest', react: 'latest', 'react-dom': 'latest' },
          }, null, 2),
        })
      }

      const name = (projectName || `emanator-${projectId.slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9-]/g, '-')

      const vercelRes = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          files: vercelFiles,
          projectSettings: { framework: null },
        }),
      })

      const vercelData = await vercelRes.json()
      if (!vercelRes.ok) {
        return handleCORS(NextResponse.json({
          error: vercelData.error?.message || 'Vercel deployment failed',
          details: vercelData,
        }, { status: vercelRes.status }))
      }

      // Record deployment
      try {
        await db.deployments.create({
          project_id: projectId,
          user_id: dbUser.id,
          platform: 'vercel',
          status: vercelData.readyState || 'QUEUED',
          url: vercelData.url ? `https://${vercelData.url}` : null,
          deployment_id: vercelData.id,
          created_at: new Date().toISOString(),
        })
      } catch { /* non-critical */ }

      return handleCORS(NextResponse.json({
        success: true,
        url: vercelData.url ? `https://${vercelData.url}` : null,
        deployment_id: vercelData.id,
        status: vercelData.readyState,
      }))
    } catch (err) {
      console.error('[Deploy] Vercel error:', err)
      return handleCORS(NextResponse.json({ error: 'Deployment failed' }, { status: 500 }))
    }
  }

  return null
}
