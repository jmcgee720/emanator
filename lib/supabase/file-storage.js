// ──────────────────────────────────────────────────────────────────────
// /app/lib/supabase/file-storage.js
//
// Hybrid storage for project_files:
//   - Small files (<= 8 KB) stay inline in `project_files.content`.
//     One Postgres roundtrip, no Storage cost. Fast for tiny files like
//     package.json / .env / config files.
//   - Big files move to Supabase Storage at `<project_id>/<file_path>`.
//     `storage_path` column points at the bucket key. Reads come from
//     the CDN-cached Storage edge (cheap, doesn't burn DB IO budget).
//
// This module is the single owner of the bucket policy + put/get logic.
// db.projectFiles delegates here so call sites stay clean.
//
// Bucket: `project-files` (private, signed URLs / service-role reads).
// ──────────────────────────────────────────────────────────────────────

import { createAdminClient } from './admin.js'

const supabaseAdmin = createAdminClient()

export const STORAGE_BUCKET = 'project-files'

// Files at or below this size stay inline. 8 KB is the sweet spot:
// roughly the median config-file size, and Postgres TOAST compresses
// inline TEXT efficiently up to ~2 KB without disk IO.
export const INLINE_SIZE_LIMIT = 8 * 1024

let bucketEnsured = false

/**
 * Ensure the project-files bucket exists. Idempotent — safe to call on
 * every cold start. The first call after deploy creates it; later calls
 * short-circuit. Errors are non-fatal; we fall back to inline storage.
 */
export async function ensureBucket() {
  if (bucketEnsured) return true
  try {
    const { data: buckets, error } = await supabaseAdmin.storage.listBuckets()
    if (error) return false
    const exists = (buckets || []).some(b => b.name === STORAGE_BUCKET)
    if (!exists) {
      const { error: createErr } = await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
        public: false,
        // Allow common dev-server file types. Storage doesn't run them — we
        // just stream bytes — but the limit prevents pathological abuse.
        fileSizeLimit: 50 * 1024 * 1024, // 50 MB per file
      })
      if (createErr && !/already exists/i.test(createErr.message || '')) return false
    }
    bucketEnsured = true
    return true
  } catch {
    return false
  }
}

export function storageKey(projectId, filePath) {
  // Bucket keys can't start with '/', contain '..', spaces, colons, or other
  // chars Supabase Storage rejects ("Invalid key"). Sanitize per-segment so
  // the bucket layout still mirrors the project tree.
  const safePath = String(filePath || '')
    .replace(/^\/+/, '')
    .replace(/\.\.+/g, '_')
    .split('/')
    .map(seg => seg.replace(/[^a-zA-Z0-9._\-]/g, '_'))
    .join('/')
  return `${projectId}/${safePath}`
}

/**
 * Decide whether a value belongs inline or in Storage. Returns either
 *   { inline: true,  content }                — write inline
 *   { inline: false, storagePath, content: null } — already uploaded, store ref
 */
export async function persistContent(projectId, filePath, content) {
  const text = typeof content === 'string' ? content : ''
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= INLINE_SIZE_LIMIT) {
    return { inline: true, content: text, storage_path: null }
  }
  const ok = await ensureBucket()
  if (!ok) {
    // Storage init failed — degrade gracefully to inline. Better a slow
    // big read than a hard write failure.
    return { inline: true, content: text, storage_path: null }
  }
  const key = storageKey(projectId, filePath)
  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(key, text, {
      contentType: 'text/plain; charset=utf-8',
      upsert: true,
    })
  if (error) {
    console.warn('[file-storage] upload failed, falling back to inline:', error.message)
    return { inline: true, content: text, storage_path: null }
  }
  return { inline: false, content: null, storage_path: key }
}

/**
 * Resolve a row to its actual content string. If `content` is set, use
 * it. If `storage_path` is set, fetch from Storage. Both cases return a
 * string (empty on error, never throws — callers depend on that).
 */
export async function resolveContent(row) {
  if (!row) return ''
  if (typeof row.content === 'string' && row.content.length > 0) return row.content
  if (!row.storage_path) return ''
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .download(row.storage_path)
    if (error || !data) return ''
    if (typeof data.text === 'function') return await data.text()
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
    return ''
  } catch (err) {
    console.warn('[file-storage] download failed for', row.storage_path, err.message)
    return ''
  }
}

/**
 * Resolve content for an array of rows in parallel (capped concurrency
 * so we don't open hundreds of connections to the Storage edge at once).
 * Mutates each row's `content` in place and returns the array.
 */
export async function resolveAllContent(rows, concurrency = 8) {
  if (!Array.isArray(rows) || rows.length === 0) return rows
  const queue = [...rows.entries()]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) return
      const [, row] = next
      if (row.storage_path && !row.content) {
        row.content = await resolveContent(row)
      }
    }
  })
  await Promise.all(workers)
  return rows
}

/**
 * Best-effort delete from Storage when a project_files row is removed.
 * Failures are logged but don't break the caller.
 */
export async function deleteStorageObject(storagePath) {
  if (!storagePath) return
  try {
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath])
  } catch (err) {
    console.warn('[file-storage] delete failed for', storagePath, err.message)
  }
}
