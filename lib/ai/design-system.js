/**
 * Design Intelligence System for MyMergent
 *
 * Parts 1-4: Design presets, tokens, layout patterns, component patterns
 * Part 5: AI prompt context formatting
 * Part 7: Design memory / preferences
 * Part 8: Smart defaults
 */

// ─── Part 1: Design Style Presets ────────────────────────────────────

export const DESIGN_PRESETS = {
  modern_saas: {
    id: 'modern_saas',
    name: 'Modern SaaS',
    description: 'Clean, professional SaaS product aesthetic',
    typography: { headline: 'Inter or system sans-serif, bold 700-800, tight tracking', body: 'Regular 400, 16-18px base, 1.6 line-height', accent: 'Medium 500 for labels/nav' },
    spacing: { scale: 'generous', sectionPadding: '80-120px vertical, 24-32px horizontal', componentGap: '24-32px', density: 'balanced' },
    radius: { style: 'large-rounded', values: 'buttons: 12px, cards: 16px, inputs: 10px, modals: 20px' },
    shadows: { style: 'soft-layered', values: 'cards: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06); hover: elevate shadow spread' },
    buttons: { style: 'solid primary with rounded-xl, ghost secondary, pill CTAs', padding: 'px-6 py-3 for primary, px-4 py-2 for secondary' },
    cards: { style: 'white/dark bg, subtle border, rounded-2xl, hover shadow lift', padding: '24-32px internal' },
    layout: { density: 'balanced', maxWidth: '1280px centered', grid: '12-col with 4-col feature cards' },
    background: { treatment: 'subtle gradient mesh or solid white/dark, avoid busy patterns', hero: 'gradient from primary-50 to white or radial spotlight' },
    colors: { philosophy: 'strong brand primary, neutral grays, green for success, red for error', contrast: 'high — dark text on light, or light text on dark sections' },
    interaction: { style: 'smooth 200-300ms transitions, hover scale(1.02) on cards, focus rings, skeleton loading' },
  },

  minimal_editorial: {
    id: 'minimal_editorial',
    name: 'Minimal Editorial',
    description: 'Typography-driven, elegant, content-focused',
    typography: { headline: 'Serif or elegant sans (Playfair, Georgia, DM Serif), large sizes 48-72px', body: 'Sans-serif 16-18px, generous line-height 1.7-1.8', accent: 'Small caps or letter-spaced uppercase for labels' },
    spacing: { scale: 'very-generous', sectionPadding: '100-160px vertical', componentGap: '32-48px', density: 'spacious' },
    radius: { style: 'minimal', values: 'buttons: 0-4px, cards: 0-2px, sharp edges preferred' },
    shadows: { style: 'none-or-minimal', values: 'avoid shadows, use borders or whitespace for separation' },
    buttons: { style: 'outlined or text-only, underline on hover, minimal fills', padding: 'px-8 py-3 with border' },
    cards: { style: 'borderless or single thin border, generous padding', padding: '40-56px internal' },
    layout: { density: 'spacious', maxWidth: '720px for text, 1100px for grids', grid: 'asymmetric, editorial columns' },
    background: { treatment: 'solid white or off-white (#fafaf8), minimal decoration', hero: 'large typography with no image or single editorial photo' },
    colors: { philosophy: 'monochrome with one accent color, black/white dominant', contrast: 'extreme — near-black text on off-white' },
    interaction: { style: 'subtle — text underlines, opacity shifts, minimal motion' },
  },

  premium_dark: {
    id: 'premium_dark',
    name: 'Premium Dark',
    description: 'Sophisticated dark-mode design with depth',
    typography: { headline: 'Sans-serif bold, white or near-white text, 40-60px', body: 'Light gray (#a0a0a0-#c0c0c0) on dark, 16px, 1.6 line-height', accent: 'Muted light text for secondary info' },
    spacing: { scale: 'generous', sectionPadding: '80-120px vertical', componentGap: '24-32px', density: 'balanced' },
    radius: { style: 'medium-rounded', values: 'buttons: 8-10px, cards: 12-16px, inputs: 8px' },
    shadows: { style: 'glow-and-depth', values: 'cards: 0 0 0 1px rgba(255,255,255,.06), inset highlights; accent glow on hover' },
    buttons: { style: 'gradient fill or glass-morphism, bright text on dark', padding: 'px-6 py-3' },
    cards: { style: 'dark surface (#18181b or #1c1c1e), subtle border rgba(255,255,255,.08), glass effect optional', padding: '24-32px' },
    layout: { density: 'balanced', maxWidth: '1280px', grid: 'standard 3-4 column grids' },
    background: { treatment: 'solid dark (#09090b, #0a0a0a), optional subtle grid or grain texture', hero: 'dark with accent gradient glow or spotlight effect' },
    colors: { philosophy: 'dark base, single vibrant accent (electric blue, purple, cyan, emerald), muted secondaries', contrast: 'high — bright accent pops against dark' },
    interaction: { style: 'smooth glows, border-color transitions, backdrop-blur glass panels' },
  },

  playful_startup: {
    id: 'playful_startup',
    name: 'Playful Startup',
    description: 'Fun, energetic, approachable startup aesthetic',
    typography: { headline: 'Rounded sans-serif (Nunito, Poppins), bold, friendly sizes', body: 'Regular 16px, warm and readable', accent: 'Colorful labels, emoji-friendly' },
    spacing: { scale: 'generous', sectionPadding: '64-96px vertical', componentGap: '20-28px', density: 'balanced' },
    radius: { style: 'fully-rounded', values: 'buttons: 999px (pill), cards: 20-24px, inputs: 12px' },
    shadows: { style: 'colorful-soft', values: 'colored shadows matching element hue, soft 12-20px blur' },
    buttons: { style: 'pill-shaped, gradient fills, bouncy hover transforms', padding: 'px-8 py-3 rounded-full' },
    cards: { style: 'colored backgrounds or white with colored accents, large radius', padding: '24-32px' },
    layout: { density: 'comfortable', maxWidth: '1200px', grid: 'flexible, card-based, staggered optional' },
    background: { treatment: 'light with colorful blobs/gradients, playful shapes', hero: 'illustration + bold text, colorful gradient background' },
    colors: { philosophy: 'multi-color palette (3-4 vibrant colors), light backgrounds, warm tones', contrast: 'medium-high, approachable' },
    interaction: { style: 'bouncy (spring easing), scale transforms, playful micro-animations' },
  },

  futuristic_tech: {
    id: 'futuristic_tech',
    name: 'Futuristic Tech',
    description: 'Cutting-edge, cyberpunk-influenced tech aesthetic',
    typography: { headline: 'Mono or geometric sans (JetBrains Mono, Space Grotesk), sharp', body: 'Clean sans 14-16px, technical feel', accent: 'Monospace for data, labels, metrics' },
    spacing: { scale: 'compact-to-balanced', sectionPadding: '64-100px vertical', componentGap: '16-24px', density: 'compact' },
    radius: { style: 'sharp-or-minimal', values: 'buttons: 2-4px, cards: 4-8px, angular cuts optional' },
    shadows: { style: 'neon-glow', values: 'accent-colored box-shadows, 0 0 20px rgba(accent,.3)' },
    buttons: { style: 'sharp edges, border-accent, glow on hover, uppercase text', padding: 'px-6 py-2.5' },
    cards: { style: 'dark with accent borders, grid pattern backgrounds optional', padding: '20-28px' },
    layout: { density: 'compact', maxWidth: '1400px', grid: 'dense grid, data-heavy layouts' },
    background: { treatment: 'near-black with grid lines, circuit patterns, or dot matrix', hero: 'dark with animated grid or particle background' },
    colors: { philosophy: 'dark base, neon accents (cyan #00f0ff, magenta #ff00aa, lime #00ff88)', contrast: 'extreme — neon on dark' },
    interaction: { style: 'glitch effects, fast transitions, typing animations, scan-line overlays' },
  },

  luxury_brand: {
    id: 'luxury_brand',
    name: 'Luxury Brand',
    description: 'High-end, refined, aspirational brand aesthetic',
    typography: { headline: 'Elegant serif (Cormorant, Didot, Playfair), thin/light weights, large', body: 'Refined sans 15-16px, generous tracking', accent: 'All-caps spaced tracking for labels' },
    spacing: { scale: 'very-generous', sectionPadding: '120-180px vertical', componentGap: '40-64px', density: 'spacious' },
    radius: { style: 'none', values: 'buttons: 0, cards: 0, everything sharp and precise' },
    shadows: { style: 'none', values: 'use whitespace and borders only' },
    buttons: { style: 'outlined thin borders, uppercase spaced text, minimal fill', padding: 'px-12 py-4 tracking-widest uppercase' },
    cards: { style: 'borderless, image-heavy, generous whitespace', padding: '48-64px' },
    layout: { density: 'spacious', maxWidth: '1200px', grid: 'asymmetric, editorial, full-bleed images' },
    background: { treatment: 'white, cream, or deep black; no patterns', hero: 'full-bleed photography or solid color with centered text' },
    colors: { philosophy: 'monochrome (black/white/cream) with gold or single muted accent', contrast: 'refined — not harsh, slightly muted blacks (#1a1a1a)' },
    interaction: { style: 'slow elegant transitions (400-600ms), parallax scrolling, fade-reveals' },
  },

  mobile_app_clean: {
    id: 'mobile_app_clean',
    name: 'Mobile App Clean',
    description: 'Native mobile app feel, iOS/Android design language',
    typography: { headline: 'System sans (SF Pro, Roboto), semibold, 24-34px', body: 'Regular 16px, clear hierarchy', accent: 'Small 12-13px for metadata' },
    spacing: { scale: 'compact', sectionPadding: '16-24px', componentGap: '12-16px', density: 'compact' },
    radius: { style: 'ios-rounded', values: 'buttons: 12px, cards: 16px, inputs: 12px, sheets: 16px top' },
    shadows: { style: 'platform-native', values: 'subtle elevation shadows, 0 2px 8px rgba(0,0,0,.1)' },
    buttons: { style: 'full-width primary, rounded, system colors', padding: 'py-3.5 rounded-xl w-full' },
    cards: { style: 'grouped table style (iOS) or elevated cards (Material)', padding: '16px' },
    layout: { density: 'compact', maxWidth: '428px mobile frame', grid: 'single column, bottom nav, tab bars' },
    background: { treatment: 'system background (#f2f2f7 light, #000 dark)', hero: 'top navigation bar + content below' },
    colors: { philosophy: 'system blue primary, semantic colors (red/green/orange), gray hierarchy', contrast: 'platform standard' },
    interaction: { style: 'native feel — spring animations, haptic feedback hints, pull-to-refresh patterns' },
  },

  game_ui_arcade: {
    id: 'game_ui_arcade',
    name: 'Game UI / Arcade',
    description: 'Bold, high-energy game interface aesthetic',
    typography: { headline: 'Display/pixel font (Press Start 2P, Orbitron), bold, impactful', body: 'Clean sans 14-16px for readability', accent: 'Score/stat numbers in mono or display font' },
    spacing: { scale: 'compact', sectionPadding: '32-48px', componentGap: '12-20px', density: 'dense' },
    radius: { style: 'mixed', values: 'buttons: 8px or clipped corners, cards: 8-12px, badges: pill' },
    shadows: { style: 'dramatic', values: 'drop shadows, colored glows, emboss effects' },
    buttons: { style: 'chunky, 3D-press effect, bright colors, bold text', padding: 'px-8 py-3 font-bold uppercase' },
    cards: { style: 'dark panels with colored borders, possibly textured', padding: '16-24px' },
    layout: { density: 'dense', maxWidth: '1200px', grid: 'HUD-style layouts, score panels, inventory grids' },
    background: { treatment: 'dark with textures, starfields, or gradient meshes', hero: 'character art or game scene with overlay text' },
    colors: { philosophy: 'high-saturation primaries (red, blue, yellow, green), dark backgrounds', contrast: 'maximum — neon on dark' },
    interaction: { style: 'snappy, bounce, shake on error, particles, progress bars with animation' },
  },

  dashboard_data: {
    id: 'dashboard_data',
    name: 'Dashboard / Data Product',
    description: 'Information-dense, professional data dashboard',
    typography: { headline: 'Sans semibold 20-28px, compact headers', body: 'Regular 13-14px for data density', accent: 'Mono for numbers/metrics, small labels 11-12px' },
    spacing: { scale: 'compact', sectionPadding: '16-24px', componentGap: '12-16px', density: 'dense' },
    radius: { style: 'small-consistent', values: 'buttons: 6px, cards: 8px, inputs: 6px, badges: 4px' },
    shadows: { style: 'subtle-flat', values: 'minimal shadows, use borders for card separation' },
    buttons: { style: 'compact, clear hierarchy (primary/secondary/ghost)', padding: 'px-3 py-1.5 text-sm' },
    cards: { style: 'metric cards, chart containers, bordered panels', padding: '16-20px' },
    layout: { density: 'dense', maxWidth: 'full-width with sidebar', grid: 'sidebar + main, multi-row metric grids, responsive columns' },
    background: { treatment: 'white or very light gray (#f8fafc), dark mode: #0f172a', hero: 'N/A — jump straight to content/metrics' },
    colors: { philosophy: 'neutral base, semantic data colors (blue for info, green up, red down), chart palette', contrast: 'clear data hierarchy' },
    interaction: { style: 'fast, tooltips on hover, expandable rows, filter transitions' },
  },
}

