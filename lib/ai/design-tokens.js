// ══════════════════════════════════════════════════════════════════════
// ── DESIGN TOKENS ──
// Takes user-uploaded reference images and extracts CONCRETE design
// tokens (hex palette, font families, radius, style mood) the builder
// can ground every recipe against.
//
// Why this exists: prior `analyzeArtDirection()` returned prose like
// "warm palette, clean sans-serif". That's too fuzzy for an LLM to
// translate into reliable Tailwind classes — it defaults to "AI-slop"
// violet/cyan every time. Structured JSON tokens + a deterministic
// `components/theme.js` file let us set CSS variables the recipes
// reference via arbitrary-value Tailwind classes (`bg-[var(--primary)]`).
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} DesignTokens
 * @property {string} bg                  - page background (hex or css color)
 * @property {string} surface             - card/panel surface
 * @property {string} surface2            - elevated surface (navbar, modals)
 * @property {string} border              - border color (usually low-opacity variant)
 * @property {string} ink                 - primary text color
 * @property {string} inkMuted            - secondary text color
 * @property {string} primary             - brand CTA color
 * @property {string} primaryInk          - text on primary surface
 * @property {string} accent              - supporting accent color
 * @property {string} radius              - border-radius base (e.g. "0.75rem")
 * @property {string} radiusLg            - larger border-radius (cards, hero)
 * @property {string} fontDisplay         - display/heading font family string
 * @property {string} fontBody            - body font family string
 * @property {string} mode                - "light" | "dark"
 * @property {string} vibe                - 1-word mood for the builder ("editorial-minimal" | "playful-pastel" | "brutalist" | ...)
 * @property {string[]} avoid             - explicit "do NOT" guidance for the builder
 */

/**
 * Safe fallback. Matches the current default aesthetic so nothing breaks
 * when no images are uploaded and no palette is stated in the brief.
 */
export const FALLBACK_TOKENS = Object.freeze({
  bg: '#0a0a0a',
  surface: 'rgba(255,255,255,0.04)',
  surface2: 'rgba(10,10,10,0.6)',
  border: 'rgba(255,255,255,0.1)',
  ink: '#ffffff',
  inkMuted: 'rgba(255,255,255,0.65)',
  primary: '#ffffff',
  primaryInk: '#0a0a0a',
  accent: '#8b5cf6',
  radius: '0.75rem',
  radiusLg: '1.25rem',
  fontDisplay: '"Inter", system-ui, sans-serif',
  fontBody: '"Inter", system-ui, sans-serif',
  mode: 'dark',
  vibe: 'modern-dark',
  avoid: [],
})

/**
 * Normalize raw/base64 image data into a data: URL Vision APIs accept.
 */
