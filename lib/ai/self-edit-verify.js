// ══════════════════════════════════════════════════════════════════════
// ── SELF-EDIT VERIFIER ──
// Extracted from message-stream.js — the ~60-line block that ran
// verbatim in both `search_replace` and `edit_lines` self-edit branches.
//
// After a self-edit modifies a file on disk, we:
//   1. Hit http://localhost:3000/?_verify=<ts> to force a Next.js
//      recompile and observe any compile errors surfaced in the HTML.
//   2. If the HTML contains compile-error markers (or the response is
//      non-OK), extract the error (from the page + supervisor logs),
//      revert the file from `editResult.originalContent`, and mutate
//      `editResult.success = false` + push an error entry.
//   3. If fetch itself throws (server crashed), same revert + error.
//
// Everything is best-effort: filesystem / log reads that fail are
// silently ignored so the caller still gets a verdict.
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs'
import path from 'path'

const BUILD_ERROR_MARKERS = [
  'Build Error', 'SyntaxError', 'Module build failed', 'Expected', 'Unexpected token',
]

function extractBuildErrorFromHtml(html) {
  if (typeof html !== 'string') return ''
  const m = html.match(/Error:?\s*\n?\s*(?:x\s+)?(.{10,300})/s)
  if (!m) return ''
  return m[1].replace(/<[^>]*>/g, '').trim()
}

function extractBuildErrorFromLogs() {
  try {
    const errLog = fs.readFileSync('/var/log/supervisor/nextjs_api.err.log', 'utf-8')
    const outLog = fs.readFileSync('/var/log/supervisor/nextjs_api.out.log', 'utf-8')
    const allLines = [...errLog.split('\n'), ...outLog.split('\n')]
    for (let i = allLines.length - 1; i >= Math.max(0, allLines.length - 100); i--) {
      if (allLines[i].includes('Expected') || allLines[i].includes('Syntax') || allLines[i].includes('Unexpected token')) {
        return allLines.slice(Math.max(0, i - 3), Math.min(allLines.length, i + 8)).join('\n')
      }
    }
  } catch { /* ignore */ }
  return ''
}

function revert(relPath, originalContent, label) {
  try {
    const fullPath = path.resolve('/app', relPath)
    if (typeof originalContent === 'string') {
      fs.writeFileSync(fullPath, originalContent, 'utf-8')
      console.log(`[${label}] Auto-reverted ${relPath}`)
      return true
    }
  } catch (err) {
    console.warn(`[${label}] Revert failed: ${err.message}`)
  }
  return false
}

/**
 * Verify-and-revert a self-edit by hitting the Next.js dev server.
 * Mutates editResult in place: on failure sets `success = false` and
 * pushes a `BUILD BROKEN` entry into `editResult.errors`.
 *
 * @param {Object} args - tool call args (needs `.path`)
 * @param {Object} editResult - mutated (.success / .errors / uses .originalContent)
 * @param {'search_replace'|'edit_lines'} label - log prefix + error-message wording
 * @param {Object} [opts]
 * @param {number} [opts.waitMs=5000] - settle time before the verify fetch
 * @param {number} [opts.timeoutMs=20000] - fetch abort threshold
 * @returns {Promise<{verified: boolean, reverted: boolean, error: string}>}
 */
export async function verifyAndRevertSelfEdit(args, editResult, label, opts = {}) {
  const waitMs = opts.waitMs ?? 5000
  const timeoutMs = opts.timeoutMs ?? 20000

  console.log(`[${label}-verify] Starting auto-verify for ${args.path}`)
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))

  try {
    const pageRes = await fetch(`http://localhost:3000/?_verify=${Date.now()}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'text/html', 'Cache-Control': 'no-cache' },
    })
    const pageText = await pageRes.text()
    const hasBuildError = BUILD_ERROR_MARKERS.some((marker) => pageText.includes(marker))

    if (hasBuildError || !pageRes.ok) {
      console.error(`[${label}] BUILD BROKEN after editing ${args.path} — auto-reverting`)
      let buildError = extractBuildErrorFromHtml(pageText) || extractBuildErrorFromLogs()

      const reverted = revert(args.path, editResult.originalContent, label)
      editResult.success = false
      editResult.errors = editResult.errors || []

      const errorMsg = label === 'edit_lines'
        ? `BUILD BROKEN — your edit caused a compilation error and was auto-reverted.\n\nCompilation error:\n\`\`\`\n${buildError || 'Unknown syntax error'}\n\`\`\`\n\nTo fix this:\n1. Call \`read_files\` to see the current (reverted) file with line numbers\n2. Identify the problem from the error above — most likely wrong indentation or missing closing tags\n3. Try a smaller, more targeted \`edit_lines\` call\n4. IMPORTANT: Match the indentation of surrounding code EXACTLY`
        : `BUILD BROKEN — auto-reverted.\n\nError:\n\`\`\`\n${buildError || 'Unknown'}\n\`\`\``

      editResult.errors.push(errorMsg)
      return { verified: false, reverted, error: buildError }
    }

    console.log(`[${label}] Build verified OK after editing ${args.path}`)
    return { verified: true, reverted: false, error: '' }
  } catch (fetchErr) {
    console.error(`[${label}] Verify failed: ${fetchErr.message} — reverting`)
    const reverted = revert(args.path, editResult.originalContent, label)
    if (reverted) {
      editResult.success = false
      editResult.errors = ['BUILD BROKEN — server crashed. Auto-reverted.']
    }
    return { verified: false, reverted, error: fetchErr.message }
  }
}