// ─── Concrete Color Palettes & Font Pairings per Preset ──────────────

export const PRESET_PALETTES = {
  modern_saas: {
    colors: { primary: '#6366f1', secondary: '#818cf8', accent: '#22d3ee', bg: '#ffffff', surface: '#f8fafc', text: '#0f172a', textMuted: '#64748b', border: '#e2e8f0' },
    darkColors: { primary: '#818cf8', secondary: '#6366f1', accent: '#22d3ee', bg: '#0f172a', surface: '#1e293b', text: '#f1f5f9', textMuted: '#94a3b8', border: '#334155' },
    fonts: { heading: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", googleImport: 'Inter:wght@400;500;600;700;800' },
  },
  minimal_editorial: {
    colors: { primary: '#1a1a1a', secondary: '#555555', accent: '#c8553d', bg: '#fafaf8', surface: '#ffffff', text: '#1a1a1a', textMuted: '#777777', border: '#e8e5e0' },
    darkColors: null,
    fonts: { heading: "'Playfair Display', Georgia, serif", body: "'Source Sans 3', sans-serif", googleImport: 'Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@300;400;600' },
  },
  premium_dark: {
    colors: { primary: '#a78bfa', secondary: '#7c3aed', accent: '#06b6d4', bg: '#09090b', surface: '#18181b', text: '#fafafa', textMuted: '#a1a1aa', border: 'rgba(255,255,255,0.08)' },
    darkColors: null,
    fonts: { heading: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif", googleImport: 'Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500' },
  },
  playful_startup: {
    colors: { primary: '#f97316', secondary: '#fb923c', accent: '#8b5cf6', bg: '#fffbf5', surface: '#ffffff', text: '#1c1917', textMuted: '#78716c', border: '#fed7aa' },
    darkColors: null,
    fonts: { heading: "'Nunito', sans-serif", body: "'Nunito', sans-serif", googleImport: 'Nunito:wght@400;600;700;800' },
  },
  futuristic_tech: {
    colors: { primary: '#00f0ff', secondary: '#ff00aa', accent: '#00ff88', bg: '#050510', surface: '#0a0a1a', text: '#e0e0ff', textMuted: '#6060a0', border: 'rgba(0,240,255,0.12)' },
    darkColors: null,
    fonts: { heading: "'Space Grotesk', monospace", body: "'JetBrains Mono', monospace", googleImport: 'Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@300;400;500' },
  },
  luxury_brand: {
    colors: { primary: '#1a1a1a', secondary: '#8b7355', accent: '#c9a96e', bg: '#ffffff', surface: '#faf9f7', text: '#1a1a1a', textMuted: '#8c8c8c', border: '#e5e0d8' },
    darkColors: { primary: '#c9a96e', secondary: '#8b7355', accent: '#e4d5b7', bg: '#0a0a0a', surface: '#141414', text: '#f5f5f0', textMuted: '#8c8c8c', border: 'rgba(201,169,110,0.15)' },
    fonts: { heading: "'Cormorant Garamond', serif", body: "'Lato', sans-serif", googleImport: 'Cormorant+Garamond:wght@300;400;600;700&family=Lato:wght@300;400;700' },
  },
  mobile_app_clean: {
    colors: { primary: '#007AFF', secondary: '#5856d6', accent: '#34c759', bg: '#f2f2f7', surface: '#ffffff', text: '#1c1c1e', textMuted: '#8e8e93', border: '#c6c6c8' },
    darkColors: { primary: '#0a84ff', secondary: '#5e5ce6', accent: '#30d158', bg: '#000000', surface: '#1c1c1e', text: '#ffffff', textMuted: '#8e8e93', border: '#38383a' },
    fonts: { heading: "system-ui, -apple-system, sans-serif", body: "system-ui, -apple-system, sans-serif", googleImport: null },
  },
  game_ui_arcade: {
    colors: { primary: '#ff4444', secondary: '#ffbb33', accent: '#00C851', bg: '#0d0d15', surface: '#1a1a2e', text: '#ffffff', textMuted: '#8888aa', border: 'rgba(255,68,68,0.2)' },
    darkColors: null,
    fonts: { heading: "'Orbitron', sans-serif", body: "'Exo 2', sans-serif", googleImport: 'Orbitron:wght@500;700;900&family=Exo+2:wght@300;400;600' },
  },
  dashboard_data: {
    colors: { primary: '#3b82f6', secondary: '#6366f1', accent: '#10b981', bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', textMuted: '#64748b', border: '#e2e8f0' },
    darkColors: { primary: '#60a5fa', secondary: '#818cf8', accent: '#34d399', bg: '#0f172a', surface: '#1e293b', text: '#f1f5f9', textMuted: '#94a3b8', border: '#334155' },
    fonts: { heading: "'Inter', sans-serif", body: "'Inter', sans-serif", googleImport: 'Inter:wght@400;500;600;700' },
  },
}

// ─── Industry-Aware Preset Auto-Detection ────────────────────────────

const INDUSTRY_PRESET_MAP = [
  { patterns: /\b(coffee|cafe|bakery|restaurant|bistro|diner|food truck|catering|brunch|breakfast)\b/i, preset: 'minimal_editorial', mood: 'warm' },
  { patterns: /\b(luxury|premium|high.end|exclusive|boutique|jewelry|jewellery|fashion house|couture)\b/i, preset: 'luxury_brand', mood: 'elegant' },
  { patterns: /\b(saas|startup|software|app|platform|tool|dashboard|analytics|b2b|crm)\b/i, preset: 'modern_saas', mood: 'professional' },
  { patterns: /\b(kids|children|toys|playful|fun|party|birthday|school|daycare|nursery)\b/i, preset: 'playful_startup', mood: 'playful' },
  { patterns: /\b(game|gaming|esports|arcade|rpg|pixel|retro)\b/i, preset: 'game_ui_arcade', mood: 'energetic' },
  { patterns: /\b(tech|ai|machine learning|blockchain|crypto|web3|cyber|hacker|devtools)\b/i, preset: 'futuristic_tech', mood: 'futuristic' },
  { patterns: /\b(portfolio|photography|creative|artist|designer|studio|agency|freelance)\b/i, preset: 'minimal_editorial', mood: 'creative' },
  { patterns: /\b(medical|health|clinic|hospital|dental|pharmacy|wellness|therapy|mental health)\b/i, preset: 'modern_saas', mood: 'clean' },
  { patterns: /\b(fitness|gym|yoga|crossfit|training|athlete|sports|run|workout)\b/i, preset: 'playful_startup', mood: 'energetic' },
  { patterns: /\b(real estate|property|homes|realty|mortgage|apartment|condo)\b/i, preset: 'luxury_brand', mood: 'professional' },
  { patterns: /\b(education|university|course|learning|elearning|tutoring|academy)\b/i, preset: 'modern_saas', mood: 'approachable' },
  { patterns: /\b(travel|hotel|resort|tourism|vacation|adventure|explore|destination)\b/i, preset: 'minimal_editorial', mood: 'aspirational' },
  { patterns: /\b(music|band|concert|dj|producer|album|vinyl|record)\b/i, preset: 'premium_dark', mood: 'moody' },
  { patterns: /\b(bar|nightclub|lounge|cocktail|brewery|wine|spirits)\b/i, preset: 'premium_dark', mood: 'moody' },
  { patterns: /\b(ecommerce|shop|store|retail|product|merchandise|clothing|apparel)\b/i, preset: 'modern_saas', mood: 'clean' },
  { patterns: /\b(nonprofit|charity|ngo|foundation|donate|cause|volunteer)\b/i, preset: 'modern_saas', mood: 'warm' },
  { patterns: /\b(law|legal|attorney|lawyer|firm|consulting|finance|accounting)\b/i, preset: 'minimal_editorial', mood: 'professional' },
]

/**
 * Auto-detect the best design preset from a user's brief text.
 * Returns { presetId, mood } or defaults to modern_saas.
 */
export function autoDetectPreset(briefText) {
  if (!briefText) return { presetId: 'modern_saas', mood: 'professional' }
  const lower = briefText.toLowerCase()
  for (const entry of INDUSTRY_PRESET_MAP) {
    if (entry.patterns.test(lower)) {
      return { presetId: entry.preset, mood: entry.mood }
    }
  }
  // Check for dark/light preference
  if (/\b(dark|night|noir|moody|shadow)\b/i.test(lower)) return { presetId: 'premium_dark', mood: 'moody' }
  if (/\b(minimal|clean|simple|elegant|editorial)\b/i.test(lower)) return { presetId: 'minimal_editorial', mood: 'elegant' }
  if (/\b(bold|bright|colorful|vibrant|playful|fun)\b/i.test(lower)) return { presetId: 'playful_startup', mood: 'playful' }
  return { presetId: 'modern_saas', mood: 'professional' }
}

export const DESIGN_TOKENS = {
  fontScale: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem',// 30px
    '4xl': '2.25rem', // 36px
    '5xl': '3rem',    // 48px
    '6xl': '3.75rem', // 60px
    '7xl': '4.5rem',  // 72px
  },
  spacingScale: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    '2xl': '48px',
    '3xl': '64px',
    '4xl': '96px',
    '5xl': '128px',
  },
  containerWidths: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1400px',
    full: '100%',
  },
  sectionPadding: {
    compact: 'py-8 md:py-12',
    balanced: 'py-12 md:py-20',
    spacious: 'py-20 md:py-32',
    editorial: 'py-24 md:py-40',
  },
  radiusValues: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '20px',
    full: '9999px',
  },
  shadowLevels: {
    none: 'none',
    sm: '0 1px 2px rgba(0,0,0,.05)',
    md: '0 4px 6px rgba(0,0,0,.07), 0 1px 3px rgba(0,0,0,.06)',
    lg: '0 10px 15px rgba(0,0,0,.1), 0 4px 6px rgba(0,0,0,.05)',
    xl: '0 20px 25px rgba(0,0,0,.12), 0 8px 10px rgba(0,0,0,.04)',
    glow: '0 0 20px rgba(var(--accent-rgb), 0.3)',
  },
  gridRules: {
    columns: '1 / 2 / 3 / 4 / 6 / 12',
    gap: '16px / 24px / 32px',
    maxCols: { mobile: 1, tablet: 2, desktop: '3-4', wide: '4-6' },
  },
  colorRoles: {
    primary: 'Main brand / CTA color',
    secondary: 'Supporting / hover states',
    accent: 'Highlights, badges, emphasis',
    background: 'Page and section backgrounds',
    surface: 'Card and panel backgrounds',
    text: 'Primary text color',
    textMuted: 'Secondary / helper text',
    border: 'Dividers and card borders',
    success: 'Positive actions / confirmations',
    warning: 'Caution states',
    error: 'Error states and destructive actions',
  },
}

