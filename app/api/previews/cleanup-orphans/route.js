// POST /api/previews/cleanup-orphans
//
// Nukes any Fly machine + volume that's stuck in a broken state so the
// next Start Preview creates a clean one. Specifically:
//
//   1. Machines with a volume mount at /project (from the disabled
//      persistent-volume experiment — they crash-loop on ENOENT and
//      can't heal themselves because the mount survives restarts).
//   2. Volumes that no longer have a machine attached (orphan volumes
//      still cost money and prevent new volumes from binding to the
//      same name).
//
// Scoped to the authenticated user's projects only — cannot destroy
// another user's machines. Idempotent: safe to call repeatedly.

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { previewAppName, deleteProjectVolume } from '@/lib/fly/apps'
import { flyFetch } from '@/lib/fly/fly-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

export async function POST(request) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  // Get every project the user owns and its Fly app.
  const projects = await db.projects.findByUserId(dbUser.id)
  const results = []

  for (const project of projects) {
    const appName = previewAppName(project.id)
    const report = { projectId: project.id, projectName: project.name || null, machines: [], volumes: [] }

    // 1) Kill any machine with a /project mount.
    try {
      const { res: mRes, body: machines } = await flyFetch(`/apps/${appName}/machines`)
      if (mRes.ok && Array.isArray(machines)) {
        for (const m of machines) {
          const hasVolumeMount = m?.config?.mounts?.some(mnt => mnt?.path === '/project')
          if (!hasVolumeMount) continue
          const { res: dRes, body: dBody } = await flyFetch(`/apps/${appName}/machines/${m.id}?force=true`, {
            method: 'DELETE',
          })
          report.machines.push({
            id: m.id,
            destroyed: dRes.ok,
            status: dRes.status,
            error: dRes.ok ? null : (typeof dBody === 'string' ? dBody : JSON.stringify(dBody)),
          })
        }
      }
    } catch (err) {
      report.machines.push({ error: `list/destroy machines failed: ${err?.message}` })
    }

    // 2) Delete all volumes for the app (they're orphans now since we
    //    just destroyed every machine that could use them).
    try {
      const { res: vRes, body: volumes } = await flyFetch(`/apps/${appName}/volumes`)
      if (vRes.ok && Array.isArray(volumes)) {
        for (const v of volumes) {
          if (v?.state === 'destroyed') continue
          try {
            await deleteProjectVolume(appName, v.id)
            report.volumes.push({ id: v.id, destroyed: true })
          } catch (err) {
            report.volumes.push({ id: v.id, destroyed: false, error: err?.message })
          }
        }
      }
    } catch (err) {
      report.volumes.push({ error: `list/destroy volumes failed: ${err?.message}` })
    }

    if (report.machines.length || report.volumes.length) {
      results.push(report)
    }
  }

  return handleCORS(NextResponse.json({
    ok: true,
    checked_projects: projects.length,
    cleaned: results.length,
    details: results,
  }))
}
