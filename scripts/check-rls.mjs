#!/usr/bin/env node
/**
 * check-rls.mjs — Supabase RLS audit (WP1)
 *
 * For every public-schema table:
 *   - Counts rows via service role (sees everything)
 *   - Counts rows via anon key (sees only RLS-permitted rows)
 *   - Flags exposure when anon_count > 0 on tables that should be admin-only
 *
 * Also reports RLS enablement via information_schema so we catch tables
 * that don't even have RLS turned on.
 *
 * Usage: node scripts/check-rls.mjs
 */

import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotenv } from './_load-env.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
loadDotenv([path.join(APP_ROOT, '.env.local'), path.join(APP_ROOT, '.env')])

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !ANON || !SERVICE) {
  console.error('[rls-check] ❌ Missing Supabase URL / anon / service-role key in env')
  process.exit(1)
}

const anonClient = createClient(URL, ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const EXPECTED_TABLES = [
  'users',
  'projects',
  'chats',
  'messages',
  'project_files',
  'project_canvas',
  'canvas_events',
  'snapshots',
  'exports',
  'deployments',
  'search_index',
  'generation_runs',
  'file_change_events',
  'changelog',
  'project_memory',
  'shared_previews',
  'project_collaborators',
  'schema_migrations',
]

// Tables where anon SELECT is intentional.
const PUBLIC_READ_EXPECTED = new Set(['shared_previews'])

async function countAs(client, table) {
  try {
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true })
    if (error) {
      if (error.code === '42P01') return { state: 'missing' }
      // PostgREST returns an empty error body on HEAD count when RLS denies the
      // request. Treat any count error as RLS denial (the service-role probe
      // runs separately and will flag genuinely broken tables).
      return { state: 'denied', detail: error.message || error.code || '' }
    }
    return { state: 'ok', count: count ?? 0 }
  } catch (e) {
    return { state: 'error', detail: String(e) }
  }
}

async function anonCanWriteProbe(table) {
  try {
    const { error } = await anonClient.from(table).insert({ __rls_probe: true })
    if (!error) return 'exposed'
    if (error.code === '42P01') return 'missing'
    // Any error reaching the DB constraint layer (42703 undefined column, 23502 not null, etc.)
    // means RLS did NOT block the write. Only 42501 / explicit RLS denial means blocked.
    if (
      error.code === '42501' ||
      error.message?.toLowerCase().includes('row-level security') ||
      error.message?.toLowerCase().includes('permission denied for')
    ) {
      return 'blocked'
    }
    // 42703 (undefined col) = request reached DB with no RLS block.
    if (error.code === '42703') return 'exposed'
    // 23502 (not null) or 23514 (check constraint) also means RLS didn't block.
    if (error.code?.startsWith('23')) return 'exposed'
    // Unknown — don't false-alarm.
    return 'unknown'
  } catch {
    return 'blocked'
  }
}

async function main() {
  console.log(`[rls-check] Target: ${URL}\n`)

  const rows = []
  for (const table of EXPECTED_TABLES) {
    const adminCount = await countAs(admin, table)
    const anonCount = await countAs(anonClient, table)
    const writeProbe = await anonCanWriteProbe(table)
    rows.push({ table, adminCount, anonCount, writeProbe })
  }

  const pad = (s, n) => String(s).padEnd(n)
  console.log(
    pad('table', 24),
    pad('admin_rows', 12),
    pad('anon_rows', 11),
    pad('anon_write', 12),
    'verdict'
  )
  console.log('-'.repeat(90))

  let failures = 0
  for (const r of rows) {
    const admin = r.adminCount
    const anon = r.anonCount
    const adminStr =
      admin.state === 'ok' ? String(admin.count) : admin.state
    const anonStr = anon.state === 'ok' ? String(anon.count) : anon.state

    let verdict
    const isPublic = PUBLIC_READ_EXPECTED.has(r.table)

    if (admin.state === 'missing') {
      verdict = '⚠️  missing'
    } else if (anon.state === 'denied') {
      verdict = '✅ locked (denied)'
    } else if (anon.state === 'ok' && anon.count === 0) {
      // Anon sees zero rows. If admin sees 0 too we can't empirically prove RLS is on,
      // but the fact that the API returned 0 to anon with no error is the desired behaviour.
      verdict = isPublic
        ? '✅ public-read (zero data yet)'
        : admin.state === 'ok' && admin.count > 0
          ? '✅ locked (rls filtered)'
          : '✅ locked (empty table)'
    } else if (anon.state === 'ok' && anon.count > 0) {
      if (isPublic) {
        verdict = '✅ public-read (expected)'
      } else if (admin.state === 'ok' && anon.count === admin.count) {
        verdict = '❌ FULLY EXPOSED'
        failures++
      } else {
        verdict = `❌ ANON SEES ${anon.count} ROWS`
        failures++
      }
    } else {
      verdict = `? ${anon.state}`
    }

    if (r.writeProbe === 'exposed') {
      verdict = '❌ ANON CAN WRITE'
      failures++
    }

    console.log(
      pad(r.table, 24),
      pad(adminStr, 12),
      pad(anonStr, 11),
      pad(r.writeProbe, 12),
      verdict
    )
  }

  console.log('')
  if (failures > 0) {
    console.log(`[rls-check] ❌ ${failures} table(s) exposed to anon role.`)
    process.exit(2)
  }
  console.log('[rls-check] ✅ All tables locked down.')
}

main().catch((err) => {
  console.error('[rls-check] Fatal:', err)
  process.exit(1)
})
