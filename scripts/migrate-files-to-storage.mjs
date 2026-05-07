// ──────────────────────────────────────────────────────────────────────
// /app/scripts/migrate-files-to-storage.mjs
//
// One-shot backfill: walk every project_files row that still has its
// content inline AND is bigger than INLINE_SIZE_LIMIT, push the body
// into Supabase Storage, set storage_path, NULL out content.
//
// IDEMPOTENT — safe to re-run any time. Only touches rows that need
// migrating. Resumes cleanly if interrupted.
//
// Usage:
//   node scripts/migrate-files-to-storage.mjs            # dry run
//   node scripts/migrate-files-to-storage.mjs --apply    # actually migrate
//   node scripts/migrate-files-to-storage.mjs --apply --batch=100
//
// Flags:
//   --apply        actually write changes (default is dry run)
//   --batch=N      rows per round (default 200)
//   --limit=N      stop after N migrations (default no limit)
// ──────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'

// Load .env.local manually so we don't pull in next.js runtime.
try {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2]
  }
} catch { /* file optional in CI */ }

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const BATCH = parseInt((args.find(a => a.startsWith('--batch=')) || '').split('=')[1] || '200', 10)
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10)

const { createAdminClient } = await import('../lib/supabase/admin.js')
const { STORAGE_BUCKET, INLINE_SIZE_LIMIT, ensureBucket, storageKey } = await import('../lib/supabase/file-storage.js')

const sb = createAdminClient()

async function main() {
  console.log(`mode: ${APPLY ? '🟢 APPLY' : '🟡 DRY RUN (use --apply to commit)'}`)
  console.log(`batch=${BATCH} limit=${LIMIT || 'no limit'}`)
  console.log(`inline threshold=${INLINE_SIZE_LIMIT} bytes\n`)

  const ok = await ensureBucket()
  if (!ok) {
    console.error('❌ could not initialise the project-files bucket. Aborting.')
    process.exit(1)
  }
  console.log(`✓ bucket "${STORAGE_BUCKET}" ready\n`)

  let migrated = 0
  let scanned = 0
  let lastId = '00000000-0000-0000-0000-000000000000'

  while (true) {
    // Cursor-paginate by id (always indexed) — survives interruption.
    const { data: rows, error } = await sb
      .from('project_files')
      .select('id, project_id, path, content, storage_path')
      .is('storage_path', null) // only rows still inline
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(BATCH)

    if (error) {
      console.error('query failed:', error.message)
      process.exit(1)
    }
    if (!rows || rows.length === 0) break

    for (const row of rows) {
      scanned++
      lastId = row.id
      const text = typeof row.content === 'string' ? row.content : ''
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes <= INLINE_SIZE_LIMIT) continue // stays inline

      console.log(`  ${row.project_id}/${row.path} — ${(bytes / 1024).toFixed(1)} KB`)

      if (!APPLY) { migrated++; continue }

      const key = storageKey(row.project_id, row.path)
      const { error: upErr } = await sb.storage
        .from(STORAGE_BUCKET)
        .upload(key, text, {
          contentType: 'text/plain; charset=utf-8',
          upsert: true,
        })
      if (upErr) {
        console.warn(`    ⚠ upload failed: ${upErr.message}`)
        continue
      }
      const { error: updErr } = await sb
        .from('project_files')
        .update({ storage_path: key, content: null })
        .eq('id', row.id)
      if (updErr) {
        console.warn(`    ⚠ db update failed: ${updErr.message} — orphan in storage`)
        continue
      }
      migrated++
      if (LIMIT && migrated >= LIMIT) break
    }

    if (LIMIT && migrated >= LIMIT) break
    if (rows.length < BATCH) break
  }

  console.log(`\n${APPLY ? 'migrated' : 'would migrate'}: ${migrated} files (scanned ${scanned})`)
  if (!APPLY) console.log(`\nrun again with --apply to commit.`)
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
