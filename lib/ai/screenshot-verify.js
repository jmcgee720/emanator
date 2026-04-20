// ══════════════════════════════════════════════════════════════════════
// ── SCREENSHOT VERIFY (Session 28, 4/7) ──
// Post-build visual fidelity check. Reads the freshly generated source
// files (landing + navbar), re-attaches the user's aesthetic/structural
// reference images, and asks GPT-4o Vision to score how faithfully the
// code replicates the references. Emits a structured diff the repair
// loop (Session 29) will consume to drive N-round self-correction.
//
// Design note: a full Puppeteer-based pixel-diff pipeline is deferred to
// Session 30+ once the primitives decomposition lands. In the meantime,
// the "Vision reads the source code alongside the reference" pass
// catches the high-signal mismatches (hero composition, palette, layout
// rhythm, brand-copy discipline) at a fraction of the runtime cost.
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} VerifyFinding
 * @property {string} file      - file path flagged (e.g. 'components/Landing.jsx')
 * @property {string} category  - 'palette' | 'typography' | 'composition' | 'brand-copy' | 'imagery' | 'spacing' | 'other'
 * @property {string} issue     - short human-readable diff ("hero uses gradient placeholder instead of uploaded logo")
 * @property {string} fix       - concrete suggested rewrite ("replace the span gradient with <img src={LOGO_URL} />")
 */

/**
 * @typedef {Object} VerifyResult
 * @property {boolean} matches                    - overall pass/fail
 * @property {number}  confidence                 - 0..1
 * @property {VerifyFinding[]} findings           - structured mismatches
 * @property {string}  summary                    - 1-sentence English verdict
 */

const VERIFY_SYSTEM_PROMPT = `You are a senior design-review engineer. You will receive:
  1. User-uploaded REFERENCE images (aesthetic + structural inspiration).
  2. The GENERATED SOURCE CODE of the freshly built landing page and navbar.

Your job: compare the code's RENDERED OUTPUT (which you must mentally evaluate from the JSX + Tailwind classes) against the reference images, and flag concrete mismatches.

Be STRICT — this is the final quality gate before the build ships to the user. Tiny mismatches matter (a violet button where the reference is black, a centered hero where the reference is left-aligned, generic "Welcome" copy where the reference mood is editorial).

Respond with a JSON object EXACTLY matching:
{
  "matches": boolean,
  "confidence": number (0..1, how confident you are in this verdict),
  "findings": [
    {
      "file": "<relative file path>",
      "category": "palette" | "typography" | "composition" | "brand-copy" | "imagery" | "spacing" | "other",
      "issue": "<1-sentence plain-English diff>",
      "fix": "<1-sentence concrete code change>"
    }
  ],
  "summary": "<1-sentence verdict>"
}

RULES:
- Mark matches=true ONLY if ALL major aesthetic/compositional dimensions are faithful.
- Cap findings at 6 — only the highest-impact mismatches.
- findings[] MUST be empty array (not omitted) when matches=true.
- Never guess about files you haven't been shown.
- Respond with JSON ONLY, no prose.`

/**
 * Paths the verifier inspects. Kept tight — these are the files that
 * carry 90% of the visual signal. Expanding this list costs tokens
 * without materially improving the diff.
 */
const INSPECTION_PATHS = [
  'app/page.jsx',
  'components/Landing.jsx',
  'components/Navbar.jsx',
  'components/Hero.jsx',
]

const MAX_CODE_CHARS = 3500 // per file — keeps the Vision request under budget

/**
 * Extract the files we want Vision to inspect. Missing files are
 * silently skipped.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function pickInspectionFiles(files) {
  if (!Array.isArray(files)) return []
  const byPath = new Map()
  for (const f of files) {
    if (f?.path && typeof f.content === 'string') byPath.set(f.path, f.content)
  }
  const picked = []
  for (const p of INSPECTION_PATHS) {
    if (byPath.has(p)) picked.push({ path: p, content: truncate(byPath.get(p), MAX_CODE_CHARS) })
  }
  return picked
}

function truncate(s, max) {
  if (typeof s !== 'string') return ''
  if (s.length <= max) return s
  return s.slice(0, max) + `\n// ... [truncated — original was ${s.length} chars]`
}

function toDataUrl(data, name = '') {
  if (!data) return ''
  if (String(data).startsWith('data:')) return data
  const ext = (name.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'svg' ? 'image/svg+xml'
    : 'image/png'
  return `data:${mime};base64,${data}`
}

/**
 * Build the Vision request body: a text block describing each reference
 * image + the source code, followed by the reference image_url parts.
 *
 * @param {Array<{path: string, content: string}>} inspectionFiles
 * @param {Array<{data: string, name?: string, role?: string, note?: string}>} referenceImages
 */
