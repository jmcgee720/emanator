// ══════════════════════════════════════════════════════════════════════
// ── DETERMINISTIC POST-REPAIR ──
// Runs AFTER the LLM review/repair wave as a non-LLM safety net for the
// three regressions that prompt rules have proven unable to prevent:
//   1. Router (app/page.jsx) rendering <Navbar /> or <Footer /> directly,
//      causing duplicate landmarks with the per-page Navbar/Footer.
//   2. User-uploaded logo ignored — Navbar keeps the recipe's gradient
//      placeholder or hardcodes "<Brand> Logo" as plain text instead of
//      rendering <img src={LOGO_URL}>.
//   3. User-uploaded hero ignored on the landing page.
//
// Each fixer is idempotent and conservative — it only patches files it
// can identify with high confidence and leaves everything else untouched.
// Returns a list of the file paths it modified so the caller can surface
// them to the user / attach to SSE.
// ══════════════════════════════════════════════════════════════════════

/** @typedef {{path: string, content: string}} ProjectFile */

const LOGO_IMPORT_LINE = "import { LOGO_URL } from './assets'"
const HERO_IMPORT_LINE = "import { HERO_URL } from '../components/assets'"
const NAVBAR_LOGO_IMPORT_LINE = LOGO_IMPORT_LINE // components/Navbar.jsx → ./assets

/**
 * Ensure an ES import for `{ named }` from `source` exists near the top.
 * No-op if already present (any local-path variant accepted).
 */
function ensureNamedImport(content, namedSymbol, sourceHint) {
  if (typeof content !== 'string') return content
  const has = new RegExp(`import\\s*\\{[^}]*\\b${namedSymbol}\\b[^}]*\\}\\s*from\\s*['"][^'"]*assets['"]`).test(content)
  if (has) return content
  const lines = content.split('\n')
  // Insert after last existing import, else at the top
  let insertAt = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+/.test(lines[i])) insertAt = i + 1
    else if (insertAt > 0) break
  }
  const line = `import { ${namedSymbol} } from '${sourceHint}'`
  lines.splice(insertAt, 0, line)
  return lines.join('\n')
}

// ─── Fix 1: Strip <Navbar /> / <Footer /> from app/page.jsx ──────────
/**
 * Deterministically remove router-level `<Navbar />` and `<Footer />`
 * renders + their imports from `app/page.jsx`. Pages are responsible for
 * their own Navbar/Footer (per HARD RULE #15) — rendering them at the
 * router causes stacked duplicates.
 */