// ─── Part 3: Layout Intelligence ────────────────────────────────────

export const LAYOUT_PATTERNS = {
  saas_landing: {
    name: 'SaaS Landing Page',
    sections: ['hero-with-cta', 'social-proof-logos', 'feature-grid-3col', 'feature-detail-alternating', 'testimonials', 'pricing-cards', 'faq-accordion', 'cta-banner', 'footer'],
    rules: 'Hero takes full viewport height or near it. Features use alternating image+text rows. Pricing is 3-column with highlighted recommended tier. CTA banner before footer.',
  },
  dashboard_shell: {
    name: 'Dashboard Shell',
    sections: ['top-nav', 'sidebar-nav', 'main-content-area', 'metric-cards-row', 'data-table-or-charts', 'activity-feed'],
    rules: 'Fixed sidebar (240-280px), sticky top nav (56-64px). Main area scrolls. Metric cards in 3-4 column grid at top. Charts below.',
  },
  pricing_section: {
    name: 'Pricing Section',
    sections: ['section-header', 'billing-toggle', 'pricing-cards-row', 'feature-comparison-table', 'faq'],
    rules: '3 tiers (Good/Better/Best). Middle card highlighted with "Most Popular" badge. Cards equal height. Show annual/monthly toggle. CTA in each card.',
  },
  feature_grid: {
    name: 'Feature Grid',
    sections: ['section-header', 'feature-cards-grid'],
    rules: '3 or 4 columns. Each card: icon + title + description. Consistent card height. Icons use a consistent style (outlined or filled, not mixed).',
  },
  testimonial_block: {
    name: 'Testimonial Block',
    sections: ['section-header', 'testimonial-cards'],
    rules: 'Quote text prominent. Avatar + name + role below. 3 columns or carousel. Star rating optional. Use real-looking content, not "Lorem ipsum".',
  },
  hero_cta: {
    name: 'Hero + CTA',
    sections: ['headline', 'subheadline', 'cta-buttons', 'hero-image-or-illustration', 'trust-badges'],
    rules: 'Headline: max 8-10 words, bold and clear. Subheadline: 1-2 sentences, lighter weight. Two buttons: primary CTA + secondary. Image/mockup on right or below.',
  },
  settings_panel: {
    name: 'App Settings Panel',
    sections: ['settings-nav-sidebar', 'settings-content-area', 'setting-groups', 'save-bar'],
    rules: 'Left nav with categories. Right content area with grouped form sections. Each group has a label + description + controls. Sticky save bar at bottom.',
  },
  login_screen: {
    name: 'Login / Signup Screen',
    sections: ['brand-logo', 'form-card', 'social-login-options', 'footer-links'],
    rules: 'Centered card on colored/image background. Form: email + password + submit. "Forgot password?" and "Sign up" links. Optional: side panel with marketing message.',
  },
  mobile_onboarding: {
    name: 'Mobile Onboarding Flow',
    sections: ['illustration', 'title-text', 'description', 'pagination-dots', 'next-button', 'skip-link'],
    rules: 'Full-screen slides. Large illustration top half, text bottom half. Dot indicators for progress. "Skip" in top-right. Final slide has "Get Started" CTA.',
  },
}

