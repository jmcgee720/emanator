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

  // Deploy to Netlify
  if (route.match(/^\/projects\/[^/]+\/deploy\/netlify$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = route.split('/')[2]
    try {
      const body = await request.json()
      const { token, siteName } = body
      if (!token) return handleCORS(NextResponse.json({ error: 'Netlify token is required' }, { status: 400 }))

      const files = await db.projectFiles.findByProjectId(projectId)
      if (!files || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files to deploy' }, { status: 404 }))
      }

      // Create a simple zip buffer for Netlify
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      files.forEach(f => {
        const path = f.path.startsWith('/') ? f.path.slice(1) : f.path
        zip.file(path, f.content || '')
      })
      // Add index.html if not present
      if (!files.some(f => f.path.endsWith('index.html'))) {
        const mainJsx = files.find(f => f.path.includes('index.jsx') || f.path.includes('page.jsx'))
        if (mainJsx) {
          zip.file('index.html', `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><script src="https://cdn.tailwindcss.com"><\/script><script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script></head><body><div id="root"></div><script type="text/babel">${mainJsx.content.replace(/^import.*$/gm, '').replace(/^export\s+default\s+/gm, '').replace(/^export\s+/gm, '')};ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(${mainJsx.path.split('/').pop().replace(/\.(jsx|tsx)$/, '')}));<\/script></body></html>`)
        }
      }
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

      // Deploy via Netlify API
      const deployRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: siteName || `emanator-${projectId.slice(0, 8)}` }),
      })
      const site = await deployRes.json()
      if (!deployRes.ok) {
        return handleCORS(NextResponse.json({ error: site.message || 'Failed to create Netlify site' }, { status: deployRes.status }))
      }

      // Upload the zip to the site
      const uploadRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/zip',
        },
        body: zipBuffer,
      })
      const deploy = await uploadRes.json()
      if (!uploadRes.ok) {
        return handleCORS(NextResponse.json({ error: deploy.message || 'Netlify deploy upload failed' }, { status: uploadRes.status }))
      }

      const url = deploy.ssl_url || deploy.url || `https://${site.subdomain}.netlify.app`

      try {
        await db.deployments.create({
          project_id: projectId,
          user_id: dbUser.id,
          platform: 'netlify',
          status: deploy.state || 'uploaded',
          url,
          deployment_id: deploy.id,
          created_at: new Date().toISOString(),
        })
      } catch { /* non-critical */ }

      return handleCORS(NextResponse.json({ success: true, url, deployment_id: deploy.id, status: deploy.state }))
    } catch (err) {
      console.error('[Deploy] Netlify error:', err)
      return handleCORS(NextResponse.json({ error: 'Netlify deployment failed' }, { status: 500 }))
    }
  }

  return null
}
