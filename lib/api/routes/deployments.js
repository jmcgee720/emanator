import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { buildVercelReadyFileMap } from '@/lib/export/vercel-bundler'

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

  // ── Poll deployment status ──
  if (route.match(/^\/projects\/[^/]+\/deployments\/[^/]+\/status$/) && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const parts = route.split('/')
    const deploymentDbId = parts[4]
    try {
      const deployment = await db.deployments.findById(deploymentDbId)
      if (!deployment) return handleCORS(NextResponse.json({ error: 'Deployment not found' }, { status: 404 }))

      // If already in a terminal state, just return it
      const terminalStates = ['ready', 'completed', 'success', 'error', 'failed', 'cancelled']
      if (terminalStates.includes((deployment.status || '').toLowerCase())) {
        return handleCORS(NextResponse.json({ status: deployment.status, url: deployment.url, deployment_id: deployment.deployment_id }))
      }

      // Fetch live status from platform API
      const url = new URL(request.url)
      const platformToken = url.searchParams.get('token')

      if (deployment.platform === 'vercel' && platformToken && deployment.deployment_id) {
        try {
          const vRes = await fetch(`https://api.vercel.com/v13/deployments/${deployment.deployment_id}`, {
            headers: { Authorization: `Bearer ${platformToken}` },
          })
          if (vRes.ok) {
            const vData = await vRes.json()
            const newStatus = vData.readyState || vData.state || deployment.status
            const newUrl = vData.url ? `https://${vData.url}` : deployment.url
            if (newStatus !== deployment.status) {
              await db.deployments.updateStatus(deployment.id, newStatus, newUrl)
            }
            return handleCORS(NextResponse.json({ status: newStatus, url: newUrl, deployment_id: deployment.deployment_id }))
          }
        } catch (e) {
          console.warn('[Deploy] Vercel status poll failed:', e.message)
        }
      }

      if (deployment.platform === 'netlify' && platformToken && deployment.deployment_id) {
        try {
          const nRes = await fetch(`https://api.netlify.com/api/v1/deploys/${deployment.deployment_id}`, {
            headers: { Authorization: `Bearer ${platformToken}` },
          })
          if (nRes.ok) {
            const nData = await nRes.json()
            const newStatus = nData.state || deployment.status
            const newUrl = nData.ssl_url || nData.url || deployment.url
            if (newStatus !== deployment.status) {
              await db.deployments.updateStatus(deployment.id, newStatus, newUrl)
            }
            return handleCORS(NextResponse.json({ status: newStatus, url: newUrl, deployment_id: deployment.deployment_id }))
          }
        } catch (e) {
          console.warn('[Deploy] Netlify status poll failed:', e.message)
        }
      }

      // Fallback: return stored status
      return handleCORS(NextResponse.json({ status: deployment.status, url: deployment.url, deployment_id: deployment.deployment_id }))
    } catch (err) {
      console.error('[Deploy] Status poll error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to check status' }, { status: 500 }))
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
      const { token, projectName, saveToken } = body
      if (!token) return handleCORS(NextResponse.json({ error: 'Vercel token is required' }, { status: 400 }))

      const project = await db.projects.findById(projectId)
      if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))

      const files = await db.projectFiles.findByProjectId(projectId)
      if (!files || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files to deploy — build the project first' }, { status: 404 }))
      }

      // Build the Vercel-ready scaffold (Vite + React + Tailwind, React imports
      // auto-injected, package.json with correct deps, index.html, main.jsx, etc.)
      const effectiveProject = projectName ? { ...project, name: projectName } : project
      const fileMap = buildVercelReadyFileMap(effectiveProject, files)

      // Upload files individually to avoid 10 MB body limit.
      // Vercel /v2/files returns a SHA we reference in the deployment payload.
      const crypto = await import('crypto')
      const vercelFiles = []
      for (const [filePath, content] of Object.entries(fileMap)) {
        // Compute SHA-1 digest for the file content
        const sha = crypto.createHash('sha1').update(content, 'utf8').digest('hex')
        
        const uploadRes = await fetch('https://api.vercel.com/v2/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'x-vercel-digest': sha,
          },
          body: content,
        })
        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({}))
          console.error('[Deploy] File upload failed:', filePath, errData)
          return handleCORS(NextResponse.json({
            error: `File upload failed: ${filePath}`,
            details: errData?.error?.message || errData?.message,
          }, { status: uploadRes.status }))
        }
        const uploadData = await uploadRes.json()
        vercelFiles.push({ file: filePath, sha: uploadData.sha || sha, size: uploadData.size || Buffer.byteLength(content, 'utf8') })
      }

      const name = (projectName || project.name || `emanator-${projectId.slice(0, 8)}`)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 50) || `emanator-${projectId.slice(0, 8)}`

      const vercelRes = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          files: vercelFiles,
          projectSettings: {
            framework: 'vite',
            buildCommand: 'npm run build',
            outputDirectory: 'dist',
            installCommand: 'npm install',
            devCommand: 'npm run dev',
          },
        }),
      })

      const vercelData = await vercelRes.json()
      if (!vercelRes.ok) {
        const msg = vercelData?.error?.message || vercelData?.message || 'Vercel deployment failed'
        console.error('[Deploy] Vercel API error:', msg, vercelData)
        return handleCORS(NextResponse.json({
          error: msg,
          code: vercelData?.error?.code,
        }, { status: vercelRes.status }))
      }

      // Optionally persist the Vercel token in project settings so future
      // deploys don't need re-entry. Only when user explicitly opts in.
      if (saveToken) {
        try {
          const nextSettings = { ...(project.settings || {}) }
          nextSettings.vercel = { token, savedAt: new Date().toISOString() }
          await db.projects.update(projectId, { settings: nextSettings })
        } catch (e) { console.warn('[Deploy] Failed to persist Vercel token:', e.message) }
      }

      // Record deployment
      let dbDeployment = null
      try {
        dbDeployment = await db.deployments.create({
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
        db_id: dbDeployment?.id || null,
        status: vercelData.readyState || 'QUEUED',
        inspectUrl: vercelData.inspectorUrl || null,
      }))
    } catch (err) {
      console.error('[Deploy] Vercel error:', err)
      return handleCORS(NextResponse.json({ error: err.message || 'Deployment failed' }, { status: 500 }))
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

      let dbDeployment = null
      try {
        dbDeployment = await db.deployments.create({
          project_id: projectId,
          user_id: dbUser.id,
          platform: 'netlify',
          status: deploy.state || 'uploaded',
          url,
          deployment_id: deploy.id,
          created_at: new Date().toISOString(),
        })
      } catch { /* non-critical */ }

      return handleCORS(NextResponse.json({ success: true, url, deployment_id: deploy.id, db_id: dbDeployment?.id || null, status: deploy.state }))
    } catch (err) {
      console.error('[Deploy] Netlify error:', err)
      return handleCORS(NextResponse.json({ error: 'Netlify deployment failed' }, { status: 500 }))
    }
  }

  return null
}