// ─── Part 4: Component Design Patterns ──────────────────────────────

export const COMPONENT_PATTERNS = {
  navbar: {
    name: 'Navigation Bar',
    structure: 'logo left, nav links center or right, CTA button far right, mobile hamburger menu',
    visual: 'Sticky top, backdrop-blur glass effect or solid bg. Height 64px desktop, 56px mobile.',
    spacing: 'px-6 md:px-8 internal, gap-8 between nav items',
    responsive: 'Collapse to hamburger at md breakpoint. Full-screen or slide-out mobile menu.',
  },
  hero: {
    name: 'Hero Section',
    structure: 'headline + subtext + CTA group + optional image/mockup',
    visual: 'Largest text on page. Clear visual hierarchy. Primary CTA is filled, secondary is outlined/ghost.',
    spacing: 'py-20 md:py-32, gap-6 between text elements, gap-4 between buttons',
    responsive: 'Stack vertically on mobile, text first then image. Full-width buttons on mobile.',
  },
  feature_card: {
    name: 'Feature Card',
    structure: 'icon/illustration + title + description',
    visual: 'Consistent icon size (48px). Title in semibold. Description in muted text. Equal card heights.',
    spacing: 'p-6 md:p-8, gap-4 internal, icon-to-title gap-3',
    responsive: 'Full width on mobile, 2-col on tablet, 3-4 col on desktop.',
  },
  pricing_card: {
    name: 'Pricing Card',
    structure: 'tier-name + price + billing-period + feature-list + CTA-button',
    visual: 'Highlighted card has border/shadow/badge. Price is largest text. Features have checkmarks.',
    spacing: 'p-8, gap-6 internal, feature items gap-3',
    responsive: 'Stack vertically on mobile. Horizontal scroll optional on tablet.',
  },
  form: {
    name: 'Form Component',
    structure: 'labels + inputs + validation-messages + submit-button',
    visual: 'Clear labels above inputs. Consistent input height (40-44px). Error states in red. Focus rings.',
    spacing: 'gap-4 between fields, gap-2 label-to-input, gap-6 before submit',
    responsive: 'Full-width inputs. Two-column for wide forms on desktop.',
  },
  testimonial: {
    name: 'Testimonial Card',
    structure: 'quote-text + avatar + name + role/company + optional-rating',
    visual: 'Large quotation mark or quote icon. Real-looking avatar. Name bold, role muted.',
    spacing: 'p-6 md:p-8, gap-4 internal',
    responsive: 'Full width on mobile, 3-col grid on desktop.',
  },
  footer: {
    name: 'Footer Section',
    structure: 'logo + description + link-columns + social-icons + copyright',
    visual: 'Darker background than main content. 3-4 link columns. Small text for copyright.',
    spacing: 'py-12 md:py-16, gap-8 between columns, gap-4 between links',
    responsive: 'Stack columns vertically on mobile, 2-col on tablet.',
  },
  sidebar: {
    name: 'Sidebar Navigation',
    structure: 'logo/brand + nav-items + optional-footer (settings/logout)',
    visual: 'Fixed width 240-280px. Active item highlighted with bg change. Icons + labels.',
    spacing: 'py-4 px-3, gap-1 between items, items py-2 px-3',
    responsive: 'Hidden on mobile, accessible via hamburger. Slide-out overlay.',
  },
  data_table: {
    name: 'Data Table',
    structure: 'header-row + data-rows + pagination + optional-toolbar (search, filter, actions)',
    visual: 'Alternating row colors or border-separated. Sortable column headers. Compact density.',
    spacing: 'cells px-4 py-3, header slightly more padding',
    responsive: 'Horizontal scroll on mobile. Or hide less-important columns.',
  },
  stats_card: {
    name: 'Stats / Metric Card',
    structure: 'metric-value + label + trend-indicator + optional-sparkline',
    visual: 'Large number (2xl-3xl). Small label below or above. Green/red trend arrow with percentage.',
    spacing: 'p-5 md:p-6, gap-1 between value and label',
    responsive: '2-col on mobile, 3-4 col on desktop.',
  },
  modal: {
    name: 'Modal Dialog',
    structure: 'overlay + card (header + body + footer-actions)',
    visual: 'Dark overlay (rgba(0,0,0,.5)). Centered white/dark card. Close X in top-right. Primary + secondary actions in footer.',
    spacing: 'p-6, header pb-4, footer pt-4 border-t, body py-4',
    responsive: 'Full-screen on mobile, centered card on desktop.',
  },
}

