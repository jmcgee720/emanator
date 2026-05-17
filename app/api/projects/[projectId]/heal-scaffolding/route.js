// POST /api/projects/:projectId/heal-scaffolding
//
// Repair-in-place pass that ensures a project has the minimum Next.js +
// Tailwind framework boilerplate to actually boot in the Fly preview
// runner. Writes missing scaffold files (postcss.config.js,
// tailwind.config.js, app/globals.css, etc.) and patches an existing
// package.json to include the Tailwind devDependency trio when the LLM
// compose phase forgot them.
//
// Use case: pre-existing projects (built before the scaffold pass was
// wired in, or where Claude generated a partial package.json) that now
// throw "Module parse failed: Unexpected character '@'" on globals.css
// because PostCSS isn't running. Hitting this endpoint heals them in
// place — no rebuild required.

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import {
  buildScaffolding,
  mergeRequiredPackageDeps,
  FORCE_OVERWRITE_PATHS,
} from '@/lib/ai/phased-pipeline/scaffolding'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

export async function POST(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const projectId = params.projectId
  const project = await db.projects.findById(projectId)
  if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
  if (project.user_id !== dbUser.id) {
    return handleCORS(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  }

  const fullstack = project.archetype === 'fullstack_app'
  const scaffoldFiles = buildScaffolding({
    projectName: project.name || 'auroraly-project',
    tokens: null,
    fullstack,
  })

  const written = []
  const overwritten = []
  const healed = []
  const skipped = []
  const forceOverwriteSet = new Set(FORCE_OVERWRITE_PATHS)

  for (const f of scaffoldFiles) {
    let existing = null
    try {
      existing = await db.projectFiles.findByPath(projectId, f.path)
    } catch (err) {
      console.error(`[heal] findByPath(${f.path}) failed:`, err.message)
    }

    // package.json → merge deps non-destructively
    if (f.path === 'package.json' && existing) {
      try {
        const parsed = JSON.parse(existing.content || '{}')
        const { pkg, changed } = mergeRequiredPackageDeps(parsed, { fullstack })
        if (changed) {
          await db.projectFiles.update(existing.id, {
            content: JSON.stringify(pkg, null, 2) + '\n',
            updated_at: new Date().toISOString(),
          })
          healed.push(f.path)
          continue
        }
        skipped.push(f.path)
        continue
      } catch (err) {
        console.warn(`[heal] could not parse existing package.json (${err.message}) — overwriting`)
        // Fall through to overwrite below.
      }
    }

    // Framework infrastructure → ALWAYS force-overwrite. The whole
    // point of this endpoint is to repair these when Claude wrote
    // broken versions (e.g. globals.css with `--hex: [object Object]`).
    if (forceOverwriteSet.has(f.path) && existing) {
      await db.projectFiles.update(existing.id, {
        content: f.content,
        updated_at: new Date().toISOString(),
      })
      overwritten.push(f.path)
      continue
    }

    // Misc scaffold (jsconfig, .gitignore) → create-if-absent.
    if (existing) { skipped.push(f.path); continue }
    await db.projectFiles.create({
      project_id: projectId,
      path: f.path,
      content: f.content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    written.push(f.path)
  }

  const totalChanged = written.length + overwritten.length + healed.length
  return handleCORS(NextResponse.json({
    ok: true,
    projectId,
    written,
    overwritten,
    healed,
    skipped,
    summary: `wrote ${written.length}, overwrote ${overwritten.length}, healed ${healed.length}, skipped ${skipped.length}`,
    nextStep: totalChanged > 0
      ? 'Click Reset Preview, then Start Preview — the dev server will pick up the new files on its next sync and run a fresh npm install.'
      : 'No changes needed — scaffolding already complete.',
  }))
}
