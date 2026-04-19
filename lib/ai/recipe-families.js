// ══════════════════════════════════════════════════════════════════════
// ── RECIPE FAMILIES ──
// Alternative recipe variants grouped by aesthetic archetype. A Vision
// classifier picks the family per build from the user's references; the
// builder then swaps variant recipes (`navbar_glass`, `landing_page`) for
// the family's version instead of the baseline.
//
// Families currently override ONLY the two most visually distinctive
// recipes — navbar + landing — because those set the aesthetic tone for
// the rest of the app. Auth, dashboard, pricing etc. stay baseline
// (consistent app-UX patterns don't need aesthetic variance).
//
// Adding a family: add an entry to FAMILY_VARIANTS keyed by family id.
// Entries must preserve the same `file`, `name`, data-testids, and React-
// globals rules as the baseline recipes.
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} RecipeVariant
 * @property {string} name
 * @property {string} file
 * @property {string} description
 * @property {string} code
 */

/**
 * Family ID → { recipeId → variant }.
 * The `'saas-clean'` family is implicit (empty) — falls through to the
 * baseline recipes in `recipes.js`. Other families override only the
 * recipes that need to look different.
 */
export const FAMILY_VARIANTS = {
  // ═══ Editorial-serif: magazine-style, asymmetric, display serif, hairlines ═══
  'editorial-serif': {
    navbar_glass: {
      name: 'Navbar',
      file: 'components/Navbar.jsx',
      description: 'Editorial navbar — thin hairline bottom border, display-serif brand, links inline as small-caps.',
      code: `import { useAuth } from './AuthContext'

export default function Navbar({ onNavigate, currentRoute }) {
  const { isAuthenticated, logout } = useAuth()
  const publicLinks = [
    { id: 'landing', label: 'Home' },
    { id: 'features', label: 'Stories' },
    { id: 'pricing', label: 'Pricing' },
  ]
  return (
    <nav
      className="bg-[var(--bg)] border-b border-[var(--border)]"
      aria-label="Main navigation"
      data-testid="navbar"
    >
      <div className="max-w-7xl mx-auto px-8 py-8 flex items-center justify-between">
        <button
          onClick={() => onNavigate('landing')}
          className="flex items-center gap-3"
          aria-label="Go to home"
          data-testid="navbar-brand"
        >
          <span className="w-7 h-7 rounded-none bg-[var(--primary)]" aria-hidden="true" />
          <span className="text-2xl tracking-tight text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>Brand</span>
        </button>
        <div className="hidden md:flex items-center gap-10">
          {publicLinks.map((l) => (
            <button
              key={l.id}
              onClick={() => onNavigate(l.id)}
              data-testid={'navbar-link-' + l.id}
              aria-current={currentRoute === l.id ? 'page' : undefined}
              className={'text-[11px] uppercase tracking-[0.2em] transition-colors ' + (currentRoute === l.id ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]')}
            >{l.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-6">
          {isAuthenticated ? (
            <>
              <button onClick={() => onNavigate('dashboard')} data-testid="navbar-dashboard" className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Dashboard</button>
              <button onClick={() => { logout(); onNavigate('landing') }} data-testid="navbar-logout" className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Sign out</button>
            </>
          ) : (
            <>
              <button onClick={() => onNavigate('login')} data-testid="navbar-login" className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Sign in</button>
              <button onClick={() => onNavigate('signup')} data-testid="navbar-signup" className="px-5 py-2.5 bg-[var(--ink)] text-[var(--bg)] text-[11px] uppercase tracking-[0.2em]">Subscribe</button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}`,
    },
    landing_page: {
      name: 'Landing',
      file: 'pages/Landing.jsx',
      description: 'Editorial landing — asymmetric hero with oversized serif headline, hairline separators, text-heavy feature rows alternating L/R image.',
      code: `import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Landing({ onNavigate }) {
  const features = [
    { title: 'Feature one', desc: 'Describe in one sentence.' },
    { title: 'Feature two', desc: 'Describe in one sentence.' },
    { title: 'Feature three', desc: 'Describe in one sentence.' },
  ]
  return (
    <div data-testid="landing-page">
      <Navbar onNavigate={onNavigate} currentRoute="landing" />
      <main id="main-content">
        <section className="max-w-7xl mx-auto px-8 py-32 grid grid-cols-12 gap-8 items-end border-b border-[var(--border)]">
          <div className="col-span-12 lg:col-span-7">
            <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)] mb-8" data-testid="hero-badge">ISSUE 01 · NEW</div>
            <h1
              className="text-6xl md:text-8xl leading-[0.95] text-[var(--ink)] mb-8"
              style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}
              data-testid="hero-headline"
            >{/* Builder: headline goes here, brand-specific */}Headline.</h1>
            <p className="text-lg text-[var(--ink-muted)] max-w-xl" data-testid="hero-subtitle">{/* Builder: subhead paraphrasing brand description */}Supporting sentence.</p>
          </div>
          <div className="col-span-12 lg:col-span-5 aspect-[4/5] bg-[var(--surface)] border border-[var(--border)]" aria-hidden="true">
            {/* Builder: if components/assets.js has HERO_URL replace with <img src={HERO_URL} className="w-full h-full object-cover" /> */}
            <div className="w-full h-full bg-[var(--accent)] opacity-20" />
          </div>
          <div className="col-span-12 flex items-center gap-6 pt-8">
            <button onClick={() => onNavigate('signup')} data-testid="hero-primary-cta" className="px-8 py-4 bg-[var(--ink)] text-[var(--bg)] text-[11px] uppercase tracking-[0.2em] hover:opacity-80 transition-opacity">Read the first issue</button>
            <button onClick={() => onNavigate('features')} data-testid="hero-secondary-cta" className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)] hover:text-[var(--ink)]">Browse the archive →</button>
          </div>
        </section>
        <section className="max-w-7xl mx-auto px-8 py-24" data-testid="landing-features" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)] mb-12">What's inside</h2>
          <div className="space-y-16">
            {features.map((f, i) => (
              <article key={i} className="grid grid-cols-12 gap-8 border-t border-[var(--border)] pt-8" data-testid={'feature-card-' + i}>
                <div className="col-span-12 md:col-span-3 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Chapter {String(i + 1).padStart(2, '0')}</div>
                <div className="col-span-12 md:col-span-9">
                  <h3 className="text-3xl text-[var(--ink)] mb-3" style={{ fontFamily: 'var(--font-display)' }}>{f.title}</h3>
                  <p className="text-lg text-[var(--ink-muted)] max-w-2xl">{f.desc}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="max-w-4xl mx-auto px-8 py-24 text-center border-t border-[var(--border)]" data-testid="landing-final-cta">
          <h2 className="text-4xl text-[var(--ink)] mb-4" style={{ fontFamily: 'var(--font-display)' }}>Ready?</h2>
          <button onClick={() => onNavigate('signup')} className="mt-4 px-8 py-4 bg-[var(--ink)] text-[var(--bg)] text-[11px] uppercase tracking-[0.2em]" data-testid="landing-cta-final">Subscribe</button>
        </section>
      </main>
      <Footer onNavigate={onNavigate} />
    </div>
  )
}`,
    },
  },

  // ═══ Brutalist-raw: chunky, system-font, 2px borders, no-radius, loud ═══
  'brutalist-raw': {
    navbar_glass: {
      name: 'Navbar',
      file: 'components/Navbar.jsx',
      description: 'Brutalist navbar — thick bottom border, mono/system font, no radius, high-contrast brand chip.',
      code: `import { useAuth } from './AuthContext'

export default function Navbar({ onNavigate, currentRoute }) {
  const { isAuthenticated, logout } = useAuth()
  const publicLinks = [
    { id: 'landing', label: 'HOME' },
    { id: 'features', label: 'FEATURES' },
    { id: 'pricing', label: 'PRICING' },
  ]
  return (
    <nav
      className="bg-[var(--bg)] border-b-[3px] border-[var(--ink)]"
      aria-label="Main navigation"
      data-testid="navbar"
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <button onClick={() => onNavigate('landing')} className="flex items-center gap-3" aria-label="Go to home" data-testid="navbar-brand">
          <span className="w-10 h-10 bg-[var(--primary)] border-2 border-[var(--ink)]" aria-hidden="true" />
          <span className="text-2xl font-black uppercase tracking-tight text-[var(--ink)]" style={{ fontFamily: 'ui-monospace, "SF Mono", monospace' }}>BRAND</span>
        </button>
        <div className="hidden md:flex items-center gap-0">
          {publicLinks.map((l) => (
            <button
              key={l.id}
              onClick={() => onNavigate(l.id)}
              data-testid={'navbar-link-' + l.id}
              aria-current={currentRoute === l.id ? 'page' : undefined}
              className={'px-5 py-2 text-xs font-black uppercase border-r-2 border-[var(--ink)] last:border-r-0 transition-colors ' + (currentRoute === l.id ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--bg)]')}
              style={{ fontFamily: 'ui-monospace, "SF Mono", monospace' }}
            >{l.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <button onClick={() => onNavigate('dashboard')} data-testid="navbar-dashboard" className="px-4 py-2 text-xs font-black uppercase text-[var(--ink)] border-2 border-[var(--ink)]">DASH</button>
              <button onClick={() => { logout(); onNavigate('landing') }} data-testid="navbar-logout" className="px-4 py-2 text-xs font-black uppercase text-[var(--ink)]">LOGOUT</button>
            </>
          ) : (
            <>
              <button onClick={() => onNavigate('login')} data-testid="navbar-login" className="px-4 py-2 text-xs font-black uppercase text-[var(--ink)]">LOGIN</button>
              <button onClick={() => onNavigate('signup')} data-testid="navbar-signup" className="px-5 py-3 bg-[var(--ink)] text-[var(--bg)] text-xs font-black uppercase border-2 border-[var(--ink)]" style={{ boxShadow: '4px 4px 0 var(--primary)' }}>SIGN UP →</button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}`,
    },
    landing_page: {
      name: 'Landing',
      file: 'pages/Landing.jsx',
      description: 'Brutalist landing — oversized caps headline, thick borders, offset box-shadows, monospace, asymmetric grid with raw feature blocks.',
      code: `import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Landing({ onNavigate }) {
  const features = [
    { title: 'FEATURE 01', desc: 'Plain-spoken capability line.' },
    { title: 'FEATURE 02', desc: 'Plain-spoken capability line.' },
    { title: 'FEATURE 03', desc: 'Plain-spoken capability line.' },
  ]
  return (
    <div data-testid="landing-page" style={{ fontFamily: 'ui-monospace, "SF Mono", monospace' }}>
      <Navbar onNavigate={onNavigate} currentRoute="landing" />
      <main id="main-content">
        <section className="max-w-7xl mx-auto px-6 py-20">
          <div className="inline-block px-3 py-1 bg-[var(--primary)] text-[var(--primary-ink)] text-xs font-black uppercase border-2 border-[var(--ink)] mb-8" data-testid="hero-badge">NEW · LIVE</div>
          <h1
            className="text-7xl md:text-[11rem] font-black uppercase leading-[0.85] text-[var(--ink)] mb-8"
            style={{ fontFamily: 'inherit', letterSpacing: '-0.04em' }}
            data-testid="hero-headline"
          >{/* Builder: SHORT. ALL CAPS. BRAND-SPECIFIC. */}HEADLINE.</h1>
          <div className="grid grid-cols-12 gap-6 mt-16">
            <div className="col-span-12 md:col-span-7">
              <p className="text-2xl text-[var(--ink)] border-l-4 border-[var(--primary)] pl-6 mb-8" data-testid="hero-subtitle" style={{ fontFamily: 'inherit' }}>{/* Builder: subhead */}One line about what this is.</p>
              <div className="flex flex-wrap gap-4">
                <button onClick={() => onNavigate('signup')} data-testid="hero-primary-cta" className="px-6 py-4 bg-[var(--ink)] text-[var(--bg)] text-sm font-black uppercase border-2 border-[var(--ink)]" style={{ boxShadow: '6px 6px 0 var(--primary)' }}>START →</button>
                <button onClick={() => onNavigate('features')} data-testid="hero-secondary-cta" className="px-6 py-4 text-sm font-black uppercase text-[var(--ink)] border-2 border-[var(--ink)]">DOCS</button>
              </div>
            </div>
            <div className="col-span-12 md:col-span-5 aspect-square border-[3px] border-[var(--ink)] relative" aria-hidden="true">
              {/* Builder: if components/assets.js has HERO_URL replace with <img src={HERO_URL} className="w-full h-full object-cover" /> */}
              <div className="w-full h-full bg-[var(--accent)]" />
            </div>
          </div>
        </section>
        <section className="max-w-7xl mx-auto px-6 py-20" data-testid="landing-features" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-4xl font-black uppercase text-[var(--ink)] mb-12 border-b-[3px] border-[var(--ink)] pb-4">WHAT IT DOES</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-[3px] border-[var(--ink)]">
            {features.map((f, i) => (
              <div key={i} className={'p-8 ' + (i < features.length - 1 ? 'md:border-r-[3px] border-[var(--ink)]' : '')} data-testid={'feature-card-' + i}>
                <div className="text-xs font-black uppercase text-[var(--ink-muted)] mb-4">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="text-2xl font-black uppercase text-[var(--ink)] mb-3">{f.title}</h3>
                <p className="text-[var(--ink-muted)]">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="max-w-4xl mx-auto px-6 py-24 text-center" data-testid="landing-final-cta">
          <h2 className="text-5xl font-black uppercase text-[var(--ink)] mb-8">START NOW.</h2>
          <button onClick={() => onNavigate('signup')} className="px-10 py-5 bg-[var(--primary)] text-[var(--primary-ink)] text-lg font-black uppercase border-[3px] border-[var(--ink)]" style={{ boxShadow: '8px 8px 0 var(--ink)' }} data-testid="landing-cta-final">SIGN ME UP →</button>
        </section>
      </main>
      <Footer onNavigate={onNavigate} />
    </div>
  )
}`,
    },
  },

  // ═══ Luxury-minimal: generous whitespace, thin hairlines, serif display, muted palette ═══
  'luxury-minimal': {
    navbar_glass: {
      name: 'Navbar',
      file: 'components/Navbar.jsx',
      description: 'Luxury navbar — generous whitespace, thin hairline border, serif brand, lowercase links, tiny typography.',
      code: `import { useAuth } from './AuthContext'

export default function Navbar({ onNavigate, currentRoute }) {
  const { isAuthenticated, logout } = useAuth()
  const publicLinks = [
    { id: 'landing', label: 'home' },
    { id: 'features', label: 'collection' },
    { id: 'pricing', label: 'membership' },
  ]
  return (
    <nav className="bg-[var(--bg)] border-b border-[var(--border)]" aria-label="Main navigation" data-testid="navbar">
      <div className="max-w-7xl mx-auto px-10 py-10 flex items-center justify-between">
        <button onClick={() => onNavigate('landing')} className="flex items-center gap-2" aria-label="Go to home" data-testid="navbar-brand">
          <span className="w-5 h-5 rounded-full bg-[var(--primary)]" aria-hidden="true" />
          <span className="text-xl tracking-wide text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>Brand</span>
        </button>
        <div className="hidden md:flex items-center gap-12">
          {publicLinks.map((l) => (
            <button
              key={l.id}
              onClick={() => onNavigate(l.id)}
              data-testid={'navbar-link-' + l.id}
              aria-current={currentRoute === l.id ? 'page' : undefined}
              className={'text-[11px] tracking-widest transition-colors ' + (currentRoute === l.id ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]')}
            >{l.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-6">
          {isAuthenticated ? (
            <>
              <button onClick={() => onNavigate('dashboard')} data-testid="navbar-dashboard" className="text-[11px] tracking-widest text-[var(--ink-muted)]">account</button>
              <button onClick={() => { logout(); onNavigate('landing') }} data-testid="navbar-logout" className="text-[11px] tracking-widest text-[var(--ink-muted)]">sign out</button>
            </>
          ) : (
            <>
              <button onClick={() => onNavigate('login')} data-testid="navbar-login" className="text-[11px] tracking-widest text-[var(--ink-muted)]">sign in</button>
              <button onClick={() => onNavigate('signup')} data-testid="navbar-signup" className="px-6 py-3 border border-[var(--ink)] text-[11px] tracking-widest text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors">join</button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}`,
    },
    landing_page: {
      name: 'Landing',
      file: 'pages/Landing.jsx',
      description: 'Luxury landing — centered serif hero with enormous whitespace, thin hairline rules, minimal copy, single hero image.',
      code: `import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Landing({ onNavigate }) {
  const features = [
    { title: 'Considered', desc: 'Short sentence about quality.' },
    { title: 'Timeless', desc: 'Short sentence about longevity.' },
    { title: 'Crafted', desc: 'Short sentence about craft.' },
  ]
  return (
    <div data-testid="landing-page">
      <Navbar onNavigate={onNavigate} currentRoute="landing" />
      <main id="main-content">
        <section className="max-w-4xl mx-auto px-10 py-40 text-center">
          <div className="text-[10px] tracking-[0.4em] uppercase text-[var(--ink-muted)] mb-12" data-testid="hero-badge">Est. 2026</div>
          <h1
            className="text-5xl md:text-7xl leading-[1.05] text-[var(--ink)] mb-10"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.015em' }}
            data-testid="hero-headline"
          >{/* Builder: brand-specific, short, elegant */}Something rare, carefully made.</h1>
          <p className="text-base text-[var(--ink-muted)] max-w-xl mx-auto mb-12 leading-relaxed" data-testid="hero-subtitle">{/* Builder: subhead, one sentence */}A single sentence that sets the tone.</p>
          <button onClick={() => onNavigate('signup')} data-testid="hero-primary-cta" className="px-10 py-4 border border-[var(--ink)] text-[11px] tracking-[0.3em] uppercase text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors">Request access</button>
        </section>
        <section className="max-w-6xl mx-auto px-10 pb-40" aria-hidden="true">
          <div className="aspect-[16/9] bg-[var(--surface)] border border-[var(--border)]">
            {/* Builder: if components/assets.js has HERO_URL replace with <img src={HERO_URL} className="w-full h-full object-cover" /> */}
            <div className="w-full h-full bg-[var(--accent)] opacity-20" />
          </div>
        </section>
        <section className="max-w-5xl mx-auto px-10 py-32 border-t border-[var(--border)]" data-testid="landing-features" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-[10px] tracking-[0.4em] uppercase text-[var(--ink-muted)] text-center mb-20">Principles</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-16">
            {features.map((f, i) => (
              <div key={i} className="text-center" data-testid={'feature-card-' + i}>
                <div className="text-[10px] tracking-[0.4em] uppercase text-[var(--ink-muted)] mb-4">No. {String(i + 1).padStart(2, '0')}</div>
                <h3 className="text-2xl text-[var(--ink)] mb-4" style={{ fontFamily: 'var(--font-display)' }}>{f.title}</h3>
                <p className="text-sm text-[var(--ink-muted)] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="max-w-3xl mx-auto px-10 py-32 text-center border-t border-[var(--border)]" data-testid="landing-final-cta">
          <h2 className="text-4xl text-[var(--ink)] mb-8" style={{ fontFamily: 'var(--font-display)' }}>Join.</h2>
          <button onClick={() => onNavigate('signup')} className="px-10 py-4 border border-[var(--ink)] text-[11px] tracking-[0.3em] uppercase text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--bg)] transition-colors" data-testid="landing-cta-final">Request access</button>
        </section>
      </main>
      <Footer onNavigate={onNavigate} />
    </div>
  )
}`,
    },
  },

  // ═══ Playful-illustrated: rounded, bouncy, pastel, friendly, emoji-adjacent ═══
  'playful-illustrated': {
    navbar_glass: {
      name: 'Navbar',
      file: 'components/Navbar.jsx',
      description: 'Playful navbar — fully rounded pill, chunky weight, high-radius brand pill, cheerful.',
      code: `import { useAuth } from './AuthContext'

export default function Navbar({ onNavigate, currentRoute }) {
  const { isAuthenticated, logout } = useAuth()
  const publicLinks = [
    { id: 'landing', label: 'Home' },
    { id: 'features', label: 'Features' },
    { id: 'pricing', label: 'Pricing' },
  ]
  return (
    <nav className="sticky top-4 z-50 max-w-6xl mx-auto px-4" aria-label="Main navigation" data-testid="navbar">
      <div className="bg-[var(--surface)] rounded-full px-6 py-3 flex items-center justify-between shadow-lg border border-[var(--border)]">
        <button onClick={() => onNavigate('landing')} className="flex items-center gap-2.5" aria-label="Go to home" data-testid="navbar-brand">
          <span className="w-9 h-9 rounded-full bg-[var(--primary)] flex items-center justify-center" aria-hidden="true">
            <span className="w-3 h-3 rounded-full bg-[var(--bg)]" />
          </span>
          <span className="font-extrabold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>Brand</span>
        </button>
        <div className="hidden md:flex items-center gap-2">
          {publicLinks.map((l) => (
            <button
              key={l.id}
              onClick={() => onNavigate(l.id)}
              data-testid={'navbar-link-' + l.id}
              aria-current={currentRoute === l.id ? 'page' : undefined}
              className={'px-4 py-2 rounded-full text-sm font-bold transition-all hover:-translate-y-0.5 ' + (currentRoute === l.id ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-[var(--ink)] hover:bg-[var(--bg)]')}
            >{l.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <>
              <button onClick={() => onNavigate('dashboard')} data-testid="navbar-dashboard" className="px-4 py-2 rounded-full text-sm font-bold text-[var(--ink)]">Dashboard</button>
              <button onClick={() => { logout(); onNavigate('landing') }} data-testid="navbar-logout" className="px-4 py-2 rounded-full text-sm font-bold text-[var(--ink-muted)]">Bye</button>
            </>
          ) : (
            <>
              <button onClick={() => onNavigate('login')} data-testid="navbar-login" className="px-4 py-2 rounded-full text-sm font-bold text-[var(--ink)]">Log in</button>
              <button onClick={() => onNavigate('signup')} data-testid="navbar-signup" className="px-5 py-2.5 rounded-full bg-[var(--primary)] text-[var(--primary-ink)] text-sm font-extrabold transition-all hover:-translate-y-0.5 hover:shadow-lg">Let's go →</button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}`,
    },
    landing_page: {
      name: 'Landing',
      file: 'pages/Landing.jsx',
      description: 'Playful landing — rounded hero card, friendly oversized heading with highlighted accent word, blobby feature cards on pastel surfaces.',
      code: `import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Landing({ onNavigate }) {
  const features = [
    { title: 'Feature one', desc: 'Playful one-liner.', emoji: '✨' },
    { title: 'Feature two', desc: 'Playful one-liner.', emoji: '🎉' },
    { title: 'Feature three', desc: 'Playful one-liner.', emoji: '🌈' },
  ]
  return (
    <div data-testid="landing-page">
      <Navbar onNavigate={onNavigate} currentRoute="landing" />
      <main id="main-content" className="pt-8">
        <section className="max-w-6xl mx-auto px-6 pt-16 pb-24 text-center">
          <div className="inline-block px-4 py-1.5 rounded-full bg-[var(--accent)] text-[var(--primary-ink)] text-xs font-extrabold mb-8" data-testid="hero-badge">NEW · Just dropped</div>
          <h1
            className="text-6xl md:text-8xl font-black leading-[0.95] text-[var(--ink)] mb-8"
            style={{ fontFamily: 'var(--font-display)' }}
            data-testid="hero-headline"
          >{/* Builder: short friendly headline with ONE highlighted word */}Make <span className="inline-block px-4 py-1 rounded-2xl bg-[var(--primary)] text-[var(--primary-ink)] -rotate-2">magic.</span></h1>
          <p className="text-xl text-[var(--ink-muted)] max-w-xl mx-auto mb-10" data-testid="hero-subtitle">{/* Builder: friendly subhead */}Short, cheerful sentence about the value.</p>
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => onNavigate('signup')} data-testid="hero-primary-cta" className="px-8 py-4 rounded-full bg-[var(--ink)] text-[var(--bg)] text-base font-extrabold transition-all hover:-translate-y-1 hover:shadow-2xl">Get started free →</button>
            <button onClick={() => onNavigate('features')} data-testid="hero-secondary-cta" className="px-8 py-4 rounded-full bg-[var(--surface)] text-[var(--ink)] text-base font-bold border border-[var(--border)] hover:-translate-y-1 transition-all">See a demo</button>
          </div>
        </section>
        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="aspect-[16/9] rounded-[2.5rem] bg-[var(--surface)] border border-[var(--border)] overflow-hidden" aria-hidden="true">
            {/* Builder: if components/assets.js has HERO_URL replace with <img src={HERO_URL} className="w-full h-full object-cover" /> */}
            <div className="w-full h-full bg-[var(--accent)] opacity-30" />
          </div>
        </section>
        <section className="max-w-6xl mx-auto px-6 py-20" data-testid="landing-features" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-4xl md:text-5xl font-black text-[var(--ink)] text-center mb-16" style={{ fontFamily: 'var(--font-display)' }}>Why you'll love it</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div key={i} className="p-8 rounded-3xl bg-[var(--surface)] border border-[var(--border)] hover:-translate-y-2 transition-transform" data-testid={'feature-card-' + i}>
                <div className="text-4xl mb-4" aria-hidden="true">{f.emoji}</div>
                <h3 className="text-2xl font-extrabold text-[var(--ink)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>{f.title}</h3>
                <p className="text-[var(--ink-muted)]">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="max-w-3xl mx-auto px-6 py-20 text-center" data-testid="landing-final-cta">
          <h2 className="text-5xl font-black text-[var(--ink)] mb-6" style={{ fontFamily: 'var(--font-display)' }}>Ready?</h2>
          <p className="text-[var(--ink-muted)] mb-8">Takes one minute.</p>
          <button onClick={() => onNavigate('signup')} className="px-10 py-5 rounded-full bg-[var(--primary)] text-[var(--primary-ink)] text-lg font-extrabold hover:-translate-y-1 hover:shadow-2xl transition-all" data-testid="landing-cta-final">Count me in 🎉</button>
        </section>
      </main>
      <Footer onNavigate={onNavigate} />
    </div>
  )
}`,
    },
  },
}