// ─── Part 5: Format design context for AI prompts ───────────────────

/**
 * Build the design context block that gets injected into the AI system prompt.
 * @param {object} designPrefs - Project design preferences
 * @returns {string} The design context block for the AI prompt
 */
export function formatDesignContextBlock(designPrefs) {
  if (!designPrefs) return getDefaultDesignBlock()

  const preset = DESIGN_PRESETS[designPrefs.preset] || DESIGN_PRESETS.modern_saas
  const parts = []

  parts.push('## DESIGN DIRECTION')
  parts.push('')
  parts.push(`**Active Preset:** ${preset.name} — ${preset.description}`)
  parts.push('')

  // Visual direction
  parts.push('### Visual Specifications')
  parts.push(`- **Typography:** ${preset.typography.headline}; body: ${preset.typography.body}`)
  parts.push(`- **Spacing:** ${preset.spacing.scale} density, section padding ${preset.spacing.sectionPadding}`)
  parts.push(`- **Border Radius:** ${preset.radius.style} — ${preset.radius.values}`)
  parts.push(`- **Shadows:** ${preset.shadows.style} — ${preset.shadows.values}`)
  parts.push(`- **Buttons:** ${preset.buttons.style}`)
  parts.push(`- **Cards:** ${preset.cards.style}`)
  parts.push(`- **Layout:** ${preset.layout.density} density, max-width ${preset.layout.maxWidth}`)
  parts.push(`- **Background:** ${preset.background.treatment}`)
  parts.push(`- **Colors:** ${preset.colors.philosophy}`)
  parts.push(`- **Interactions:** ${preset.interaction.style}`)
  parts.push('')

  // User overrides
  if (designPrefs.colorDirection) {
    parts.push(`**Color Direction Override:** ${designPrefs.colorDirection}`)
  }
  if (designPrefs.density) {
    parts.push(`**Density Override:** ${designPrefs.density}`)
  }
  if (designPrefs.theme) {
    parts.push(`**Theme:** ${designPrefs.theme}`)
  }
  if (designPrefs.interfaceType) {
    parts.push(`**Interface Type:** ${designPrefs.interfaceType}`)
  }
  if (designPrefs.customNotes) {
    parts.push(`**Custom Design Notes:** ${designPrefs.customNotes}`)
  }

  parts.push('')
  parts.push(getDesignRulesBlock(designPrefs.interfaceType))

  return parts.join('\n')
}

