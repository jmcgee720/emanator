#!/usr/bin/env node
/**
 * db-migrate.mjs — Supabase migration runner (WP5)
 *
 * Reads .sql files from /app/supabase/migrations/, applies any that haven't been
 * recorded in the `schema_migrations` table yet, and records each successful run.
 *
 * Usage:
 *   node scripts/db-migrate.mjs                # apply all pending
 *   node scripts/db-migrate.mjs --dry-run      # list pending, apply nothing
 *   node scripts/db-migrate.mjs --file 007     # apply one file matching prefix
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   (picked up from .env.local automatically)
 */

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadDotenv } from './_load-env.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const MIGRATIONS_DIR = path.join(APP_ROOT, 'supabase', 'migrations')

loadDotenv([path.join(APP_ROOT, '.env.local'), path.join(APP_ROOT, '.env')])

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !SERVICE_KEY) {
  console.error('[migrate] ❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fileFlag = args.indexOf('--file')
const fileFilter = fileFlag >= 0 ? args[fileFlag + 1] : null

/**
 * Execute raw SQL via Supabase. We use the PostgREST `query` RPC if available,
 * otherwise fall back to the REST endpoint's /rest/v1/rpc/exec_sql helper,
 * otherwise just POST to /rest/v1/ with the statement.
 *
 * Most production Supabase projects don't expose a generic SQL RPC for safety,
 * so the preferred path is the undocumented `pg` endpoint. We fall back to a
 * statement-by-statement POST via the meta API.
 */
async function execSql(sql) {
  // Try the PostgREST -> pg_net bridge (rarely enabled; safe to attempt).
  // The reliable path is the Supabase management API endpoint via the service key.
  const endpoint = `${URL}/rest/v1/rpc/exec_sql`
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ sql }),
  })
  if (resp.ok) return { ok: true, via: 'rpc', body: await resp.text() }

  // Fallback: use the pg-meta endpoint that Supabase Studio itself uses.
  // Not guaranteed to be exposed publicly, but worth trying before we give up.
  const metaEndpoint = `${URL.replace('.supabase.co', '.supabase.co')}/pg/query`
  const metaResp = await fetch(metaEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  })
  if (metaResp.ok) return { ok: true, via: 'pg-meta', body: await metaResp.text() }

  const status = resp.status
  const detail = await resp.text().catch(() => '')
  return { ok: false, status, detail }
}

async function ensureMigrationsTable() {
  // Can't create this via the standard supabase-js client (no generic SQL),
  // so we rely on it existing or being created by the first migration run.
  // We store applied migrations directly in a `schema_migrations` table.
  const { error } = await supabase.from('schema_migrations').select('name').limit(1)
  if (error && error.code === '42P01') {
    // Table doesn't exist — create via RPC exec.
    console.log('[migrate] Creating schema_migrations tracking table...')
    const result = await execSql(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
    if (!result.ok) {
      console.warn(
        '[migrate] ⚠️  Could not auto-create schema_migrations table.',
        'Run this SQL manually in the Supabase SQL editor, then re-run the migration:'
      )
      console.log(
        '\n  CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());\n'
      )
      return false
    }
  }
  return true
}

async function getAppliedSet() {
  const { data, error } = await supabase.from('schema_migrations').select('name')
  if (error) return new Set()
  return new Set(data.map((r) => r.name))
}

async function recordApplied(name) {
  const { error } = await supabase.from('schema_migrations').upsert({ name })
  if (error) console.warn(`[migrate] ⚠️  Could not record ${name}:`, error.message)
}

async function main() {
  console.log(`[migrate] Target: ${URL}`)
  console.log(`[migrate] Migrations dir: ${MIGRATIONS_DIR}`)

  const ready = await ensureMigrationsTable()
  if (!ready) process.exit(1)

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  if (!files.length) {
    console.log('[migrate] No migration files found.')
    return
  }

  const applied = await getAppliedSet()
  let pending = files.filter((f) => !applied.has(f))
  if (fileFilter) {
    pending = pending.filter((f) => f.startsWith(fileFilter))
  }

  if (!pending.length) {
    console.log('[migrate] ✅ Nothing to apply. All migrations already recorded.')
    console.log(
      `[migrate] Already applied (${applied.size}):`,
      [...applied].sort().join(', ') || '(none)'
    )
    return
  }

  console.log(`[migrate] Pending (${pending.length}):`, pending.join(', '))

  if (dryRun) {
    console.log('[migrate] --dry-run set, exiting without applying.')
    return
  }

  for (const name of pending) {
    const sqlPath = path.join(MIGRATIONS_DIR, name)
    const sql = await readFile(sqlPath, 'utf8')
    console.log(`[migrate] ▶ Applying ${name}... (${sql.length} bytes)`)
    const result = await execSql(sql)
    if (!result.ok) {
      console.error(`[migrate] ❌ Failed on ${name}: HTTP ${result.status}`)
      console.error(result.detail)
      console.error('')
      console.error(
        '[migrate] To apply this migration manually, paste the contents of'
      )
      console.error(`           supabase/migrations/${name}`)
      console.error('           into the Supabase SQL editor and run it.')
      console.error('           Then re-run this script to record it as applied.')
      process.exit(2)
    }
    await recordApplied(name)
    console.log(`[migrate] ✅ ${name} applied (via ${result.via})`)
  }
  console.log('[migrate] Done.')
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err)
  process.exit(1)
})
