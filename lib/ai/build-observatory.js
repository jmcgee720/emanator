// ══════════════════════════════════════════════════════════════════════
// ── BUILD OBSERVATORY ──
// Assembles a structured manifest of everything the pipeline produced for
// a given build. Powers the debug panel that answers "why isn't my logo
// rendering?" in 3 seconds instead of 3 screenshots.
//
// The manifest is a PURE DATA STRUCTURE — no side effects. Rendered by
// the frontend (BuildObservatoryPanel.jsx).
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} BuildManifest
 * @property {Object} assets       - what ended up in components/assets.js
 * @property {Object} theme        - what ended up in components/theme.js
 * @property {Object|null} blueprint - layout blueprint JSON, if extracted
 * @property {Object} attachments  - raw counts by role
 * @property {Array<Object>} timings - [{stage, ms}] per pipeline phase
 * @property {Array<Object>} integrity - [{name, pass, detail}] self-test results
 * @property {Array<string>} warnings - high-signal issues
 */

/**
 * Roll a full manifest for the current build. All fields are optional —
 * missing data becomes `null` or `[]` rather than failing.
 *
 * @param {Object} opts
 * @param {Array<{role, name, dataUrl, note}>} opts.imageAssets
 * @param {Array<{role?, note?}>} opts.rawAttachments
 * @param {Object|null} opts.designTokens
 * @param {Object|null} opts.layoutBlueprint
 * @param {Array<{stage, ms}>} opts.timings
 * @param {Array<{path, content}>} opts.projectFiles
 * @returns {BuildManifest}
 */
export function buildManifest(opts = {}) {
  const imageAssets = Array.isArray(opts.imageAssets) ? opts.imageAssets : []
  const rawAttachments = Array.isArray(opts.rawAttachments) ? opts.rawAttachments : []
  const designTokens = opts.designTokens || null
  const layoutBlueprint = opts.layoutBlueprint || null
  const timings = Array.isArray(opts.timings) ? opts.timings : []
  const projectFiles = Array.isArray(opts.projectFiles) ? opts.projectFiles : []

  return {
    assets: summariseAssets(imageAssets),
    theme: summariseTheme(designTokens),
    blueprint: layoutBlueprint,
    family: opts.recipeFamily || null,
    attachments: summariseAttachments(rawAttachments),
    timings,
    integrity: runIntegrityChecks({ imageAssets, projectFiles }),
    warnings: collectWarnings({ imageAssets, rawAttachments, projectFiles }),
  }
}

/**
 * Summarise components/assets.js exports: name, size, per-image note.
 */
function summariseAssets(imageAssets) {
  const exports = []
  let photoIdx = 0, illuIdx = 0
  let logoSeen = false, heroSeen = false

  for (const a of imageAssets) {
    if (!['logo', 'hero', 'photo', 'illustration'].includes(a.role)) continue
    let exportName
    if (a.role === 'logo' && !logoSeen) { exportName = 'LOGO_URL'; logoSeen = true }
    else if (a.role === 'hero' && !heroSeen) { exportName = 'HERO_URL'; heroSeen = true }
    else if (a.role === 'illustration') exportName = `ILLUSTRATION_${illuIdx++}`
    else exportName = `PHOTO_${photoIdx++}`

    exports.push({
      name: exportName,
      role: a.role,
      sourceFile: a.name || '(unknown)',
      note: a.note || '',
      sizeBytes: estimateDataUrlBytes(a.dataUrl),
    })
  }

  return {
    emitted: exports.length > 0,
    exports,
    missing: [
      ...(!logoSeen ? ['LOGO_URL'] : []),
      ...(!heroSeen ? ['HERO_URL'] : []),
    ],
  }
}

function summariseTheme(tokens) {
  if (!tokens) return { emitted: false, tokens: null }
  return {
    emitted: true,
    tokens: {
      mode: tokens.mode,
      vibe: tokens.vibe,
      primary: tokens.primary,
      bg: tokens.bg,
      ink: tokens.ink,
      accent: tokens.accent,
      radius: tokens.radius,
      fontDisplay: tokens.fontDisplay,
      fontBody: tokens.fontBody,
      avoid: tokens.avoid || [],
    },
  }
}