function getDefaultDesignBlock() {
  const preset = DESIGN_PRESETS.premium_dark
  const parts = []

  parts.push('## DESIGN DIRECTION (Default: Premium Dark)')
  parts.push('')
  parts.push('MANDATORY: Generate a DARK THEMED site (bg-gray-950 text-white) unless the user explicitly requests a light theme.')
  parts.push('')
  parts.push(`**Typography:** ${preset.typography.headline}; body: ${preset.typography.body}`)
  parts.push(`**Spacing:** ${preset.spacing.scale} density, section padding ${preset.spacing.sectionPadding}`)
  parts.push(`**Radius:** ${preset.radius.style} — ${preset.radius.values}`)
  parts.push(`**Shadows:** ${preset.shadows.style}`)
  parts.push(`**Buttons:** ${preset.buttons.style}`)
  parts.push(`**Cards:** ${preset.cards.style}`)
  parts.push(`**Colors:** ${preset.colors.philosophy}`)
  parts.push(`**Layout:** ${preset.layout.density}, max ${preset.layout.maxWidth}`)
  parts.push('')
  parts.push(getDesignRulesBlock('website'))

  return parts.join('\n')
}

function getDesignRulesBlock(interfaceType) {
  const rules = [
    '### Design Quality Rules (MANDATORY)',
    '1. **Dark theme by default:** Root wrapper MUST use `className="bg-gray-950 text-white min-h-screen antialiased"`. NEVER use white/light backgrounds unless user explicitly requests it.',
    '2. **SVG Logo required:** Create an inline SVG logo — NEVER use just text as a brand logo.',
    '3. **Glassmorphism navbar:** `sticky top-0 z-50 bg-gray-900/70 backdrop-blur-xl border-b border-white/5`.',
    '4. **Gradient text on hero:** At least ONE heading with `bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent`.',
    '5. **Glass cards:** `bg-white/[0.03] border border-white/[0.06] rounded-2xl` with `hover:bg-white/[0.06] transition-all`.',
    '6. **CTA glow:** Primary buttons: `bg-indigo-600 hover:bg-indigo-500 rounded-full shadow-lg shadow-indigo-500/25`.',
    '7. **Decorative glow orbs:** 2-3 per page: `absolute w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl`.',
    '8. **Pill badges:** `inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm`.',
    '9. **Hover transitions on EVERY interactive element.**',
    '10. **Real content only** — no "Lorem ipsum". Realistic names, stats, testimonials specific to the brand.',
    '11. **STANDARD TAILWIND ONLY:** NEVER invent custom class names. Use ONLY built-in Tailwind utilities:',
    '    - Dark bg: `bg-gray-950`, `bg-gray-900`, `bg-slate-900`',
    '    - Text: `text-white`, `text-gray-100`, `text-gray-400`, `text-gray-500`',
    '    - Accent: `bg-indigo-600`, `bg-violet-500`, `bg-emerald-500`, `bg-rose-500`',
    '    - Cards: `bg-white/[0.03]`, `bg-white/5`, `bg-gray-800/50`',
    '    - Borders: `border-white/5`, `border-white/10`, `border-white/[0.06]`',
  ]

  if (interfaceType === 'dashboard') {
    rules.push('12. **Dashboard-specific:** sidebar + topbar shell, metric cards, dense but readable data.')
  } else if (interfaceType === 'mobile') {
    rules.push('12. **Mobile-specific:** single column, 44px touch targets, bottom nav.')
  } else if (interfaceType === 'game') {
    rules.push('11. **Game UI-specific:** bold colors, HUD layouts, score displays, inventory grids, high contrast.')
  }

  return rules.join('\n')
}

