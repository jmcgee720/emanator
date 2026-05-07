// ──────────────────────────────────────────────────────────────────────
// /app/lib/supabase/image-extractor.js
//
// SAFETY NET: when an AI-generated source file inlines a `data:image/...;
// base64,...` URI bigger than ~1KB, extract it to a deduped `_assets/`
// row and rewrite the source to use a placeholder URL the existing
// PreviewTab substitution pipeline already understands.
//
// This is what kept exploding `app/page.jsx` to 24MB (12 inlined PNGs).
// Every write through `persistContent` now goes through here first.
//
//   Before:  app/page.jsx  ─── 24,000 KB (12 inline base64 PNGs)
//   After:   app/page.jsx  ───      30 KB
//            _assets/__gen_img_<hash>.png  ──  one row per UNIQUE image
//
// Hash-based dedup means re-saves don't multiply storage cost.
// ──────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import { createAdminClient } from './admin.js'
import { STORAGE_BUCKET, ensureBucket, storageKey } from './file-storage.js'

const sb = createAdminClient()

// Match `data:image/<fmt>;base64,<chars>`. We capture the format and
// payload separately. Chars set is the standard base64 alphabet plus
// padding. Greedy on the payload — base64 has no internal whitespace.
const DATA_URI_RE = /data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)/g

// Don't extract tiny inline bytes — favicons, 1px GIFs, decorative SVGs.
// Below 1KB it's not worth the round-trip; above it bloats source files.
const MIN_EXTRACT_BYTES = 1024

/**
 * Scan `content` for inline data-image URIs over the threshold. For each
 * one, persist the data URI as an `_assets/__gen_img_<hash>.<ext>` row
 * (deduped by sha1) and swap the inline URI for the canonical placeholder
 * URL `https://emanator-generated.img/<filename>` — exactly the shape
 * PreviewTab.jsx (line ~1410) already substitutes back at render time.
 *
 * Returns the rewritten content + how many extractions happened.
 *
 * Re-entry safety: bails out for `_assets/` paths so we never recursively
 * extract the asset rows themselves.
 */
export async function extractInlineImages(projectId, filePath, content) {
  if (typeof content !== 'string') return { content, extractedCount: 0 }
  if (!content.includes('data:image/')) return { content, extractedCount: 0 }
  if (typeof filePath === 'string' && filePath.startsWith('_assets/')) {
    return { content, extractedCount: 0 }
  }
  if (!projectId) return { content, extractedCount: 0 }

  // Collect matches up front so we can dedupe and process serially.
  // We mutate `result` by replace-all on each unique payload.
  const matches = [...content.matchAll(DATA_URI_RE)]
  if (matches.length === 0) return { content, extractedCount: 0 }

  let result = content
  let extractedCount = 0
  const seen = new Set() // payload-hash → already replaced this run

  for (const m of matches) {
    const fullDataUri = m[0]
    const fmt = m[1]
    const base64 = m[2]

    // Estimate raw size cheaply — base64 is ~4/3× the binary length.
    if (base64.length * 0.75 < MIN_EXTRACT_BYTES) continue

    // Stable filename: hash the payload, not the full URI (avoids dupes
    // when AI emits the same image with subtly different prefixes).
    const hash = createHash('sha1').update(base64).digest('hex').slice(0, 16)
    if (seen.has(hash)) {
      // Already swapped this exact image earlier in this pass.
      const ext = normalizeExt(fmt)
      const placeholder = `https://emanator-generated.img/__gen_img_${hash}.${ext}`
      result = splitAll(result, fullDataUri, placeholder)
      continue
    }
    seen.add(hash)

    const ext = normalizeExt(fmt)
    const assetPath = `_assets/__gen_img_${hash}.${ext}`

    // Skip the upload if a row for this image already exists for this
    // project. Cheap dedupe across re-generations.
    const { data: existing } = await sb
      .from('project_files')
      .select('id')
      .eq('project_id', projectId)
      .eq('path', assetPath)
      .maybeSingle()

    if (!existing) {
      const ok = await ensureBucket()
      if (!ok) {
        // Storage unavailable — best to NOT mangle the source. Fail open
        // and leave the inline data URI as-is. The size cap further
        // downstream will still log/handle the bloat.
        console.warn('[image-extractor] storage unavailable, skipping extraction')
        continue
      }
      const key = storageKey(projectId, assetPath)
      // We store the ENTIRE data URI string (text) in Storage. PreviewTab
      // expects `f.content?.startsWith('data:')` for `_assets/__gen_img*`
      // rows — keep that contract intact. The win is that pages no
      // longer carry the bytes; only one asset row does, deduped.
      const { error: upErr } = await sb.storage
        .from(STORAGE_BUCKET)
        .upload(key, fullDataUri, {
          contentType: 'text/plain; charset=utf-8',
          upsert: true,
        })
      if (upErr) {
        console.warn('[image-extractor] upload failed:', upErr.message)
        continue
      }
      const { error: insErr } = await sb.from('project_files').insert({
        project_id: projectId,
        path: assetPath,
        content: null, // body lives in storage
        storage_path: key,
        file_type: 'image',
        version: 1,
        change_source: 'auto_extracted',
      })
      if (insErr) {
        // If a parallel write created the row already, ignore the
        // unique-key violation. Anything else, leave the data URI
        // inline — better a bloated file than corruption.
        if (!/duplicate key|unique constraint/i.test(insErr.message || '')) {
          console.warn('[image-extractor] insert failed:', insErr.message)
          continue
        }
      }
    }

    const placeholder = `https://emanator-generated.img/__gen_img_${hash}.${ext}`
    result = splitAll(result, fullDataUri, placeholder)
    extractedCount++
  }

  return { content: result, extractedCount }
}

function normalizeExt(fmt) {
  if (fmt === 'jpeg') return 'jpg'
  if (fmt === 'svg+xml') return 'svg'
  return fmt
}

// Replace all occurrences without RegExp escaping pain. The data URIs
// can be 2M chars long; .replace(/.../g) would blow the regex stack.
function splitAll(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement)
}