export function buildVerifyRequest(inspectionFiles, referenceImages) {
  const refs = (referenceImages || [])
    .filter((a) => a?.data)
    .slice(0, 3) // cap — only need a couple of references to ground the diff

  const filesBlock = inspectionFiles.length > 0
    ? inspectionFiles.map((f) => `### ${f.path}\n\`\`\`jsx\n${f.content}\n\`\`\``).join('\n\n')
    : '(no inspection files available)'

  const referenceLabels = refs.map((r, i) => {
    const role = r.role || 'reference'
    const note = r.note ? ` — note: "${String(r.note).slice(0, 120)}"` : ''
    return `Image ${i + 1}: role=${role}${note}`
  }).join('\n')

  const text = `## REFERENCES\n${referenceLabels || '(none attached)'}\n\n## GENERATED SOURCE\n${filesBlock}\n\nCompare the code to the reference images and respond with the JSON verdict.`

  const content = [
    { type: 'text', text },
    ...refs.map((r) => ({
      type: 'image_url',
      image_url: { url: toDataUrl(r.data || r.dataUrl, r.name), detail: 'low' },
    })),
  ]
  return content
}

/**
 * Run the Vision verifier. Non-blocking — returns null on any failure
 * so the build pipeline keeps moving.
 *
 * @param {Object} args
 * @param {Array<{path: string, content: string}>} args.files
 * @param {Array} args.referenceImages
 * @param {Object} args.provider
 * @returns {Promise<VerifyResult|null>}
 */
export async function verifyBuild({ files, referenceImages, provider }) {
  const inspectionFiles = pickInspectionFiles(files)
  if (inspectionFiles.length === 0) return null
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) return null
  if (!provider?.chat) return null

  const userContent = buildVerifyRequest(inspectionFiles, referenceImages)

  let raw
  try {
    raw = await provider.chat(
      [
        { role: 'system', content: VERIFY_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.1, max_tokens: 900, response_format: { type: 'json_object' } }
    )
  } catch (err) {
    console.warn('[ScreenshotVerify] Vision call failed:', err?.message || err)
    return null
  }

  return parseVerifyResult(raw)
}

/**
 * Validate the JSON Vision returned. Coerces malformed findings into
 * safe defaults; returns null when the shape is completely unusable.
 *
 * @param {string|object} raw
 * @returns {VerifyResult|null}
 */
export function parseVerifyResult(raw) {
  if (!raw) return null
  let p
  try { p = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null

  const validCategories = ['palette', 'typography', 'composition', 'brand-copy', 'imagery', 'spacing', 'other']
  const findings = Array.isArray(p.findings) ? p.findings : []
  const cleaned = findings
    .filter((f) => f && typeof f === 'object' && typeof f.issue === 'string' && f.issue.trim())
    .slice(0, 6)
    .map((f) => ({
      file: typeof f.file === 'string' ? f.file : '',
      category: validCategories.includes(f.category) ? f.category : 'other',
      issue: String(f.issue).slice(0, 240),
      fix: typeof f.fix === 'string' ? String(f.fix).slice(0, 240) : '',
    }))

  const confidence = typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1
    ? p.confidence : 0.5
  const matches = typeof p.matches === 'boolean' ? p.matches : cleaned.length === 0
  const summary = typeof p.summary === 'string' ? p.summary.slice(0, 200) : ''

  return { matches, confidence, findings: cleaned, summary }
}

/**
 * Convert verify findings into the `{missing, broken}` shape the existing
 * `repairBuild()` pipeline consumes. Each finding becomes a `broken`
 * entry of the form `<file>: <category>-<slugified-issue>` with the
 * LLM's suggested fix appended as a trailing hint. `repairBuild()` uses
 * the file-prefix of the string to pick which files to re-send — so the
 * file: prefix here is load-bearing.
 *
 * @param {VerifyResult} result
 * @returns {{missing: string[], broken: string[]}}
 */
export function findingsToReviewShape(result) {
  if (!result || !Array.isArray(result.findings) || result.findings.length === 0) {
    return { missing: [], broken: [] }
  }
  const broken = result.findings
    .filter((f) => f && f.file && f.issue)
    .map((f) => {
      const slug = String(f.issue).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      const hint = f.fix ? ` — fix: ${f.fix}` : ''
      return `${f.file}: vision-${f.category}-${slug}${hint}`
    })
  return { missing: [], broken }
}

/**
 * Format the verify result as a compact prompt block the repair wave
 * (Session 29) will consume. Per-file grouped so the LLM can target
 * each fix precisely.
 *
 * @param {VerifyResult} result
 * @returns {string}
 */
export function formatVerifyForRepairPrompt(result) {
  if (!result || result.matches || result.findings.length === 0) return ''
  const byFile = new Map()
  for (const f of result.findings) {
    const key = f.file || '(unknown file)'
    if (!byFile.has(key)) byFile.set(key, [])
    byFile.get(key).push(f)
  }
  const blocks = []
  for (const [file, items] of byFile.entries()) {
    const bullets = items.map((it) => `  - [${it.category}] ${it.issue}${it.fix ? ` → FIX: ${it.fix}` : ''}`).join('\n')
    blocks.push(`${file}:\n${bullets}`)
  }
  const header = result.summary
    ? `VISUAL-DIFF FINDINGS (from Vision compare against user reference): ${result.summary}`
    : 'VISUAL-DIFF FINDINGS (from Vision compare against user reference):'
  return `${header}\n\n${blocks.join('\n\n')}`
}