// ─── Part 3 (continued): Get relevant layout pattern for AI ─────────

export function getLayoutPatternForPrompt(interfaceType, message) {
  const lower = message.toLowerCase()
  const matched = []

  for (const [key, pattern] of Object.entries(LAYOUT_PATTERNS)) {
    const nameWords = pattern.name.toLowerCase().split(/\s+/)
    if (nameWords.some(w => lower.includes(w))) {
      matched.push(pattern)
    }
  }

  // Also check by interface type
  if (interfaceType === 'dashboard' && !matched.some(p => p.name.includes('Dashboard'))) {
    matched.push(LAYOUT_PATTERNS.dashboard_shell)
  }
  if ((lower.includes('landing') || lower.includes('homepage')) && !matched.some(p => p.name.includes('SaaS'))) {
    matched.push(LAYOUT_PATTERNS.saas_landing)
  }
  if (lower.includes('login') || lower.includes('signup') || lower.includes('sign up')) {
    matched.push(LAYOUT_PATTERNS.login_screen)
  }
  if (lower.includes('pricing')) {
    matched.push(LAYOUT_PATTERNS.pricing_section)
  }
  if (lower.includes('settings')) {
    matched.push(LAYOUT_PATTERNS.settings_panel)
  }

  if (!matched.length) return ''

  const parts = ['### Recommended Layout Patterns']
  for (const p of matched.slice(0, 2)) {
    parts.push(`\n**${p.name}:**`)
    parts.push(`Sections: ${p.sections.join(' → ')}`)
    parts.push(`Rules: ${p.rules}`)
  }
  return parts.join('\n')
}

