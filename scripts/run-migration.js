#!/usr/bin/env node
/**
 * Run a Supabase migration directly using pg library.
 * Usage: node scripts/run-migration.js <migration-file-path>
 */

import { readFileSync } from 'fs'
import { Pool } from 'pg'

const migrationPath = process.argv[2]
if (!migrationPath) {
  console.error('Usage: node scripts/run-migration.js <migration-file-path>')
  process.exit(1)
}

const sql = readFileSync(migrationPath, 'utf-8')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// Extract project ref
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
if (!projectRef) {
  console.error('Could not extract project ref from Supabase URL')
  process.exit(1)
}

const connectionString = `postgresql://postgres.${projectRef}:${supabaseServiceKey}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

console.log(`Running migration: ${migrationPath}`)
console.log(`SQL length: ${sql.length} chars`)

try {
  const result = await pool.query(sql)
  console.log('✅ Migration executed successfully')
  console.log(`Rows affected: ${result.rowCount || 0}`)
  await pool.end()
  process.exit(0)
} catch (err) {
  console.error('❌ Migration failed:', err.message)
  await pool.end()
  process.exit(1)
}