function toDataUrl(data, name = '') {
  if (!data) return null
  if (data.startsWith('data:')) return data
  const ext = (name.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/png'
  return `data:${mime};base64,${data}`
}

const TOKEN_SYSTEM_PROMPT = `You are an art director. You'll receive 1-4 reference images the user wants the generated app to visually match. Produce CONCRETE design tokens as STRICT JSON.

Return ONLY a JSON object matching exactly this schema (no prose, no markdown fences):

{
  "bg": "<hex or rgba css color — page background>",
  "surface": "<hex or rgba — card/panel background>",
  "surface2": "<hex or rgba — elevated surface: navbar/modal>",
  "border": "<hex or rgba — borders (usually low-opacity variant of ink)>",
  "ink": "<hex — primary text>",
  "inkMuted": "<hex or rgba — secondary text (60-70% opacity of ink)>",
  "primary": "<hex — brand CTA color derived from the image>",
  "primaryInk": "<hex — readable text on the primary color>",
  "accent": "<hex — supporting accent color>",
  "radius": "<css value — base border-radius, e.g. '0.25rem' for sharp, '0.75rem' for friendly, '9999px' for pill>",
  "radiusLg": "<css value — larger border radius for cards/hero>",
  "fontDisplay": "<CSS font-family string for headings — e.g. '\\\"Playfair Display\\\", Georgia, serif'>",
  "fontBody": "<CSS font-family string for body — e.g. '\\\"Inter\\\", system-ui, sans-serif'>",
  "mode": "<'light' or 'dark' — overall scheme>",
  "vibe": "<short kebab-case mood: 'editorial-minimal', 'playful-pastel', 'brutalist', 'warm-organic', 'tech-neon', 'luxury-serif', 'scandi-clean', etc>",
  "avoid": ["<short negative rules: 'no purple gradients', 'no glass-morphism', 'no rounded cards'>"]
}

Rules:
- Pick colors that are VISUALLY PRESENT in the references. Do NOT default to purple/indigo/cyan unless those colors appear.
- If the references look light-mode, set mode="light" with a pale bg and dark ink. If dark-mode, dark bg and light ink.
- fontDisplay + fontBody should reflect what you see (serif vs sans, geometric vs humanist).
- radius should reflect what you see (sharp corners → 0.25rem, pill buttons → 9999px).
- "avoid" should call out any anti-patterns the reference is NOT (e.g. if the reference is editorial-serif, avoid="no rounded-2xl, no glass blur").
- Respond with ONLY the JSON. No prose before or after.`

/**
 * Extract design tokens from reference images via GPT-4o Vision.
 * Returns a DesignTokens object or null if the call fails / images are missing.
 *
 * @param {Array<{name?: string, type: string, data: string}>} attachments
 * @param {{chat: Function}} provider OpenAI-compatible
 * @returns {Promise<DesignTokens|null>}
 */
export async function analyzeDesignTokens(attachments, provider) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null
  const images = attachments
    .filter((a) => a?.type === 'image' && a?.data)
    .slice(0, 4)
  if (images.length === 0) return null

  const userContent = [
    { type: 'text', text: `Extract design tokens from ${images.length} reference image${images.length > 1 ? 's' : ''}. Respond with ONLY the JSON object.` },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: toDataUrl(img.data, img.name), detail: 'low' },
    })),
  ]

  let raw
  try {
    raw = await provider.chat(
      [
        { role: 'system', content: TOKEN_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.2, max_tokens: 600, response_format: { type: 'json_object' } }
    )
  } catch (err) {
    console.warn('[DesignTokens] Vision call failed:', err?.message || err)
    return null
  }

  return parseTokens(raw)
}

/**
 * Parse a JSON string the Vision call returned into a validated DesignTokens.
 * Merges with FALLBACK_TOKENS for any missing keys.
 * Exposed for testing.
 */
export function parseTokens(raw) {
  if (!raw) return null
  let parsed
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  const keys = Object.keys(FALLBACK_TOKENS)
  const out = { ...FALLBACK_TOKENS }
  let coverage = 0
  for (const k of keys) {
    if (k === 'avoid') {
      if (Array.isArray(parsed.avoid)) {
        out.avoid = parsed.avoid.filter((x) => typeof x === 'string' && x.trim()).slice(0, 6)
        if (out.avoid.length > 0) coverage++
      }
      continue
    }
    const v = parsed[k]
    if (typeof v === 'string' && v.trim()) {
      out[k] = v.trim()
      coverage++
    }
  }
  // Require at least core palette keys (bg, ink, primary) to count as a real extraction
  const essential = ['bg', 'ink', 'primary'].every((k) => parsed[k] && typeof parsed[k] === 'string')
  if (!essential) return null
  // Force mode to one of light/dark
  if (out.mode !== 'light' && out.mode !== 'dark') out.mode = 'dark'
  return out
}

/**
 * Allowlist of font names we know are hosted on Google Fonts. When the
 * Vision call picks a font from here, `buildGoogleFontsHref` emits a
 * valid stylesheet URL. Fonts outside this list (or the native system
 * stack) are silently skipped — better to fall back to system than 404.
 *
 * Kept lean — these are the 20 high-frequency editorial/SaaS/luxury
 * families the design-tokens vision call tends to pick.
 */
export const GOOGLE_FONTS_ALLOWLIST = Object.freeze([
  'Inter', 'Manrope', 'Poppins', 'DM Sans', 'Space Grotesk',
  'Playfair Display', 'Cormorant Garamond', 'Fraunces', 'Lora', 'EB Garamond',
  'Roboto', 'Roboto Mono', 'Montserrat', 'Work Sans', 'IBM Plex Sans', 'IBM Plex Mono',
  'JetBrains Mono', 'Space Mono', 'Archivo', 'Syne',
  'Bebas Neue', 'Oswald',
])

