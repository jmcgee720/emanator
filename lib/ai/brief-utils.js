// Shared helpers for the new brief pipeline.
// Kept separate so it's easy to add more post-processing without bloating
// brief-builder.js or brief-reviewer.js.

/**
 * Detect and fix LLM double-escaping in file content.
 *
 * When the LLM emits tool args as JSON, it SHOULD use single escapes
 * ("line1\nline2" → after JSON.parse → "line1<newline>line2"). But for
 * terser/ambiguous prompts (e.g., the repair wave), it sometimes emits
 * double escapes ("line1\\nline2" → after JSON.parse → "line1\nline2"
 * with literal backslash-n, which breaks Babel).
 *
 * Heuristic: if content contains no real newlines but DOES contain
 * literal `\n` substrings, we've been double-escaped. Unescape.
 *
 * Idempotent: a file that's already fine passes through unchanged.
 */
export function normalizeFileContent(content) {
  if (typeof content !== 'string' || content.length === 0) return content

  const hasRealNewlines = content.includes('\n')
  const hasLiteralBackslashN = /\\n/.test(content)

  if (!hasRealNewlines && hasLiteralBackslashN) {
    // Double-escaped — unescape in one pass
    return content
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
  }

  return content
}

/**
 * Apply normalizeFileContent to every file in an array.
 * Mutates new objects, not input.
 */
export function normalizeFiles(files) {
  if (!Array.isArray(files)) return []
  return files.map((f) =>
    f && typeof f === 'object'
      ? { ...f, content: normalizeFileContent(f.content) }
      : f
  )
}
