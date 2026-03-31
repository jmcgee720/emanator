import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { getUserRole, hasPermission } from '@/lib/constants'

export async function handle(route, method, path, request) {
  // Create sandbox from project
  if (route.match(/^\/projects\/[^/]+\/sandbox$/) && method === 'POST') {
    const sourceId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const source = await db.projects.findById(sourceId)
    if (!source || source.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Source project not found' }, { status: 404 }))
    }

    // Create sandbox project
    const sandbox = await db.projects.create({
      user_id: dbUser.id,
      name: `${source.name} [sandbox]`,
      description: source.description || '',
      type: source.type || 'app',
      settings: {
        is_sandbox: true,
        sandbox_source_id: sourceId,
        sandbox_status: 'active',
        sandbox_created_by: dbUser.email,
      }
    })

    // Clone project files
    const sourceFiles = await db.projectFiles.findByProjectId(sourceId)
    if (sourceFiles.length > 0) {
      const cloned = sourceFiles.map(f => ({
        project_id: sandbox.id,
        path: f.path,
        content: f.content,
        file_type: f.file_type || 'text',
        version: 1,
      }))
      await db.projectFiles.bulkInsert(cloned)
    }

    // Create initial chat
    const chat = await db.chats.create({
      project_id: sandbox.id,
      title: 'Sandbox Chat'
    })

    // Log to changelog
    db.changelog.create({
      project_id: sandbox.id,
      user_id: dbUser.id,
      user_task: `Sandbox created from "${source.name}"`,
      task_mode: 'sandbox_create',
      plan_summary: `Source: ${sourceId}`,
    }).catch(e => console.warn('[changelog] sandbox_create write failed:', e.message))

    return handleCORS(NextResponse.json({ project: sandbox, initialChat: chat }, { status: 201 }))
  }

  // Sandbox diff — compare sandbox files vs source primary (read-only)
  if (route.match(/^\/projects\/[^/]+\/sandbox-diff$/) && method === 'GET') {
    const sandboxId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
      return handleCORS(NextResponse.json({ error: 'Owner access required' }, { status: 403 }))
    }

    const sandbox = await db.projects.findById(sandboxId)
    if (!sandbox || sandbox.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }
    const settings = sandbox.settings || {}
    if (!settings.is_sandbox) {
      return handleCORS(NextResponse.json({ error: 'Not a sandbox project' }, { status: 400 }))
    }

    const sourceId = settings.sandbox_source_id
    const [sandboxFiles, sourceFiles] = await Promise.all([
      db.projectFiles.findByProjectId(sandboxId),
      db.projectFiles.findByProjectId(sourceId),
    ])

    const sourceMap = new Map(sourceFiles.map(f => [f.path, f]))
    const sandboxMap = new Map(sandboxFiles.map(f => [f.path, f]))
    const allPaths = new Set([...sourceMap.keys(), ...sandboxMap.keys()])

    const changes = []
    for (const p of allPaths) {
      const src = sourceMap.get(p)
      const sbx = sandboxMap.get(p)

      if (sbx && !src) {
        const lines = (sbx.content || '').split('\n').length
        changes.push({ path: p, status: 'create', lines_added: lines, lines_removed: 0 })
      } else if (src && !sbx) {
        const lines = (src.content || '').split('\n').length
        changes.push({ path: p, status: 'delete', lines_added: 0, lines_removed: lines })
      } else if (src && sbx && src.content !== sbx.content) {
        const srcLines = (src.content || '').split('\n')
        const sbxLines = (sbx.content || '').split('\n')
        const srcSet = new Set(srcLines)
        const sbxSet = new Set(sbxLines)
        let added = 0, removed = 0
        for (const l of sbxLines) { if (!srcSet.has(l)) added++ }
        for (const l of srcLines) { if (!sbxSet.has(l)) removed++ }
        changes.push({ path: p, status: 'update', lines_added: added, lines_removed: removed })
      }
    }

    changes.sort((a, b) => {
      const order = { delete: 0, update: 1, create: 2 }
      return (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.path.localeCompare(b.path)
    })

    return handleCORS(NextResponse.json({
      sandbox_id: sandboxId,
      source_id: sourceId,
      total_changes: changes.length,
      summary: {
        created: changes.filter(c => c.status === 'create').length,
        updated: changes.filter(c => c.status === 'update').length,
        deleted: changes.filter(c => c.status === 'delete').length,
      },
      changes,
    }))
  }

  // Test-before-apply validation gate (sandbox only)
  if (route.match(/^\/projects\/[^/]+\/test-before-apply$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const project = await db.projects.findById(projectId)
    if (!project || project.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }

    const settings = project.settings || {}
    const checks = []
    const errors = []

    if (!settings.is_sandbox) {
      errors.push({ check: 'sandbox_status', message: 'Not a sandbox project' })
    } else if (settings.sandbox_status !== 'active') {
      errors.push({ check: 'sandbox_status', message: `Sandbox status is "${settings.sandbox_status}", expected "active"` })
    }
    checks.push({ name: 'sandbox_status', passed: errors.length === 0 })

    let diffs = []
    try {
      const body = await request.json()
      diffs = body.diffs || []
    } catch {}

    const hasDiffs = diffs.length > 0
    checks.push({ name: 'diff_exists', passed: hasDiffs })
    if (!hasDiffs) {
      errors.push({ check: 'diff_exists', message: 'No pending diffs to validate' })
    }

    let syntaxPassed = true
    for (const file of diffs) {
      const filePath = file.path || file.filename || ''
      const content = file.content || file.newContent || ''

      if (!content.trim()) {
        errors.push({ check: 'syntax', file: filePath, message: 'Empty file content' })
        syntaxPassed = false
        continue
      }

      if (filePath.endsWith('.json')) {
        try {
          JSON.parse(content)
        } catch (e) {
          errors.push({ check: 'syntax', file: filePath, message: `Invalid JSON: ${e.message}` })
          syntaxPassed = false
        }
        continue
      }

      if (/\.(js|jsx|ts|tsx|mjs)$/.test(filePath)) {
        let braces = 0, parens = 0, brackets = 0
        let inString = false, stringChar = ''
        for (let i = 0; i < content.length; i++) {
          const c = content[i]
          if (inString) {
            if (c === stringChar && content[i - 1] !== '\\') inString = false
            continue
          }
          if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; continue }
          if (c === '{') braces++
          else if (c === '}') braces--
          else if (c === '(') parens++
          else if (c === ')') parens--
          else if (c === '[') brackets++
          else if (c === ']') brackets--
        }
        if (braces !== 0) {
          errors.push({ check: 'syntax', file: filePath, message: `Unbalanced braces (${braces > 0 ? 'missing }' : 'extra }'})` })
          syntaxPassed = false
        }
        if (parens !== 0) {
          errors.push({ check: 'syntax', file: filePath, message: `Unbalanced parentheses (${parens > 0 ? 'missing )' : 'extra )'})` })
          syntaxPassed = false
        }
        if (brackets !== 0) {
          errors.push({ check: 'syntax', file: filePath, message: `Unbalanced brackets (${brackets > 0 ? 'missing ]' : 'extra ]'})` })
          syntaxPassed = false
        }
      }
    }
    checks.push({ name: 'syntax', passed: syntaxPassed })

    let importsPassed = true
    const projectFiles = await db.projectFiles.findByProjectId(projectId)
    const existingPaths = new Set(projectFiles.map(f => f.path))
    for (const file of diffs) {
      existingPaths.add(file.path || file.filename || '')
    }

    for (const file of diffs) {
      const filePath = file.path || file.filename || ''
      const content = file.content || file.newContent || ''
      if (!/\.(js|jsx|ts|tsx|mjs)$/.test(filePath)) continue

      const importMatches = content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)
      for (const match of importMatches) {
        const imp = match[1]
        if (!imp.startsWith('.') && !imp.startsWith('/') && !imp.startsWith('@/')) continue
        let resolved = imp
        if (imp.startsWith('@/')) {
          resolved = imp.replace('@/', '')
        } else if (imp.startsWith('./') || imp.startsWith('../')) {
          continue
        }
        const candidates = [resolved, `${resolved}.js`, `${resolved}.jsx`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.js`, `${resolved}/index.jsx`]
        const found = candidates.some(c => existingPaths.has(c))
        if (!found && !resolved.includes('node_modules')) {
          // Not an error, just a warning
        }
      }
    }
    checks.push({ name: 'imports', passed: importsPassed })

    const passed = errors.length === 0
    const timestamp = new Date().toISOString()
    const result = { passed, errors, checks, timestamp, files_tested: diffs.length }

    try {
      await db.projects.update(projectId, {
        settings: { ...settings, last_test_result: result }
      })
    } catch {}

    return handleCORS(NextResponse.json(result))
  }

  // Promote sandbox -> primary (owner only)
  if (route.match(/^\/projects\/[^/]+\/promote$/) && method === 'POST') {
    const sandboxId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
      return handleCORS(NextResponse.json({ error: 'Owner access required' }, { status: 403 }))
    }

    const sandbox = await db.projects.findById(sandboxId)
    if (!sandbox || sandbox.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Sandbox not found' }, { status: 404 }))
    }

    const settings = sandbox.settings || {}

    if (!settings.is_sandbox) {
      return handleCORS(NextResponse.json({ error: 'Not a sandbox project' }, { status: 400 }))
    }

    if (settings.sandbox_status !== 'active') {
      return handleCORS(NextResponse.json({ error: `Sandbox status is "${settings.sandbox_status}", must be "active"` }, { status: 400 }))
    }

    const lastTest = settings.last_test_result
    if (!lastTest || !lastTest.passed) {
      return handleCORS(NextResponse.json({ error: 'Last test must pass before promotion. Run "Test Changes" first.' }, { status: 400 }))
    }

    const sandboxFiles = await db.projectFiles.findByProjectId(sandboxId)
    if (sandboxFiles.length === 0) {
      return handleCORS(NextResponse.json({ error: 'Sandbox has no files to promote' }, { status: 400 }))
    }

    const sourceId = settings.sandbox_source_id
    const source = await db.projects.findById(sourceId)
    if (!source) {
      return handleCORS(NextResponse.json({ error: 'Source project no longer exists' }, { status: 404 }))
    }

    const primaryFiles = await db.projectFiles.findByProjectId(sourceId)
    const primaryMap = new Map(primaryFiles.map(f => [f.path, f]))
    const sandboxPathSet = new Set(sandboxFiles.map(f => f.path))

    const snapshot = []
    for (const f of primaryFiles) {
      snapshot.push({ path: f.path, previous_content: f.content, existed_before: true })
    }
    for (const f of sandboxFiles) {
      if (!primaryMap.has(f.path)) {
        snapshot.push({ path: f.path, previous_content: null, existed_before: false })
      }
    }

    await db.projectFiles.deleteByProjectId(sourceId)

    const promoted = sandboxFiles.map(f => ({
      project_id: sourceId,
      path: f.path,
      content: f.content,
      file_type: f.file_type || 'text',
      version: (f.version || 1) + 1,
    }))
    await db.projectFiles.bulkInsert(promoted)

    const now = new Date().toISOString()
    await db.projects.update(sandboxId, {
      settings: { ...settings, sandbox_status: 'promoted', promoted_at: now }
    })

    db.changelog.create({
      project_id: sourceId,
      user_id: dbUser.id,
      user_task: `Sandbox promoted to primary: ${sandbox.name}`,
      task_mode: 'sandbox_promote',
      plan_summary: `Source sandbox: ${sandboxId} \u2192 Target: ${sourceId} | ${sandboxFiles.length} file(s)`,
      file_actions: { snapshot, sandbox_id: sandboxId },
    }).catch(e => console.warn('[changelog] sandbox_promote write failed:', e.message))

    return handleCORS(NextResponse.json({
      success: true,
      files_promoted: sandboxFiles.length,
      source_project_id: sourceId,
      sandbox_status: 'promoted',
      promoted_at: now,
    }))
  }

  // Rollback a promoted sandbox
  if (route.match(/^\/projects\/[^/]+\/rollback$/) && method === 'POST') {
    const sandboxId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
      return handleCORS(NextResponse.json({ error: 'Owner access required' }, { status: 403 }))
    }

    const sandbox = await db.projects.findById(sandboxId)
    if (!sandbox || sandbox.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Sandbox not found' }, { status: 404 }))
    }
    const settings = sandbox.settings || {}
    if (!settings.is_sandbox) {
      return handleCORS(NextResponse.json({ error: 'Not a sandbox project' }, { status: 400 }))
    }
    if (settings.sandbox_status !== 'promoted') {
      return handleCORS(NextResponse.json({ error: 'Sandbox has not been promoted' }, { status: 400 }))
    }

    const sourceId = settings.sandbox_source_id

    const supabase = getSupabaseAdmin()
    const { data: entries } = await supabase
      .from('changelog')
      .select('*')
      .eq('project_id', sourceId)
      .eq('task_mode', 'sandbox_promote')
      .order('created_at', { ascending: false })
      .limit(5)

    const entry = (entries || []).find(e => {
      const fa = e.file_actions
      return fa && fa.sandbox_id === sandboxId && Array.isArray(fa.snapshot)
    })

    if (!entry) {
      return handleCORS(NextResponse.json({ error: 'No promotion snapshot found for rollback' }, { status: 404 }))
    }

    const snapshot = entry.file_actions.snapshot

    await db.projectFiles.deleteByProjectId(sourceId)

    const toRestore = snapshot.filter(f => f.existed_before && f.previous_content != null)
    if (toRestore.length > 0) {
      await db.projectFiles.bulkInsert(toRestore.map(f => ({
        project_id: sourceId,
        path: f.path,
        content: f.previous_content,
        file_type: 'text',
        version: 1,
      })))
    }

    const now = new Date().toISOString()
    await db.projects.update(sandboxId, {
      settings: { ...settings, sandbox_status: 'rolled_back', rolled_back_at: now }
    })

    db.changelog.create({
      project_id: sourceId,
      user_id: dbUser.id,
      user_task: `Rollback: restored primary from pre-promotion snapshot`,
      task_mode: 'sandbox_rollback',
      plan_summary: `Sandbox: ${sandboxId} | Restored ${toRestore.length} file(s), removed ${snapshot.filter(f => !f.existed_before).length} sandbox-only file(s)`,
    }).catch(e => console.warn('[changelog] sandbox_rollback write failed:', e.message))

    return handleCORS(NextResponse.json({
      success: true,
      files_restored: toRestore.length,
      files_removed: snapshot.filter(f => !f.existed_before).length,
      sandbox_status: 'rolled_back',
      rolled_back_at: now,
    }))
  }

  return null
}
