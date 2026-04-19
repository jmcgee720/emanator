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

export function ThemeProvider({ children }) {
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
