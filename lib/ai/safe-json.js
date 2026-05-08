// ──────────────────────────────────────────────────────────────────────
// /app/lib/ai/safe-json.js
//
// Tolerant JSON parser for LLM output. Real-world LLM JSON failure modes:
//   1. Token-budget truncation: output ends mid-array, no closing ']'.
//   2. Inline `// …` line comments leaked from a few-shot example.
//   3. Block /* … */ comments.
//   4. Trailing commas after the last element of an array/object.
//   5. Smart quotes (curly “” instead of straight ").
//   6. Markdown fences ```json … ``` wrapping the payload.
//
// We try strict JSON first (fast path). On failure we run a sequence of
// repair passes — each pass widens the tolerance — until either parse
// succeeds or we run out of repairs. The original raw text is always
// preserved on the returned error for downstream debugging.
//
// `safeParseJson(raw)` returns an object: { ok, value, error, attempts }
//   • ok=true  → value is the parsed JSON
//   • ok=false → error has a human message + .raw + .attempts breadcrumb
// ──────────────────────────────────────────────────────────────────────

export function safeParseJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: new Error('safeParseJson: empty input'), attempts: [] }
  }
  const attempts = []

  // Pass 0: strict parse.
  try {
    return { ok: true, value: JSON.parse(raw), attempts: ['strict'] }
  } catch (err) {
    attempts.push(`strict: ${err.message}`)
  }

  // Pass 1: strip code fences + leading/trailing prose.
  let text = stripCodeFences(raw)
  text = sliceLargestJsonBlob(text)
  if (text !== raw) {
    try {
      return { ok: true, value: JSON.parse(text), attempts: [...attempts, 'fenced'] }
    } catch (err) {
      attempts.push(`fenced: ${err.message}`)
    }
  }

  // Pass 2: strip line + block comments + smart quotes.
  text = stripComments(text)
  text = normalizeQuotes(text)
  try {
    return { ok: true, value: JSON.parse(text), attempts: [...attempts, 'cleaned'] }
  } catch (err) {
    attempts.push(`cleaned: ${err.message}`)
  }

  // Pass 3: drop trailing commas (`{a:1,}` → `{a:1}`).
  text = dropTrailingCommas(text)
  try {
    return { ok: true, value: JSON.parse(text), attempts: [...attempts, 'trailing_commas'] }
  } catch (err) {
    attempts.push(`trailing_commas: ${err.message}`)
  }

  // Pass 4: auto-close truncated braces / brackets. This is the one that
  // saves Phase 1 plans that hit the token budget mid-array.
  const closed = autoCloseTruncated(text)
  if (closed && closed !== text) {
    try {
      return { ok: true, value: JSON.parse(closed), attempts: [...attempts, 'auto_closed'] }
    } catch (err) {
      attempts.push(`auto_closed: ${err.message}`)
    }
  }

  // Pass 5: salvage the longest valid prefix. Walk backwards from the end
  // until we find a position where the substring parses. Slow on large
  // payloads but bounded — only runs when every other pass failed.
  const salvaged = salvageLongestPrefix(text)
  if (salvaged !== null) {
    return { ok: true, value: salvaged, attempts: [...attempts, 'salvaged_prefix'] }
  }
  attempts.push('salvaged_prefix: no parsable prefix found')

  const error = new Error(`safeParseJson failed after ${attempts.length} attempts: ${attempts.join(' | ')}`)
  error.raw = raw
  error.attempts = attempts
  return { ok: false, error, attempts }
}

// ───────── helpers ─────────

function stripCodeFences(s) {
  // ```json … ``` or ``` … ```
  const m = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i)
  return m ? m[1] : s
}

function sliceLargestJsonBlob(s) {
  // Take the substring from the FIRST '{' or '[' to the LAST '}' or ']'.
  // Drops surrounding prose like "Here is your plan: { ... } Hope this helps!"
  const firstObj = s.indexOf('{')
  const firstArr = s.indexOf('[')
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr)
  if (start === -1) return s
  const lastObj = s.lastIndexOf('}')
  const lastArr = s.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  if (end <= start) return s
  return s.slice(start, end + 1)
}

function stripComments(s) {
  let out = ''
  let i = 0
  let inString = false
  let stringChar = ''
  while (i < s.length) {
    const c = s[i]
    const next = s[i + 1]
    if (inString) {
      out += c
      if (c === '\\' && i + 1 < s.length) { out += next; i += 2; continue }
      if (c === stringChar) inString = false
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inString = true
      stringChar = c
      out += c
      i++
      continue
    }
    if (c === '/' && next === '/') {
      // Line comment — skip to end of line.
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      // Block comment — skip to matching */
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

function normalizeQuotes(s) {
  // Smart double quotes → straight; curly singles inside strings are fine.
  return s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
}

function dropTrailingCommas(s) {
  let out = ''
  let i = 0
  let inString = false
  let stringChar = ''
  while (i < s.length) {
    const c = s[i]
    if (inString) {
      out += c
      if (c === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue }
      if (c === stringChar) inString = false
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inString = true
      stringChar = c
      out += c
      i++
      continue
    }
    if (c === ',') {
      // Look ahead past whitespace for the next non-space char.
      let j = i + 1
      while (j < s.length && /\s/.test(s[j])) j++
      if (s[j] === '}' || s[j] === ']') { i++; continue }
    }
    out += c
    i++
  }
  return out
}

function autoCloseTruncated(s) {
  // Scan, count unbalanced braces + brackets, ignore string contents.
  // If we end inside a string, also close the string.
  const stack = []
  let inString = false
  let stringChar = ''
  let lastNonStringChar = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\' && i + 1 < s.length) { i++; continue }
      if (c === stringChar) inString = false
      continue
    }
    if (c === '"' || c === "'") { inString = true; stringChar = c; continue }
    if (c === '{' || c === '[') stack.push(c)
    else if (c === '}' || c === ']') {
      // Pop matching open.
      if (stack.length === 0) return null
      stack.pop()
    }
    if (!/\s/.test(c)) lastNonStringChar = c
  }
  let out = s
  if (inString) out += stringChar
  // If output ends with a trailing comma (with maybe whitespace), drop it
  // before closing the container — `{a:1,}` is illegal but `{a:1}` works.
  out = out.replace(/,\s*$/, '')
  // Also: if last meaningful char was an open quote of a key (e.g.
  // `"name": "Tas` — partial value), close it gracefully. The trim above
  // handles the structural case; a half-written string still fails,
  // which is fine — salvage_prefix is the next line of defense.
  while (stack.length > 0) {
    const open = stack.pop()
    out += open === '{' ? '}' : ']'
  }
  return out
}

function salvageLongestPrefix(s) {
  // Try parsing successively shorter prefixes ending at every `}` or `]`
  // working backwards. First parse-able prefix wins. Bounded to ~50
  // attempts so we don't melt the CPU on garbage input.
  const candidates = []
  for (let i = s.length - 1; i >= 0 && candidates.length < 50; i--) {
    const c = s[i]
    if (c === '}' || c === ']') candidates.push(i + 1)
  }
  for (const cutAt of candidates) {
    const slice = s.slice(0, cutAt)
    try { return JSON.parse(slice) } catch { /* keep walking */ }
  }
  return null
}