// ─── Part 4 (continued): Get relevant component patterns ────────────

export function getComponentPatternsForPrompt(message) {
  const lower = message.toLowerCase()
  const matched = []

  const keywordMap = {
    navbar: ['nav', 'navigation', 'header', 'menu'],
    hero: ['hero', 'landing', 'homepage', 'main section', 'above the fold'],
    feature_card: ['feature', 'benefit', 'capability'],
    pricing_card: ['pricing', 'plan', 'tier', 'subscription'],
    form: ['form', 'input', 'contact', 'signup', 'login', 'register'],
    testimonial: ['testimonial', 'review', 'quote', 'feedback'],
    footer: ['footer', 'bottom'],
    sidebar: ['sidebar', 'side nav', 'navigation panel'],
    data_table: ['table', 'list', 'data', 'grid', 'records'],
    stats_card: ['stat', 'metric', 'kpi', 'dashboard', 'analytics'],
    modal: ['modal', 'dialog', 'popup', 'overlay'],
  }

  for (const [patKey, keywords] of Object.entries(keywordMap)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matched.push(COMPONENT_PATTERNS[patKey])
    }
  }

  if (!matched.length) return ''

  const parts = ['### Component Design Patterns']
  for (const p of matched.slice(0, 4)) {
    parts.push(`\n**${p.name}:**`)
    parts.push(`- Structure: ${p.structure}`)
    parts.push(`- Visual: ${p.visual}`)
    parts.push(`- Spacing: ${p.spacing}`)
    parts.push(`- Responsive: ${p.responsive}`)
  }
  return parts.join('\n')
}

// ─── Part 7: Design Memory defaults ─────────────────────────────────

export function getDefaultDesignPrefs() {
  return {
    preset: 'modern_saas',
    colorDirection: '',
    density: 'balanced',
    theme: 'light',
    interfaceType: 'website',
    customNotes: '',
  }
}

export function getPresetList() {
  return Object.values(DESIGN_PRESETS).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }))
}
