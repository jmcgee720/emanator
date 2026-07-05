#!/usr/bin/env node
/**
 * Run database migrations directly using pg library.
 * Usage: node scripts/run-migration.js <migration-file>
 */

import { readFileSync } from 'fs'
import { Pool } from 'pg'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials')
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const migrationFile = process.argv[2]
if (!migrationFile) {
  console.error('❌ Usage: node scripts/run-migration.js <migration-file>')
  process.exit(1)
}

// Extract project ref from URL
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
if (!projectRef) {
  console.error('❌ Could not extract project ref from Supabase URL')
  process.exit(1)
}

// Build connection string
const connectionString = `postgresql://postgres.${projectRef}:${supabaseServiceKey}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`

async function runMigration() {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  try {
    console.log(`📖 Reading ${migrationFile}...`)
    const sql = readFileSync(migrationFile, 'utf-8')
    
    console.log(`🚀 Executing migration (${sql.length} chars)...`)
    const result = await pool.query(sql)
    
    console.log(`✅ Migration completed successfully`)
    console.log(`   Rows affected: ${result.rowCount || 0}`)
    
  } catch (error) {
    console.error(`❌ Migration failed:`, error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

runMigration()