/**
 * Allowed family ids. 'saas-clean' is the implicit baseline that uses
 * recipes.js as-is.
 */
export const FAMILY_IDS = ['saas-clean', 'editorial-serif', 'brutalist-raw', 'luxury-minimal', 'playful-illustrated']

/**
 * Short per-family descriptions the classifier prompt mentions.
 */
export const FAMILY_DESCRIPTIONS = {
  'saas-clean':          'Modern SaaS template — rounded corners, gradient accents, 3-column feature grid, standard glass navbar. Use when references look like a modern SaaS product, dashboard, or tool.',
  'editorial-serif':     'Magazine/editorial — display serif, generous whitespace, hairline separators, oversized headline, text-heavy. Use when references look like a publication, newsletter, agency site, or literary brand.',
  'brutalist-raw':       'Bold + raw — thick 2-3px borders, ALL-CAPS display, no radius, offset box-shadows, monospace. Use when references are loud, high-contrast, art-school, archive-style, or intentionally rough.',
  'luxury-minimal':      'Quiet luxury — generous whitespace, thin hairlines, serif display, lowercase labels, muted palette, tiny tracking. Use when references look like a fashion house, perfumery, high-end hospitality, or considered brand.',
  'playful-illustrated': 'Playful + friendly — rounded pills, chunky font weights, emoji accents, pastel surfaces, bouncy microanimations. Use when references look like consumer apps for kids, wellness, social, or anything cheerful.',
}

/**
 * Return the variant recipe for a given family + recipeId, or null if the
 * family doesn't override that recipe (caller falls back to baseline).
 */
export function familyVariant(familyId, recipeId) {
  if (!familyId || familyId === 'saas-clean') return null
  return FAMILY_VARIANTS[familyId]?.[recipeId] || null
}
