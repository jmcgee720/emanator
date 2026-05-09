import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { withRetry, cleanSupabaseError } from '@/lib/supabase/error-utils'
import { convertCRAtoVite, isCRAProject } from '@/lib/import/cra-to-vite'
import JSZip from 'jszip'

export async function handle(route, method, path, request) {
  // ============ GITHUB IMPORT (PAT-based) ============

  if (route === '/import/github' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    let dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const { pat, repo, branch = 'main' } = body

      if (!pat || !repo) {
        return handleCORS(NextResponse.json({ error: 'Personal Access Token and repository (owner/repo) are required' }, { status: 400 }))
      }

      // Normalize repo input: support full URLs and shorthand
      let normalizedRepo = repo.trim()
        .replace(/\.git$/, '')
        .replace(/\/$/, '')
      const urlMatch = normalizedRepo.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)/)
      if (urlMatch) normalizedRepo = urlMatch[1]

      const repoMatch = normalizedRepo.match(/^([^/]+)\/([^/]+)$/)
      if (!repoMatch) {
        return handleCORS(NextResponse.json({ error: 'Repository must be in format owner/repo or a GitHub URL' }, { status: 400 }))
      }

      const [, owner, repoName] = repoMatch
      const ghHeaders = { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Auroraly-Import' }

      // 1. Resolve branch -> commit SHA
      let resolvedBranch = branch
      let commitSha, treeSha

      // If branch doesn't look like a 40-char SHA, resolve it as a branch name
      if (!/^[0-9a-f]{40}$/i.test(resolvedBranch)) {
        // Try the requested branch first; if 404, fall back to repo default branch
        let branchRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/branches/${resolvedBranch}`, { headers: ghHeaders })
        if (branchRes.status === 401) return handleCORS(NextResponse.json({ error: 'Invalid Personal Access Token' }, { status: 401 }))
        if (branchRes.status === 404) {
          // Requested branch not found — try repo default
          const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers: ghHeaders })
          if (!repoRes.ok) return handleCORS(NextResponse.json({ error: `Repository not found: ${owner}/${repoName}` }, { status: 404 }))
          const repoData = await repoRes.json()
          resolvedBranch = repoData.default_branch || 'main'
          branchRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/branches/${resolvedBranch}`, { headers: ghHeaders })
        }
        if (!branchRes.ok) {
          const errBody = await branchRes.json().catch(() => ({}))
          return handleCORS(NextResponse.json({ error: errBody.message || `Branch not found: ${owner}/${repoName}@${resolvedBranch}` }, { status: branchRes.status }))
        }
        const branchData = await branchRes.json()
        commitSha = branchData.commit.sha
        treeSha = branchData.commit.commit.tree.sha
      } else {
        // Direct SHA — fetch commit
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits/${resolvedBranch}`, { headers: ghHeaders })
        if (!commitRes.ok) {
          const errData = await commitRes.json().catch(() => ({}))
          return handleCORS(NextResponse.json({ error: errData.message || 'Commit not found' }, { status: commitRes.status }))
        }
        const commitData = await commitRes.json()
        commitSha = commitData.sha
        treeSha = commitData.commit.tree.sha
      }

      // 2. Get full tree recursively
      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/trees/${treeSha}?recursive=1`, { headers: ghHeaders })
      if (!treeRes.ok) {
        return handleCORS(NextResponse.json({ error: 'Failed to fetch repository tree' }, { status: 500 }))
      }
      const treeData = await treeRes.json()

      if (treeData.truncated) {
        console.warn('[GitHub Import] Tree was truncated — very large repo')
      }

      const SKIP_PATTERNS = ['node_modules/', '.git/', '.DS_Store', '__MACOSX/', 'dist/', 'build/', '.next/', '.cache/', '.turbo/', 'coverage/', '.env']
      const MAX_FILE_SIZE = 512 * 1024
      const TEXT_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'scss', 'less', 'md', 'txt', 'yml', 'yaml', 'toml', 'xml', 'svg', 'sh', 'bash', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'php', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'sql', 'prisma', 'env', 'example', 'gitignore', 'npmrc', 'editorconfig', 'eslintrc', 'prettierrc', 'dockerignore', 'Dockerfile', 'Makefile', 'lock', 'map'])

      // Filter blobs (files only, skip large + ignored)
      const blobs = treeData.tree.filter(item => {
        if (item.type !== 'blob') return false
        if (SKIP_PATTERNS.some(p => item.path.includes(p))) return false
        if (item.size > MAX_FILE_SIZE) return false
        return true
      })

      if (blobs.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No supported files found in repository after filtering' }, { status: 400 }))
      }

      // 3. Fetch file contents in batches
      const extractedFiles = []
      let packageJson = null
      let entryFile = null
      let framework = 'unknown'
      let detectedLanguage = 'javascript'
      const BATCH_SIZE = 15

      for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
        const batch = blobs.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(batch.map(async (blob) => {
          try {
            const ext = blob.path.split('.').pop()?.toLowerCase() || ''
            const isText = TEXT_EXTENSIONS.has(ext) || blob.path.includes('.')  === false
            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)
            const isFont = ['woff', 'woff2', 'ttf', 'eot', 'otf'].includes(ext)

            // Binary files we DO want to keep (images + fonts) — store
            // them as data URLs so the preview iframe can reference them
            // via <img src="data:image/png;base64,...">. Without this,
            // imported apps (Mangia Mama) render with all images blank.
            if (!isText && (isImage || isFont)) {
              const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/blobs/${blob.sha}`, { headers: ghHeaders })
              if (!blobRes.ok) return null
              const blobData = await blobRes.json()
              const base64 = blobData.encoding === 'base64' ? blobData.content : Buffer.from(blobData.content || '', 'utf-8').toString('base64')
              const mimeType = isImage
                ? (ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`)
                : (ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'ttf' ? 'font/ttf' : 'font/eot')
              return {
                path: blob.path,
                content: `data:${mimeType};base64,${base64}`,
                file_type: isImage ? 'image' : 'font',
              }
            }

            // Other binaries (videos, archives, exotic formats) we still
            // skip — these would blow up the project size and the preview
            // doesn't have a meaningful way to embed them anyway.
            if (!isText) {
              return { path: blob.path, content: '[binary file — not extracted]', file_type: 'binary' }
            }

            const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/blobs/${blob.sha}`, { headers: ghHeaders })
            if (!blobRes.ok) return null

            const blobData = await blobRes.json()
            let content
            if (blobData.encoding === 'base64') {
              content = Buffer.from(blobData.content, 'base64').toString('utf-8')
            } else {
              content = blobData.content
            }

            const fileType = ext === 'svg' ? 'image' : 'text'

            return { path: blob.path, content, file_type: fileType }
          } catch {
            return null
          }
        }))

        for (const result of batchResults) {
          if (!result) continue
          extractedFiles.push(result)

          if (result.path === 'package.json') {
            try { packageJson = JSON.parse(result.content) } catch {}
          }

          if (!entryFile) {
            if (['index.html', 'index.js', 'index.tsx', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.tsx'].includes(result.path)) {
              entryFile = result.path
            } else if (['app/page.js', 'app/page.tsx', 'pages/index.js', 'pages/index.tsx', 'src/App.jsx', 'src/App.tsx'].includes(result.path)) {
              entryFile = result.path
            }
          }

          const ext = result.path.split('.').pop()?.toLowerCase()
          if (ext === 'ts' || ext === 'tsx') detectedLanguage = 'typescript'
        }
      }

      if (extractedFiles.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files could be fetched from repository' }, { status: 400 }))
      }

      // 4. Framework detection (reuse ZIP logic)
      if (packageJson) {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        if (deps['next']) framework = 'nextjs'
        else if (deps['react']) framework = 'react'
        else if (deps['vue']) framework = 'vue'
        else if (deps['svelte'] || deps['@sveltejs/kit']) framework = 'svelte'
        else if (deps['express'] || deps['fastify'] || deps['koa']) framework = 'node'
        else framework = 'node'
      } else if (extractedFiles.some(f => f.path === 'index.html')) {
        framework = 'static'
      }

      // 4b. CRA → Vite import-time conversion. CRA's dep tree (react-scripts +
      // ajv@6 + schema-utils@2 + babel-loader@8) cannot be reliably booted in
      // any modern Node environment; we transform to Vite at import time so
      // every CRA-shaped imported project becomes a clean Vite project that
      // boots in 2 seconds inside the Fly preview runner.
      let craConversionSummary = null
      if (isCRAProject(extractedFiles)) {
        const conv = convertCRAtoVite(extractedFiles)
        if (conv.converted) {
          extractedFiles.length = 0
          extractedFiles.push(...conv.files)
          craConversionSummary = conv.summary
          framework = 'vite-react'
          if (conv.entryFile && conv.root) entryFile = conv.root + conv.entryFile
          // Refresh packageJson reference since we just rewrote it.
          const newPkg = extractedFiles.find(f => /(?:^|\/)package\.json$/.test(f.path) && (() => {
            try { return JSON.parse(f.content).devDependencies?.vite } catch { return false }
          })())
          if (newPkg) { try { packageJson = JSON.parse(newPkg.content) } catch {} }
          console.log('[Import] CRA→Vite conversion applied:', conv.summary.length, 'transforms')
        }
      }

      // 5. Create project
      const projectName = packageJson?.name || repoName
      const project = await db.projects.create({
        user_id: dbUser.id,
        name: projectName,
        description: packageJson?.description || `Imported from github.com/${owner}/${repoName}`,
        type: 'app',
        settings: {
          imported: true,
          import_source: 'github',
          repo_url: `${owner}/${repoName}`,
          branch,
          last_commit_sha: commitSha,
          framework,
          entry_file: entryFile,
          detected_language: detectedLanguage,
          file_count: extractedFiles.length,
          imported_at: new Date().toISOString(),
        }
      })

      // 6. Create canvas
      await db.projectCanvas.create({
        project_id: project.id,
        canvas_content: {
          project_overview: `Imported from github.com/${owner}/${repoName} (${framework})`,
          project_goals: [],
          key_decisions: [],
          architecture_notes: [`Framework: ${framework}`, `Entry: ${entryFile || 'unknown'}`, `Language: ${detectedLanguage}`, `Branch: ${branch}`, `Commit: ${commitSha.slice(0, 8)}`],
          master_prompts: [],
          working_prompts: [],
          failed_prompts: [],
          successful_patterns: [],
          feature_requirements: [],
          technical_specs: packageJson ? [`Dependencies: ${Object.keys(packageJson.dependencies || {}).join(', ')}`] : [],
          constraints: [],
          open_tasks: [],
          completed_tasks: []
        }
      })

      // 7. Create initial chat
      const initialChat = await db.chats.create({
        project_id: project.id,
        title: 'New Conversation'
      })

      // 8. Store files
      const fileBatch = extractedFiles.map(f => ({
        project_id: project.id,
        path: f.path,
        content: f.content,
        file_type: f.file_type,
        version: 1,
      }))

      if (fileBatch.length > 0) {
        await withRetry(() => db.projectFiles.bulkInsert(fileBatch), { label: 'github-import.bulkInsert' })
      }

      return handleCORS(NextResponse.json({
        success: true,
        project,
        initialChat,
        metadata: {
          framework,
          entry_file: entryFile,
          detected_language: detectedLanguage,
          file_count: extractedFiles.length,
          project_name: projectName,
          repo_url: `${owner}/${repoName}`,
          branch,
          commit_sha: commitSha,
        }
      }, { status: 201 }))

    } catch (err) {
      console.error('[GitHub Import] Error:', err)
      const cleaned = cleanSupabaseError(err)
      return handleCORS(NextResponse.json({
        error: `GitHub import failed: ${cleaned.message}`,
        transient: cleaned.transient,
      }, { status: cleaned.transient ? 503 : 500 }))
    }
  }

  // ============ GITHUB SYNC (Pull Latest) ============

  if (route === '/import/github/sync' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    let dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const { project_id, pat } = body

      if (!project_id || !pat) {
        return handleCORS(NextResponse.json({ error: 'project_id and pat are required' }, { status: 400 }))
      }

      const project = await db.projects.findById(project_id)
      if (!project) {
        return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
      }

      if (project.user_id !== dbUser.id) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      const settings = project.settings || {}
      if (settings.import_source !== 'github' || !settings.repo_url) {
        return handleCORS(NextResponse.json({ error: 'This project was not imported from GitHub' }, { status: 400 }))
      }

      const repoUrl = settings.repo_url
      const branch = settings.branch || 'main'
      const storedSha = settings.last_commit_sha

      const ghHeaders = { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Auroraly-Import' }

      // Resolve branch -> commit SHA
      let latestSha, syncTreeSha
      if (!/^[0-9a-f]{40}$/i.test(branch)) {
        let branchRes = await fetch(`https://api.github.com/repos/${repoUrl}/branches/${branch}`, { headers: ghHeaders })
        if (branchRes.status === 404) {
          const repoRes = await fetch(`https://api.github.com/repos/${repoUrl}`, { headers: ghHeaders })
          if (repoRes.ok) {
            const repoData = await repoRes.json()
            branchRes = await fetch(`https://api.github.com/repos/${repoUrl}/branches/${repoData.default_branch || 'main'}`, { headers: ghHeaders })
          }
        }
        if (!branchRes.ok) {
          const errData = await branchRes.json().catch(() => ({}))
          return handleCORS(NextResponse.json({ error: errData.message || 'Failed to resolve branch' }, { status: branchRes.status }))
        }
        const branchData = await branchRes.json()
        latestSha = branchData.commit.sha
        syncTreeSha = branchData.commit.commit.tree.sha
      } else {
        const commitRes = await fetch(`https://api.github.com/repos/${repoUrl}/commits/${branch}`, { headers: ghHeaders })
        if (!commitRes.ok) {
          const errData = await commitRes.json().catch(() => ({}))
          return handleCORS(NextResponse.json({ error: errData.message || 'Failed to fetch commit' }, { status: commitRes.status }))
        }
        const commitData = await commitRes.json()
        latestSha = commitData.sha
        syncTreeSha = commitData.commit.tree.sha
      }

      if (latestSha === storedSha) {
        return handleCORS(NextResponse.json({ success: true, updated: false, message: 'Already up to date', commit_sha: latestSha }))
      }

      // Fetch full tree
      const treeRes = await fetch(`https://api.github.com/repos/${repoUrl}/git/trees/${syncTreeSha}?recursive=1`, { headers: ghHeaders })
      if (!treeRes.ok) {
        return handleCORS(NextResponse.json({ error: 'Failed to fetch repository tree' }, { status: 500 }))
      }
      const treeData = await treeRes.json()

      const SKIP_PATTERNS = ['node_modules/', '.git/', '.DS_Store', '__MACOSX/', 'dist/', 'build/', '.next/', '.cache/', '.turbo/', 'coverage/', '.env']
      const MAX_FILE_SIZE = 512 * 1024

      const blobs = treeData.tree.filter(item => {
        if (item.type !== 'blob') return false
        if (SKIP_PATTERNS.some(p => item.path.includes(p))) return false
        if (item.size > MAX_FILE_SIZE) return false
        return true
      })

      // Fetch and upsert files
      let updatedCount = 0
      let createdCount = 0
      const BATCH_SIZE = 15

      for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
        const batch = blobs.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(async (blob) => {
          try {
            const blobRes = await fetch(`https://api.github.com/repos/${repoUrl}/git/blobs/${blob.sha}`, { headers: ghHeaders })
            if (!blobRes.ok) return

            const blobData = await blobRes.json()
            let content
            if (blobData.encoding === 'base64') {
              content = Buffer.from(blobData.content, 'base64').toString('utf-8')
            } else {
              content = blobData.content
            }

            const ext = blob.path.split('.').pop()?.toLowerCase() || 'text'
            const fileType = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext) ? 'image'
              : ['woff', 'woff2', 'ttf', 'eot'].includes(ext) ? 'font' : 'text'

            const result = await withRetry(
              () => db.projectFiles.upsert(project_id, blob.path, content, fileType),
              { label: 'github-sync.upsert', retries: 2 },
            )
            if (result.action === 'updated') updatedCount++
            else if (result.action === 'created') createdCount++
          } catch {}
        }))
      }

      // Update project settings with new commit SHA
      await db.projects.update(project_id, {
        settings: {
          ...settings,
          last_commit_sha: latestSha,
          last_synced_at: new Date().toISOString(),
          file_count: blobs.length,
        }
      })

      return handleCORS(NextResponse.json({
        success: true,
        updated: true,
        message: `Synced to ${latestSha.slice(0, 8)}: ${createdCount} new, ${updatedCount} updated files`,
        commit_sha: latestSha,
        previous_sha: storedSha,
        files_created: createdCount,
        files_updated: updatedCount,
      }))

    } catch (err) {
      console.error('[GitHub Sync] Error:', err)
      const cleaned = cleanSupabaseError(err)
      return handleCORS(NextResponse.json({
        error: `Sync failed: ${cleaned.message}`,
        transient: cleaned.transient,
      }, { status: cleaned.transient ? 503 : 500 }))
    }
  }

  // ============ PROJECT IMPORT (ZIP UPLOAD) ============

  if (route === '/import/upload' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    let dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const formData = await request.formData()
      const file = formData.get('file')

      if (!file || typeof file === 'string') {
        return handleCORS(NextResponse.json({ error: 'No file uploaded' }, { status: 400 }))
      }

      const fileName = file.name || 'upload.zip'
      if (!fileName.endsWith('.zip')) {
        return handleCORS(NextResponse.json({ error: 'Only .zip files are supported' }, { status: 400 }))
      }

      const buffer = Buffer.from(await file.arrayBuffer())

      if (buffer.length === 0) {
        return handleCORS(NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 }))
      }

      // Parse ZIP
      let zip
      try {
        zip = await JSZip.loadAsync(buffer)
      } catch (e) {
        return handleCORS(NextResponse.json({ error: 'Invalid or corrupted zip file' }, { status: 400 }))
      }

      const fileEntries = Object.keys(zip.files).filter(name => !zip.files[name].dir)

      if (fileEntries.length === 0) {
        return handleCORS(NextResponse.json({ error: 'Zip file is empty — no files found' }, { status: 400 }))
      }

      // Detect common root prefix (e.g., "my-project/src/..." -> strip "my-project/")
      let commonPrefix = ''
      if (fileEntries.length > 1) {
        const parts = fileEntries[0].split('/')
        if (parts.length > 1) {
          const candidate = parts[0] + '/'
          const allMatch = fileEntries.every(f => f.startsWith(candidate))
          if (allMatch) commonPrefix = candidate
        }
      }

      // Extract files and detect framework
      const extractedFiles = []
      let packageJson = null
      let entryFile = null
      let framework = 'unknown'
      let detectedLanguage = 'javascript'
      const MAX_FILE_SIZE = 512 * 1024 // 512KB per file
      const SKIP_PATTERNS = ['node_modules/', '.git/', '.DS_Store', '__MACOSX/', 'dist/', 'build/', '.next/']

      for (const filePath of fileEntries) {
        // Skip system/build files
        if (SKIP_PATTERNS.some(p => filePath.includes(p))) continue

        const relativePath = commonPrefix ? filePath.slice(commonPrefix.length) : filePath
        if (!relativePath) continue

        const zipFile = zip.files[filePath]

        // Detect file type from extension first so we know whether to
        // treat it as text or as a binary asset (image/font).
        const ext = relativePath.split('.').pop()?.toLowerCase() || 'text'
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)
        const isFont = ['woff', 'woff2', 'ttf', 'eot', 'otf'].includes(ext)
        const fileType = isImage ? 'image' : isFont ? 'font' : ext === 'svg' ? 'image' : 'text'

        let content
        try {
          const raw = await zipFile.async('uint8array')
          if (raw.length > MAX_FILE_SIZE) {
            content = `[file too large: ${(raw.length / 1024).toFixed(0)}KB]`
          } else if (isImage || isFont) {
            // Store binary assets as data URLs so the preview iframe
            // can reference them via <img src="data:..."> — same fix
            // we made for the GitHub import path above.
            const base64 = Buffer.from(raw).toString('base64')
            const mimeType = isImage
              ? (ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`)
              : (ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'ttf' ? 'font/ttf' : 'font/eot')
            content = `data:${mimeType};base64,${base64}`
          } else {
            content = new TextDecoder('utf-8', { fatal: false }).decode(raw)
          }
        } catch {
          content = '[binary file — not extracted]'
        }

        extractedFiles.push({ path: relativePath, content, file_type: fileType })

        // Parse package.json for project name and framework detection
        if (relativePath === 'package.json') {
          try {
            packageJson = JSON.parse(content)
          } catch {}
        }

        // Detect entry points
        if (!entryFile) {
          if (['index.html', 'index.js', 'index.tsx', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.tsx'].includes(relativePath)) {
            entryFile = relativePath
          } else if (relativePath === 'app/page.js' || relativePath === 'app/page.tsx' || relativePath === 'pages/index.js' || relativePath === 'pages/index.tsx' || relativePath === 'src/App.jsx' || relativePath === 'src/App.tsx') {
            entryFile = relativePath
          }
        }

        // Detect TypeScript
        if (ext === 'ts' || ext === 'tsx') detectedLanguage = 'typescript'
      }

      if (extractedFiles.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No supported files found in zip after filtering' }, { status: 400 }))
      }

      // Framework detection
      if (packageJson) {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        if (deps['next']) framework = 'nextjs'
        else if (deps['react']) framework = 'react'
        else if (deps['vue']) framework = 'vue'
        else if (deps['svelte'] || deps['@sveltejs/kit']) framework = 'svelte'
        else if (deps['express'] || deps['fastify'] || deps['koa']) framework = 'node'
        else framework = 'node'
      } else if (extractedFiles.some(f => f.path === 'index.html')) {
        framework = 'static'
      }

      // CRA → Vite import-time conversion (see GitHub-import path comment above).
      if (isCRAProject(extractedFiles)) {
        const conv = convertCRAtoVite(extractedFiles)
        if (conv.converted) {
          extractedFiles.length = 0
          extractedFiles.push(...conv.files)
          framework = 'vite-react'
          const newPkg = extractedFiles.find(f => /(?:^|\/)package\.json$/.test(f.path))
          if (newPkg) { try { packageJson = JSON.parse(newPkg.content) } catch {} }
          console.log('[ZipImport] CRA→Vite conversion applied:', conv.summary.length, 'transforms')
        }
      }

      // Derive project name
      const projectName = packageJson?.name
        || fileName.replace('.zip', '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

      // Create project
      const project = await db.projects.create({
        user_id: dbUser.id,
        name: projectName,
        description: packageJson?.description || `Imported from ${fileName}`,
        type: 'app',
        settings: {
          imported: true,
          import_source: 'zip',
          import_filename: fileName,
          framework,
          entry_file: entryFile,
          detected_language: detectedLanguage,
          file_count: extractedFiles.length,
          imported_at: new Date().toISOString(),
        }
      })

      // Create canvas
      await db.projectCanvas.create({
        project_id: project.id,
        canvas_content: {
          project_overview: `Imported from ${fileName} (${framework})`,
          project_goals: [],
          key_decisions: [],
          architecture_notes: [`Framework: ${framework}`, `Entry: ${entryFile || 'unknown'}`, `Language: ${detectedLanguage}`],
          master_prompts: [],
          working_prompts: [],
          failed_prompts: [],
          successful_patterns: [],
          feature_requirements: [],
          technical_specs: packageJson ? [`Dependencies: ${Object.keys(packageJson.dependencies || {}).join(', ')}`] : [],
          constraints: [],
          open_tasks: [],
          completed_tasks: []
        }
      })

      // Create initial chat
      const initialChat = await db.chats.create({
        project_id: project.id,
        title: 'New Conversation'
      })

      // Store all extracted files
      const fileBatch = extractedFiles.map(f => ({
        project_id: project.id,
        path: f.path,
        content: f.content,
        file_type: f.file_type,
        version: 1,
      }))

      if (fileBatch.length > 0) {
        await withRetry(() => db.projectFiles.bulkInsert(fileBatch), { label: 'zip-import.bulkInsert' })
      }

      return handleCORS(NextResponse.json({
        success: true,
        project,
        initialChat,
        metadata: {
          framework,
          entry_file: entryFile,
          detected_language: detectedLanguage,
          file_count: extractedFiles.length,
          project_name: projectName,
        }
      }, { status: 201 }))

    } catch (err) {
      console.error('[Import] Error:', err)
      const cleaned = cleanSupabaseError(err)
      return handleCORS(NextResponse.json({
        error: `Import failed: ${cleaned.message}`,
        transient: cleaned.transient,
      }, { status: cleaned.transient ? 503 : 500 }))
    }
  }

  return null
}
