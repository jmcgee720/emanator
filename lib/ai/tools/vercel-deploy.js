// ──────────────────────────────────────────────────────────────────────
// Vercel deployment tool for project agents
// ──────────────────────────────────────────────────────────────────────
// Allows agents to deploy projects to Vercel directly via the Vercel API.
//
// Security model:
//   • User provides their Vercel access token (scoped to their account)
//   • Token is used only for this deployment (not stored)
//   • Deployment runs via Vercel's API (not local CLI)
//   • Project files are fetched from Supabase and uploaded to Vercel

/**
 * deploy_to_vercel — Deploy a project to Vercel.
 * 
 * This tool deploys an Auroraly project to Vercel by:
 * 1. Fetching all project files from Supabase
 * 2. Creating a Vercel deployment via the Vercel API
 * 3. Uploading files to Vercel's deployment infrastructure
 * 4. Returning the deployment URL
 * 
 * Prerequisites:
 *   • User must provide a Vercel access token (from vercel.com/account/tokens)
 *   • Project must have valid source files (package.json, etc.)
 * 
 * Security:
 *   • Token is used only for this deployment (not stored)
 *   • Deployment is scoped to the user's Vercel account
 *   • Files are uploaded directly to Vercel (not stored on Auroraly servers)
 */
export function deployToVercelTool(projectId) {
  return {
    name: 'deploy_to_vercel',
    description: [
      'Deploy this project to Vercel.',
      '',
      'Use this when:',
      '  • User wants to deploy their project to production',
      '  • User has provided a Vercel access token',
      '  • Project has valid source files (package.json, index.html, etc.)',
      '',
      'Prerequisites:',
      '  • User must provide a Vercel access token (from vercel.com/account/tokens)',
      '  • Project must have package.json (for Node.js projects) or index.html (for static sites)',
      '',
      'Security:',
      '  • Token is used only for this deployment (not stored)',
      '  • Deployment is scoped to the user\'s Vercel account',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: Deployment URL, dashboard URL, and deployment status.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        vercel_token: {
          type: 'string',
          description: 'Vercel access token (from vercel.com/account/tokens). User must provide this.',
        },
        project_name: {
          type: 'string',
          description: 'Project name for Vercel (lowercase, alphanumeric + hyphens only). Defaults to the Auroraly project name.',
        },
        production: {
          type: 'boolean',
          description: 'Deploy to production (true) or preview (false). Default: true.',
        },
        env_vars: {
          type: 'object',
          description: 'Environment variables for the deployment (optional). Example: { "API_KEY": "abc123", "NODE_ENV": "production" }',
        },
      },
      required: ['vercel_token'],
    },
    async execute({ vercel_token, project_name, production = true, env_vars = {} }) {
      const startTime = Date.now()

      // Validate token format
      if (!vercel_token || !vercel_token.startsWith('vcp_')) {
        return [
          '❌ Invalid Vercel token format.',
          '',
          'Vercel access tokens start with "vcp_".',
          '',
          'Get a token from: https://vercel.com/account/tokens',
          'Click "Create Token" → copy the token → paste it here.',
        ].join('\n')
      }

      // Fetch project files from Supabase
      let files
      try {
        const { db } = await import('@/lib/supabase/db')
        files = await db.projectFiles.findByProjectId(projectId)
      } catch (err) {
        return [
          '❌ Failed to fetch project files.',
          '',
          `Error: ${err.message}`,
          '',
          'This is likely a database issue. Try again in a moment.',
        ].join('\n')
      }

      if (!files || files.length === 0) {
        return [
          '❌ No files found for this project.',
          '',
          'Ensure the project has been created and files have been synced.',
        ].join('\n')
      }

      // Validate required files
      const hasPackageJson = files.some(f => f.path === '/package.json' || f.path === 'package.json')
      const hasIndexHtml = files.some(f => f.path === '/index.html' || f.path === 'index.html' || f.path === '/public/index.html')
      
      if (!hasPackageJson && !hasIndexHtml) {
        return [
          '❌ Missing required files.',
          '',
          'Vercel deployments require either:',
          '  • package.json (for Node.js/React/Next.js projects)',
          '  • index.html (for static sites)',
          '',
          'Create one of these files first, then retry deployment.',
        ].join('\n')
      }

      // Determine framework (if package.json exists)
      let framework = null
      if (hasPackageJson) {
        const pkgFile = files.find(f => f.path === '/package.json' || f.path === 'package.json')
        try {
          const pkg = JSON.parse(pkgFile.content || '{}')
          if (pkg.dependencies?.next || pkg.devDependencies?.next) {
            framework = 'nextjs'
          } else if (pkg.dependencies?.['react-scripts']) {
            framework = 'create-react-app'
          } else if (pkg.dependencies?.vite || pkg.devDependencies?.vite) {
            framework = 'vite'
          }
        } catch {
          // Invalid package.json, continue without framework detection
        }
      }

      // Sanitize project name (Vercel requires lowercase alphanumeric + hyphens)
      const sanitizedName = (project_name || `auroraly-${projectId.slice(0, 8)}`)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100)

      // Prepare files for Vercel API
      // Vercel expects: { "path/to/file.js": { "file": "path/to/file.js", "data": "<base64>" } }
      const vercelFiles = {}
      for (const file of files) {
        // Skip hidden files and directories that Vercel doesn't need
        if (file.path.includes('node_modules/') || file.path.includes('.git/')) continue
        
        // Normalize path (remove leading slash)
        const normalizedPath = file.path.replace(/^\//, '')
        if (!normalizedPath) continue // Skip root directory entries
        
        // Encode content as base64
        const content = file.content || ''
        const base64Content = Buffer.from(content).toString('base64')
        
        vercelFiles[normalizedPath] = {
          file: normalizedPath,
          data: base64Content,
        }
      }

      // Create deployment via Vercel API
      let deployment
      try {
        const deploymentPayload = {
          name: sanitizedName,
          files: vercelFiles,
          projectSettings: framework ? { framework } : {},
          target: production ? 'production' : 'preview',
          env: env_vars,
        }

        const response = await fetch('https://api.vercel.com/v13/deployments', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${vercel_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(deploymentPayload),
        })

        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          let errorHint = ''
          
          if (response.status === 401 || response.status === 403) {
            errorHint = 'Authentication Error: Invalid or expired Vercel token. Generate a new token at vercel.com/account/tokens'
          } else if (response.status === 400) {
            errorHint = 'Configuration Error: Invalid deployment configuration. Check that package.json is valid.'
          } else if (response.status === 429) {
            errorHint = 'Rate Limit Error: Too many deployments. Wait a moment and try again.'
          }

          return [
            `❌ Vercel deployment failed (HTTP ${response.status})`,
            '',
            errorHint || 'Deployment request was rejected by Vercel.',
            '',
            'ERROR DETAILS:',
            errorText.slice(0, 500),
          ].join('\n')
        }

        deployment = await response.json()
      } catch (err) {
        return [
          '❌ Failed to connect to Vercel API.',
          '',
          `Error: ${err.message}`,
          '',
          'This is likely a network issue. Try again in a moment.',
        ].join('\n')
      }

      const durationMs = Date.now() - startTime

      // Parse deployment response
      const deploymentUrl = deployment.url ? `https://${deployment.url}` : null
      const dashboardUrl = deployment.id 
        ? `https://vercel.com/${deployment.team?.slug || deployment.creator?.username || 'dashboard'}/deployments/${deployment.id}`
        : null

      const lines = []
      lines.push(`✅ Deployed to Vercel successfully! (${durationMs}ms)`)
      lines.push('')
      
      if (deploymentUrl) {
        lines.push(`🌐 Deployment URL: ${deploymentUrl}`)
      }
      
      if (dashboardUrl) {
        lines.push(`📊 Dashboard: ${dashboardUrl}`)
      }
      
      lines.push('')
      lines.push(`Project: ${sanitizedName}`)
      if (framework) lines.push(`Framework: ${framework}`)
      lines.push(`Target: ${production ? 'production' : 'preview'}`)
      lines.push(`Files uploaded: ${Object.keys(vercelFiles).length}`)
      
      if (deployment.readyState) {
        lines.push('')
        lines.push(`Status: ${deployment.readyState}`)
        if (deployment.readyState === 'QUEUED' || deployment.readyState === 'BUILDING') {
          lines.push('')
          lines.push('⏳ Deployment is building. It will be live in 1-3 minutes.')
          lines.push('Check the dashboard URL above for build progress.')
        }
      }

      return lines.join('\n')
    },
  }
}
