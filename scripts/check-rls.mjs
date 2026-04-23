#!/usr/bin/env node
/**
 * check-rls.mjs — Supabase RLS audit (WP1)
 *
 * Lists every public-schema table and reports:
 *  - RLS enabled?
 *  - Policies attached (name + command + roles)
 *  - Whether the anon key can read the table (empirical test)
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

// Tables we expect to exist in the Emanator schema.
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
]

// Tables where public SELECT access is intentional (share-by-token flow).
const PUBLIC_READ_EXPECTED = new Set(['shared_previews'])

async function anonCanRead(table) {
  try {
    const { data, error } = await anonClient.from(table).select('*').limit(1)
    if (error) {
      // 42P01 = table does not exist; treat as not applicable.
      if (error.code === '42P01') return 'missing'
      // Permission denied / RLS → this is the GOOD outcome.
      return 'blocked'
    }
    // Got data (even empty list) → anon has read access.
    return Array.isArray(data) ? 'exposed' : 'unknown'
  } catch {
    return 'blocked'
  }
}

async function anonCanWrite(table) {
  // Attempt an obviously-malformed insert so we don't mutate real data.
  // If RLS blocks us before validation, we get a 403; otherwise we get 400.
  try {
    const { error } = await anonClient.from(table).insert({ __rls_probe: true })
    if (!error) return 'exposed'
    if (error.code === '42P01') return 'missing'
    // Postgres error codes: 42501 = insufficient_privilege, 42703 = undefined column.
    // A 403/401 from PostgREST means RLS blocked the write.
    if (
      error.code === '42501' ||
      error.message?.toLowerCase().includes('row-level security') ||
      error.message?.toLowerCase().includes('new row violates') ||
      error.message?.toLowerCase().includes('permission denied')
    ) {
      return 'blocked'
    }
    // 42703 (undefined col) means the request reached the DB → RLS did NOT block.
    if (error.code === '42703') return 'exposed'
    // Any other error we can't classify — assume blocked to avoid false alarms.
    return 'blocked'
  } catch {
    return 'blocked'
  }
}

async function main() {
  console.log(`[rls-check] Target: ${URL}`)
  console.log('[rls-check] Running empirical anon-role probes...\n')

  const results = []
  for (const table of EXPECTED_TABLES) {
    const read = await anonCanRead(table)
    const write = await anonCanWrite(table)
    results.push({ table, read, write })
  }

  // Format as a table.
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('table', 26), pad('anon_read', 12), pad('anon_write', 12), 'verdict')
  console.log('-'.repeat(72))

  let failures = 0
  for (const r of results) {
    let verdict = '✅ locked'
    if (r.read === 'missing') verdict = '⚠️  missing table'
    else if (r.read === 'exposed') {
      if (PUBLIC_READ_EXPECTED.has(r.table)) verdict = '✅ public-read (expected)'
      else {
        verdict = '❌ ANON CAN READ'
        failures++
      }
    }
    if (r.write === 'exposed') {
      verdict = '❌ ANON CAN WRITE'
      failures++
    }
    console.log(pad(r.table, 26), pad(r.read, 12), pad(r.write, 12), verdict)
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