/**
 * Extract the primary font family name from a CSS font-family string.
 * `'"Playfair Display", Georgia, serif'` → `'Playfair Display'`.
 * System / generic stacks (`sans-serif`, `system-ui`) return null so
 * the caller skips fetching from Google.
 *
 * @param {string} fontFamilyString
 * @returns {string|null}
 */
export function primaryFontName(fontFamilyString) {
  if (typeof fontFamilyString !== 'string') return null
  const first = fontFamilyString.split(',')[0] || ''
  const stripped = first.trim().replace(/^['"]|['"]$/g, '').trim()
  if (!stripped) return null
  const lower = stripped.toLowerCase()
  if (['sans-serif', 'serif', 'monospace', 'system-ui', '-apple-system', 'cursive', 'fantasy'].includes(lower)) return null
  return stripped
}

/**
 * Build a Google Fonts v2 stylesheet URL for the display+body fonts
 * in the tokens. Returns empty string when both fonts are system / not
 * on the allowlist.
 *
 * Uses `display=swap` so the page renders in the fallback serif/sans
 * immediately, then swaps to the branded font once loaded — zero FOUT
 * on slow connections, no blocking on the CDN.
 *
 * @param {{fontDisplay?: string, fontBody?: string}} tokens
 * @returns {string}
 */
export function buildGoogleFontsHref(tokens) {
  if (!tokens) return ''
  const picks = new Set()
  for (const key of ['fontDisplay', 'fontBody']) {
    const name = primaryFontName(tokens[key])
    if (name && GOOGLE_FONTS_ALLOWLIST.includes(name)) picks.add(name)
  }
  if (picks.size === 0) return ''
  const families = Array.from(picks)
    .map((n) => `family=${encodeURIComponent(n)}:wght@400;500;600;700;800`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${families}&display=swap`
}

/**
 * Render the auto-generated `components/theme.js` file content.
 * Exports DESIGN_TOKENS, cssVars (keyed by --var), and <ThemeProvider>
 * that the scaffold wraps the app in. Also sets font-family on the root
 * so headings/body inherit correctly.
 *
 * Deterministic (no LLM) — guarantees tokens reach the browser.
 *
 * @param {DesignTokens} tokens
 * @returns {string}
 */
export function buildThemeFile(tokens) {
  const t = { ...FALLBACK_TOKENS, ...(tokens || {}) }
  const esc = (s) => String(s).replace(/`/g, '\\`').replace(/\$/g, '\\$')
  const fontsHref = buildGoogleFontsHref(t)

  return `// AUTO-GENERATED by Emanator from user reference images + brand brief.
// Deterministic — regenerated on every build. DO NOT hand-edit.
//
// Every recipe that renders brand-styled UI reads from these tokens via
// Tailwind arbitrary-value syntax, e.g. \`bg-[var(--primary)]\`,
// \`text-[var(--ink)]\`, \`rounded-[var(--radius)]\`. The tokens cascade
// from <ThemeProvider> which sets them as CSS custom properties on its
// root div.

export const DESIGN_TOKENS = {
  bg: \`${esc(t.bg)}\`,
  surface: \`${esc(t.surface)}\`,
  surface2: \`${esc(t.surface2)}\`,
  border: \`${esc(t.border)}\`,
  ink: \`${esc(t.ink)}\`,
  inkMuted: \`${esc(t.inkMuted)}\`,
  primary: \`${esc(t.primary)}\`,
  primaryInk: \`${esc(t.primaryInk)}\`,
  accent: \`${esc(t.accent)}\`,
  radius: \`${esc(t.radius)}\`,
  radiusLg: \`${esc(t.radiusLg)}\`,
  fontDisplay: \`${esc(t.fontDisplay)}\`,
  fontBody: \`${esc(t.fontBody)}\`,
  mode: \`${esc(t.mode)}\`,
  vibe: \`${esc(t.vibe)}\`,
}

export const GOOGLE_FONTS_HREF = \`${esc(fontsHref)}\`

export const cssVars = {
  '--bg': DESIGN_TOKENS.bg,
  '--surface': DESIGN_TOKENS.surface,
  '--surface-2': DESIGN_TOKENS.surface2,
  '--border': DESIGN_TOKENS.border,
  '--ink': DESIGN_TOKENS.ink,
  '--ink-muted': DESIGN_TOKENS.inkMuted,
  '--primary': DESIGN_TOKENS.primary,
  '--primary-ink': DESIGN_TOKENS.primaryInk,
  '--accent': DESIGN_TOKENS.accent,
  '--radius': DESIGN_TOKENS.radius,
  '--radius-lg': DESIGN_TOKENS.radiusLg,
  '--font-display': DESIGN_TOKENS.fontDisplay,
  '--font-body': DESIGN_TOKENS.fontBody,
}

// Lazy-inject the Google Fonts stylesheet exactly once on first mount.
// Safe in SSR (guarded by typeof document) and idempotent across
// multiple ThemeProvider remounts (keyed by a data-attribute probe).
function ensureGoogleFonts() {
  if (typeof document === 'undefined') return
  if (!GOOGLE_FONTS_HREF) return
  if (document.querySelector('link[data-emanator-fonts="1"]')) return
  var link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = GOOGLE_FONTS_HREF
  link.setAttribute('data-emanator-fonts', '1')
  document.head.appendChild(link)
}

export function ThemeProvider({ children }) {
  if (typeof useEffect !== 'undefined') {
    useEffect(function () { ensureGoogleFonts() }, [])
  } else {
    ensureGoogleFonts()
  }
  return (
    <div
      style={{ ...cssVars, fontFamily: DESIGN_TOKENS.fontBody, background: DESIGN_TOKENS.bg, color: DESIGN_TOKENS.ink, minHeight: '100vh' }}
      data-theme={DESIGN_TOKENS.mode}
      data-vibe={DESIGN_TOKENS.vibe}
    >
      {children}
    </div>
  )
}

export default ThemeProvider
`
}

/**
 * Render a compact "design brief" the builder prompt can inline. We show
 * the token values AND the vibe AND explicit "avoid" rules so the LLM
 * has a reason to drop its violet-gradient prior.
 *
 * @param {DesignTokens} tokens
 * @returns {string}
 */
export function formatTokensForPrompt(tokens) {
  const t = { ...FALLBACK_TOKENS, ...(tokens || {}) }
  const avoidBlock = (t.avoid || []).length > 0
    ? `AVOID (strict): ${t.avoid.join(' · ')}`
    : 'AVOID: generic violet/indigo/cyan gradients unless those colors are actually in the palette above.'
  return `Design tokens extracted from the reference:
  - Mode: ${t.mode}  ·  Vibe: ${t.vibe}
  - Page bg: ${t.bg}  ·  Surface: ${t.surface}  ·  Elevated: ${t.surface2}
  - Ink: ${t.ink}  ·  Ink muted: ${t.inkMuted}  ·  Border: ${t.border}
  - Primary CTA: ${t.primary} (text on it: ${t.primaryInk})  ·  Accent: ${t.accent}
  - Radius base: ${t.radius}  ·  Radius large: ${t.radiusLg}
  - Display font: ${t.fontDisplay}
  - Body font: ${t.fontBody}
${avoidBlock}`
}

// ══════════════════════════════════════════════════════════════════════
// ── LAYOUT BLUEPRINT (from structural / flow screenshots) ──
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} LayoutBlueprint
 * @property {string[]} sections_order      - ordered list of landing sections
 * @property {string}   hero_composition    - 'split-50-50' | 'full-bleed-image' | 'centered-text' | 'stacked-image-below'
 * @property {string}   hero_text_alignment - 'left' | 'center' | 'right'
 * @property {string}   navbar_style        - 'minimal-left-brand' | 'centered-brand' | 'mega-menu' | 'sidebar'
 * @property {number}   feature_columns     - 2 | 3 | 4
 * @property {string}   feature_card_style  - 'hairline-outlined' | 'filled-surface' | 'no-border' | 'shadowed-card'
 * @property {string}   pricing_pattern     - 'three-column' | 'horizontal-strip' | 'single-featured' | 'toggle-annual-monthly'
 * @property {string}   spacing_rhythm      - 'generous' | 'tight' | 'asymmetric'
 * @property {string[]} noticeable_patterns - free-form short observations the builder can mirror
 */

const BLUEPRINT_SYSTEM_PROMPT = `You are a UI layout analyst. You'll receive 1-4 screenshots of real web/app interfaces the user wants the generated app's LAYOUT to mirror (not colors, not typography — just composition and flow).

Return ONLY a JSON object matching exactly this schema (no prose, no markdown):

{
  "sections_order": ["hero", "logo-cloud" | "stats", "features-grid" | "features-left-image", "testimonials" | "reviews", "pricing", "faq", "final-cta"],
  "hero_composition": "split-50-50" | "full-bleed-image" | "centered-text" | "stacked-image-below",
  "hero_text_alignment": "left" | "center" | "right",
  "navbar_style": "minimal-left-brand" | "centered-brand" | "mega-menu" | "sidebar",
  "feature_columns": 2 | 3 | 4,
  "feature_card_style": "hairline-outlined" | "filled-surface" | "no-border" | "shadowed-card",
  "pricing_pattern": "three-column" | "horizontal-strip" | "single-featured" | "toggle-annual-monthly",
  "spacing_rhythm": "generous" | "tight" | "asymmetric",
  "noticeable_patterns": ["3-5 short observations — e.g. 'hero has a floating product screenshot with drop shadow', 'features section uses horizontal 2-column rows alternating left/right image'"]
}

Rules:
- Pick ONLY values from the enumerated choices above for each structured field.
- sections_order should be what you ACTUALLY SEE in the references, in the order they appear.
- noticeable_patterns must be concrete and implementable in React+Tailwind. No vague terms like "modern" or "clean".
- Respond with ONLY the JSON object.`

/**
 * Extract a layout blueprint from structural-reference screenshots.
 * Non-blocking: returns null if the Vision call fails or images are absent.
 *
 * @param {Array<{name?: string, type: string, data: string, note?: string}>} attachments
 * @param {{chat: Function}} provider
 * @returns {Promise<LayoutBlueprint|null>}
 */
export async function analyzeLayoutBlueprint(attachments, provider) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null
  const images = attachments
    .filter((a) => a?.type === 'image' && a?.data)
    .slice(0, 4)
  if (images.length === 0) return null

  const notes = images
    .map((img, i) => (img.note ? `  - image ${i + 1} note: "${img.note}"` : null))
    .filter(Boolean)
    .join('\n')

  const userContent = [
    { type: 'text', text: `Analyze the layout/flow of ${images.length} reference screenshot${images.length > 1 ? 's' : ''}. Respond with ONLY the JSON object.${notes ? '\n\nUser placement notes:\n' + notes : ''}` },
    ...images.map((img) => {
      const filename = (img.name || '').toLowerCase()
      const ext = (filename.split('.').pop() || 'png').toLowerCase()
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'
      const url = img.data.startsWith('data:') ? img.data : `data:${mime};base64,${img.data}`
      return { type: 'image_url', image_url: { url, detail: 'low' } }
    }),
  ]

  let raw
  try {
    raw = await provider.chat(
      [
        { role: 'system', content: BLUEPRINT_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.2, max_tokens: 800, response_format: { type: 'json_object' } }
    )
  } catch (err) {
    console.warn('[LayoutBlueprint] Vision call failed:', err?.message || err)
    return null
  }

  return parseBlueprint(raw)
}

/**
 * Parse/validate a blueprint JSON string. Any invalid values fall back to
 * safe defaults so downstream consumers never receive bad input.
 * Exposed for testing.
 */
export function parseBlueprint(raw) {
  if (!raw) return null
  let p
  try { p = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  if (!p || typeof p !== 'object') return null

  const str = (v, allowed, fallback) =>
    allowed.includes(v) ? v : fallback

  const sections = Array.isArray(p.sections_order)
    ? p.sections_order.filter((s) => typeof s === 'string' && s.trim()).slice(0, 8)
    : []
  if (sections.length === 0) return null

  return {
    sections_order: sections,
    hero_composition: str(p.hero_composition, ['split-50-50', 'full-bleed-image', 'centered-text', 'stacked-image-below'], 'split-50-50'),
    hero_text_alignment: str(p.hero_text_alignment, ['left', 'center', 'right'], 'left'),
    navbar_style: str(p.navbar_style, ['minimal-left-brand', 'centered-brand', 'mega-menu', 'sidebar'], 'minimal-left-brand'),
    feature_columns: [2, 3, 4].includes(p.feature_columns) ? p.feature_columns : 3,
    feature_card_style: str(p.feature_card_style, ['hairline-outlined', 'filled-surface', 'no-border', 'shadowed-card'], 'filled-surface'),
    pricing_pattern: str(p.pricing_pattern, ['three-column', 'horizontal-strip', 'single-featured', 'toggle-annual-monthly'], 'three-column'),
    spacing_rhythm: str(p.spacing_rhythm, ['generous', 'tight', 'asymmetric'], 'generous'),
    noticeable_patterns: Array.isArray(p.noticeable_patterns)
      ? p.noticeable_patterns.filter((s) => typeof s === 'string' && s.trim()).slice(0, 6)
      : [],
  }
}

/**
 * Format a blueprint as a compact block the builder prompt can inline.
 */
export function formatBlueprintForPrompt(bp) {
  if (!bp) return ''
  const patternsBlock = (bp.noticeable_patterns || []).length
    ? '  Patterns to mirror:\n' + bp.noticeable_patterns.map((p) => `    • ${p}`).join('\n')
    : ''
  return `Layout blueprint extracted from the user's structural references — YOUR COMPOSITION MUST MATCH:
  - Section order: ${bp.sections_order.join(' → ')}
  - Hero: ${bp.hero_composition} · text aligned ${bp.hero_text_alignment}
  - Navbar style: ${bp.navbar_style}
  - Features: ${bp.feature_columns}-column grid · ${bp.feature_card_style} cards
  - Pricing: ${bp.pricing_pattern}
  - Spacing rhythm: ${bp.spacing_rhythm}
${patternsBlock}`
}

// ══════════════════════════════════════════════════════════════════════
// ── RECIPE FAMILY CLASSIFIER ──
// ══════════════════════════════════════════════════════════════════════

import { FAMILY_IDS, FAMILY_DESCRIPTIONS } from './recipe-families.js'

const FAMILY_SYSTEM_PROMPT = `You are an aesthetic classifier. You'll receive 1-4 reference images. Pick the single recipe family whose overall composition + typography + mood best matches the references.

Respond with ONLY a JSON object: { "family": "<one of ${FAMILY_IDS.join(' | ')}>", "confidence": 0.0-1.0, "reason": "<one short sentence>" }

Family definitions:
${FAMILY_IDS.map((id) => `- ${id}: ${FAMILY_DESCRIPTIONS[id]}`).join('\n')}

Rules:
- "family" MUST be exactly one of: ${FAMILY_IDS.join(', ')}
- If uncertain, pick saas-clean (the safe baseline).
- Respond with ONLY the JSON object.`

/**
 * Pick a recipe family from user aesthetic references. Returns null on
 * failure (caller uses saas-clean baseline).
 *
 * @param {Array<{type: string, data: string, name?: string}>} attachments
 * @param {{chat: Function}} provider
 * @returns {Promise<{family: string, confidence: number, reason: string}|null>}
 */
export async function classifyRecipeFamily(attachments, provider) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null
  const images = attachments
    .filter((a) => a?.type === 'image' && a?.data)
    .slice(0, 4)
  if (images.length === 0) return null

  const userContent = [
    { type: 'text', text: `Classify these ${images.length} reference image${images.length > 1 ? 's' : ''} into ONE family. Respond with ONLY the JSON object.` },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: {
        url: img.data.startsWith('data:') ? img.data : `data:image/png;base64,${img.data}`,
        detail: 'low',
      },
    })),
  ]

  let raw
  try {
    raw = await provider.chat(
      [
        { role: 'system', content: FAMILY_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.1, max_tokens: 200, response_format: { type: 'json_object' } }
    )
  } catch (err) {
    console.warn('[RecipeFamily] classifier call failed:', err?.message || err)
    return null
  }

  return parseFamily(raw)
}

/**
 * Validate + normalize the classifier's response.
 */
export function parseFamily(raw) {
  if (!raw) return null
  let p
  try { p = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  if (!p || typeof p !== 'object') return null
  if (!FAMILY_IDS.includes(p.family)) return null
  const confidence = typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1
    ? p.confidence : 0.5
  return {
    family: p.family,
    confidence,
    reason: typeof p.reason === 'string' ? p.reason.slice(0, 200) : '',
  }
}
