// ──────────────────────────────────────────────────────────────────────
// /app/scripts/rescue-bloated-projects.mjs
//
// One-shot mop-up: walk every project_files row whose content (or
// resolved Storage body) contains inline `data:image/...;base64,...`
// URIs over the threshold, run them through the image extractor, and
// rewrite the file in-place. Idempotent — safe to re-run.
//
// Use this to recover projects that were generated BEFORE the extractor
// was added to persistContent (e.g. the 240MB Nexsara repro). After this
// script runs, those projects' previews load again because every page is
// back to ~30KB and only `_assets/` rows carry the image bytes.
//
// Usage:
//   node scripts/rescue-bloated-projects.mjs                    # dry run
//   node scripts/rescue-bloated-projects.mjs --apply            # actually rewrite
//   node scripts/rescue-bloated-projects.mjs --apply --project=<uuid>
//   node scripts/rescue-bloated-projects.mjs --apply --threshold=2000000
// ──────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
try {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2]
  }
} catch { /* env optional in CI */ }

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ONLY_PROJECT = (args.find(a => a.startsWith('--project=')) || '').split('=')[1] || null
// Files bigger than THRESHOLD bytes (resolved) are candidates for rescue.
// Default 200KB — comfortably above legit source files (~50-100KB) and
// below the smallest "this is bloated" repro we hit (~10MB pages).
const THRESHOLD = parseInt(
  (args.find(a => a.startsWith('--threshold=')) || '').split('=')[1] || '204800',
  10,
)

const { createAdminClient } = await import('../lib/supabase/admin.js')
const { extractInlineImages } = await import('../lib/supabase/image-extractor.js')
const { resolveContent, persistContent } = await import('../lib/supabase/file-storage.js')

const sb = createAdminClient()

async function main() {
  console.log(`mode: ${APPLY ? '🟢 APPLY' : '🟡 DRY RUN (use --apply to commit)'}`)
  console.log(`threshold: ${THRESHOLD} bytes (${(THRESHOLD/1024).toFixed(0)} KB)`)
  if (ONLY_PROJECT) console.log(`scoped to project: ${ONLY_PROJECT}`)
  console.log()

  // Pull candidates: rows whose content_size (inline) OR storage size is
  // big enough AND whose path is NOT already an `_assets/` row.
  let q = sb
    .from('project_files')
    .select('id, project_id, path, content, storage_path')
    .not('path', 'like', '_assets/%')
  if (ONLY_PROJECT) q = q.eq('project_id', ONLY_PROJECT)

  const { data: rows, error } = await q
  if (error) { console.error('query failed:', error.message); process.exit(1) }
  console.log(`scanning ${rows.length} non-asset rows...\n`)

  let scanned = 0, rescued = 0, totalBefore = 0, totalAfter = 0

  for (const row of rows) {
    scanned++
    let body
    if (typeof row.content === 'string' && row.content.length > 0) {
      body = row.content
    } else if (row.storage_path) {
      body = await resolveContent(row)
    } else {
      continue
    }
    const beforeBytes = Buffer.byteLength(body, 'utf8')
    if (beforeBytes < THRESHOLD) continue
    if (!body.includes('data:image/')) continue

    // Run the extractor on a stable temp pass first, just to count.
    const out = await extractInlineImages(row.project_id, row.path, body)
    if (out.extractedCount === 0) continue

    const afterBytes = Buffer.byteLength(out.content, 'utf8')
    totalBefore += beforeBytes
    totalAfter += afterBytes
    rescued++

    console.log(
      `  ${APPLY ? '🔧' : '👀'}  ${row.project_id}/${row.path}` +
      `  ${(beforeBytes/1024).toFixed(0)}KB → ${(afterBytes/1024).toFixed(1)}KB` +
      `  (${out.extractedCount} images extracted)`,
    )

    if (!APPLY) continue

    // Re-persist the rewritten content. This goes through the same
    // hybrid storage logic as a normal write, so size class flips
    // correctly (was-storage → maybe-inline now).
    try {
      const persisted = await persistContent(row.project_id, row.path, out.content)
      const updates = {
        content: persisted.content,
        storage_path: persisted.storage_path,
        updated_at: new Date().toISOString(),
      }
      const { error: updErr } = await sb
        .from('project_files')
        .update(updates)
        .eq('id', row.id)
      if (updErr) console.warn(`    ⚠ db update failed: ${updErr.message}`)
    } catch (err) {
      console.warn(`    ⚠ rescue failed: ${err.message}`)
    }
  }

  console.log()
  console.log(`scanned: ${scanned}`)
  console.log(`${APPLY ? 'rescued' : 'would rescue'}: ${rescued} files`)
  if (rescued > 0) {
    console.log(
      `bytes: ${(totalBefore/1024/1024).toFixed(2)} MB → ${(totalAfter/1024/1024).toFixed(2)} MB ` +
      `(${(100 - (totalAfter/totalBefore)*100).toFixed(1)}% reduction)`,
    )
  }
  if (!APPLY) console.log('\nrun again with --apply to commit.')
}

main().catch(err => { console.error('fatal:', err); process.exit(1) })