export function stripRouterLandmarks(content) {
  if (typeof content !== 'string') return { content, changed: false }
  const original = content
  let out = content

  // Remove `<Navbar ... />` and `<Footer ... />` self-closing tags, AND
  // block-form `<Navbar ...>...</Navbar>`. Works whether the tag is on
  // its own line or inline — all we need is the tag to disappear.
  out = out.replace(/<Navbar\b[^>]*\/>/g, '')
  out = out.replace(/<Footer\b[^>]*\/>/g, '')
  out = out.replace(/<Navbar\b[^>]*>[\s\S]*?<\/Navbar>/g, '')
  out = out.replace(/<Footer\b[^>]*>[\s\S]*?<\/Footer>/g, '')

  // Remove their imports (they're unused now in this file)
  out = out.replace(/^\s*import\s+Navbar\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
  out = out.replace(/^\s*import\s+Footer\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')

  // Collapse runs of 3+ blank lines back to two
  out = out.replace(/\n{3,}/g, '\n\n')

  return { content: out, changed: out !== original }
}

// ─── Fix 2: Inject LOGO_URL <img> in Navbar.jsx ──────────────────────
/**
 * Ensure components/Navbar.jsx renders `<img src={LOGO_URL}>` in place of
 * the recipe's gradient-square placeholder OR any plain-text "<Brand>
 * Logo" placeholder that the LLM might have emitted. Also ensures the
 * import is present.
 *
 * Strategy:
 *  1. If the file already has `src={LOGO_URL}` somewhere → no-op.
 *  2. Add the import.
 *  3. Try in order:
 *     a. Replace the recipe's gradient <span> placeholder
 *     b. Replace a plain-text "…Logo" node inside the nav
 *     c. Prepend the logo <img> at the start of the brand button contents
 */
export function ensureNavbarLogo(content) {
  if (typeof content !== 'string') return { content, changed: false }
  if (/src=\{LOGO_URL\}/.test(content)) return { content, changed: false }

  const original = content
  let out = ensureNamedImport(content, 'LOGO_URL', './assets')

  const imgTag = '<img src={LOGO_URL} alt="Logo" className="h-8 w-auto" />'

  // (a) Replace the recipe's default gradient placeholder span.
  //     `<span className="w-8 h-8 rounded-xl bg-gradient-to-br ... />`
  const gradientSpan = /<span[^>]*\bw-8 h-8[^"]*rounded-xl[^"]*bg-gradient[^"]*"[^/>]*\/>/
  if (gradientSpan.test(out)) {
    out = out.replace(gradientSpan, imgTag)
    return { content: out, changed: out !== original }
  }

  // (b) Replace a plain-text "Logo" node — e.g. `>Nexsara Logo<`, `>Logo<`
  //     This kills the "Nexsara Logo" text-placeholder we saw in production.
  const textLogo = />\s*([A-Z][a-zA-Z0-9 ]{0,32}?)?\s*Logo\s*</
  if (textLogo.test(out)) {
    out = out.replace(textLogo, `>${imgTag}<`)
    return { content: out, changed: out !== original }
  }

  // (c) Last resort — prepend the img to the first `<button` that looks
  //     like a brand/home navigation (has data-testid="navbar-brand" or
  //     aria-label containing home).
  const brandBtn = /(<button[^>]*(?:data-testid=["']navbar-brand["']|aria-label=["'][^"']*home[^"']*["'])[^>]*>)/i
  const m = brandBtn.exec(out)
  if (m) {
    out = out.slice(0, m.index + m[1].length) + `\n          ${imgTag}` + out.slice(m.index + m[1].length)
    return { content: out, changed: out !== original }
  }

  // Couldn't find a safe injection point — abort (don't corrupt the file)
  return { content: original, changed: false }
}

// ─── Fix 3: Inject HERO_URL <img> in the landing page hero ───────────
/**
 * Ensure pages/Landing.jsx renders an `<img>` for the hero slot. Prefers
 * `HERO_URL` when the user tagged a hero asset; falls back to `PHOTO_0`
 * when only photo-role assets were uploaded. Conservative: only adds when
 * there is no existing hero img at all, and only when the file has a
 * recognisable hero container.
 *
 * @param {string} content
 * @param {Array<{role: string}>} [imageAssets] - used to pick HERO_URL vs PHOTO_0
 */
export function ensureHeroImage(content, imageAssets) {
  if (typeof content !== 'string') return { content, changed: false }
  if (/src=\{HERO_URL\}|src=\{PHOTO_0\}/.test(content)) return { content, changed: false }

  const assets = Array.isArray(imageAssets) ? imageAssets : []
  const heroExport = assets.some((a) => a && a.role === 'hero') ? 'HERO_URL' : 'PHOTO_0'

  const original = content
  let out = ensureNamedImport(content, heroExport, '../components/assets')

  const imgTag = `<img src={${heroExport}} alt="" className="w-full rounded-2xl shadow-2xl" />`

  // Find a hero container — typically a <section> with `hero` in the
  // className, or the first <section> / <main> if nothing else matches.
  const heroSectionOpen = /<section[^>]*\bhero\b[^>]*>/i
  let m = heroSectionOpen.exec(out)
  if (!m) m = /<section\b[^>]*>/.exec(out)
  if (!m) m = /<main\b[^>]*>/.exec(out)
  if (!m) return { content: original, changed: false }

  const insertPos = m.index + m[0].length
  out = out.slice(0, insertPos) + `\n      ${imgTag}` + out.slice(insertPos)
  return { content: out, changed: out !== original }
}

// ─── Top-level orchestrator ──────────────────────────────────────────
/**
 * Apply all applicable post-repair fixes to a file list. Only files that
 * actually change are returned — unchanged files are omitted so the
 * caller can feed the result straight into `saveFiles` (an update pass).
 *
 * @param {ProjectFile[]} files - full project file list with content
 * @param {{imageAssets?: Array<{role: string}>}} [opts]
 * @returns {{updates: ProjectFile[], modifiedPaths: string[]}}
 */
export function runPostRepair(files, opts = {}) {
  const imageAssets = Array.isArray(opts.imageAssets) ? opts.imageAssets : []
  const hasLogo = imageAssets.some((a) => a && a.role === 'logo')
  // Hero image comes from explicit hero-role OR the first photo asset
  // (fallback — if the user uploaded brand imagery but none was tagged
  // as "hero", we still want the hero slot filled deterministically).
  const hasHero = imageAssets.some((a) => a && (a.role === 'hero' || a.role === 'photo'))
  const updates = []

  if (!Array.isArray(files)) return { updates, modifiedPaths: [] }

  for (const file of files) {
    if (!file || typeof file.content !== 'string') continue
    let next = file.content
    let touched = false

    if (file.path === 'app/page.jsx') {
      const r = stripRouterLandmarks(next)
      if (r.changed) { next = r.content; touched = true }
    }

    if (hasLogo && (file.path === 'components/Navbar.jsx' || /Navbar\.jsx$/i.test(file.path))) {
      const r = ensureNavbarLogo(next)
      if (r.changed) { next = r.content; touched = true }
    }

    if (hasHero && /^pages\/Landing\.jsx$/i.test(file.path)) {
      const r = ensureHeroImage(next, imageAssets)
      if (r.changed) { next = r.content; touched = true }
    }

    if (touched) updates.push({ path: file.path, content: next })
  }

  return { updates, modifiedPaths: updates.map((u) => u.path) }
}