function summariseAttachments(raw) {
  const counts = { brand: 0, aesthetic: 0, structural: 0, untagged: 0 }
  for (const a of raw) {
    const role = a?.role
    if (role === 'brand' || role === 'aesthetic' || role === 'structural') counts[role]++
    else counts.untagged++
  }
  return { total: raw.length, ...counts }
}

/**
 * Run deterministic self-tests on the produced project files.
 */
function runIntegrityChecks({ imageAssets, projectFiles }) {
  const checks = []

  const assetsFile = projectFiles.find((f) => f.path === 'components/assets.js')
  const themeFile = projectFiles.find((f) => f.path === 'components/theme.js')
  const routerFile = projectFiles.find((f) => f.path === 'app/page.jsx')
  const navbarFile = projectFiles.find((f) => f.path === 'components/Navbar.jsx')
  const landingFile = projectFiles.find((f) => f.path === 'pages/Landing.jsx')

  const brandCount = imageAssets.filter((a) =>
    ['logo', 'hero', 'photo', 'illustration'].includes(a.role)
  ).length

  checks.push({
    name: 'components/theme.js emitted',
    pass: !!themeFile,
    detail: themeFile ? 'ok' : 'missing — design tokens pipeline did not run or failed',
  })

  if (brandCount > 0) {
    checks.push({
      name: 'components/assets.js emitted with brand uploads',
      pass: !!(assetsFile && assetsFile.content && assetsFile.content.includes('export const')),
      detail: assetsFile && assetsFile.content ? 'ok' : 'missing — brand assets did not reach assets.js',
    })
  }

  if (imageAssets.some((a) => a.role === 'logo')) {
    checks.push({
      name: 'LOGO_URL exported in assets.js',
      pass: !!(assetsFile && /export const LOGO_URL/.test(assetsFile.content || '')),
      detail: 'must be present for navbar logo to render',
    })
    checks.push({
      name: 'Navbar renders <img src={LOGO_URL}>',
      pass: !!(navbarFile && /src=\{LOGO_URL\}/.test(navbarFile.content || '')),
      detail: 'if LOGO_URL present but unused here, post-repair should have injected it',
    })
  }

  if (imageAssets.some((a) => a.role === 'hero' || a.role === 'photo')) {
    checks.push({
      name: 'Landing renders hero image',
      pass: !!(landingFile && /src=\{(HERO_URL|PHOTO_0)\}/.test(landingFile.content || '')),
      detail: 'if absent, the themed placeholder is rendering instead of user asset',
    })
  }

  if (routerFile) {
    const hasRouterNavbar = /<Navbar\b/.test(routerFile.content || '')
    checks.push({
      name: 'Router does NOT render <Navbar> (no duplicates)',
      pass: !hasRouterNavbar,
      detail: hasRouterNavbar ? 'Navbar at router + page level = duplicate landmarks' : 'ok',
    })
  }

  return checks
}

/**
 * Build a list of high-signal warnings for quick eyeballing.
 */
function collectWarnings({ imageAssets, rawAttachments, projectFiles }) {
  const warnings = []
  const brandCount = imageAssets.filter((a) =>
    ['logo', 'hero', 'photo', 'illustration'].includes(a.role)
  ).length

  if (rawAttachments.length > 0 && brandCount === 0) {
    warnings.push('You uploaded images but none were tagged as Brand — nothing will be rendered in the generated site. Aesthetic/structural images only influence style, they never appear as content.')
  }

  if (imageAssets.some((a) => a.role === 'logo')) {
    const navbar = projectFiles.find((f) => f.path === 'components/Navbar.jsx')
    if (navbar && !/src=\{LOGO_URL\}/.test(navbar.content || '')) {
      warnings.push('LOGO_URL exists but Navbar does not reference it — the navbar will show a placeholder. Post-repair should have caught this.')
    }
  }

  if (imageAssets.some((a) => a.role === 'hero' || a.role === 'photo')) {
    const landing = projectFiles.find((f) => f.path === 'pages/Landing.jsx')
    if (landing && !/src=\{(HERO_URL|PHOTO_0)\}/.test(landing.content || '')) {
      warnings.push('Hero/photo assets exist but Landing does not reference them — the hero shows a themed placeholder instead.')
    }
  }

  return warnings
}

function estimateDataUrlBytes(url) {
  if (!url || typeof url !== 'string') return 0
  const match = url.match(/base64,(.*)$/)
  if (!match) return url.length
  const b64 = match[1]
  return Math.floor(b64.length * 0.75)
}
