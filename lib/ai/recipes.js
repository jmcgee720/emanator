// ══════════════════════════════════════════════════════════════════════
// ── RECIPE LIBRARY ──
// Pre-verified templates the builder adapts instead of inventing from
// scratch. Each recipe is a Tailwind-only, React-globals-compatible JSX
// string that runs inside PreviewTab.jsx's Babel runtime.
//
// RULES recipes must follow:
//  - No `import React` (React is global in the preview runtime)
//  - Relative local imports only (`../components/...`). No react-router.
//  - Only Tailwind classes + inline SVG. No external icon packages.
//  - Every interactive element has a data-testid.
//  - Auth/persistence goes through AuthContext + MockAPIProvider.
//
// The builder prompt injects the relevant recipe(s) as reference code.
// The LLM is instructed to adapt styling/copy to the brand while keeping
// the logic identical. This is what keeps auth/signup/pricing consistent
// across every generated app.
// ══════════════════════════════════════════════════════════════════════

export const RECIPES = {
  // ── AuthContext: mock auth with localStorage persistence ──
  auth_context: {
    name: 'AuthContext',
    file: 'components/AuthContext.jsx',
    description: 'Mock auth provider. Exposes {user, signup, login, logout, isAuthenticated} via useAuth().',
    code: `const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('auth:user') : null
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })

  const persist = (u) => {
    setUser(u)
    try {
      if (u) localStorage.setItem('auth:user', JSON.stringify(u))
      else localStorage.removeItem('auth:user')
    } catch {}
  }

  const signup = async ({ email, password, name }) => {
    if (!email || !password) throw new Error('Email and password required')
    const u = { id: 'u_' + Date.now(), email, name: name || email.split('@')[0], createdAt: new Date().toISOString() }
    persist(u)
    return u
  }

  const login = async ({ email, password }) => {
    if (!email || !password) throw new Error('Email and password required')
    const existing = user && user.email === email ? user : null
    const u = existing || { id: 'u_' + Date.now(), email, name: email.split('@')[0], createdAt: new Date().toISOString() }
    persist(u)
    return u
  }

  const logout = () => persist(null)

  return React.createElement(AuthContext.Provider, { value: { user, signup, login, logout, isAuthenticated: !!user } }, children)
}

export function useAuth() {
  return useContext(AuthContext) || { user: null, isAuthenticated: false, signup: async () => {}, login: async () => {}, logout: () => {} }
}

export default AuthProvider`,
  },

  // ── MockAPIProvider: localStorage-backed in-memory CRUD ──
  mock_api: {
    name: 'MockAPIProvider',
    file: 'components/MockAPIProvider.jsx',
    description: 'In-memory CRUD store, persisted to localStorage, seeded with demo data per archetype.',
    code: `const MockAPIContext = createContext(null)

// Builder: replace SEED with archetype-appropriate demo data (5–10 realistic items per shape).
const SEED = {
  // Example: items: [{id:'i_1', name:'Example', createdAt:'2026-01-01'}]
}

function loadCollection(name, fallback) {
  try {
    const raw = localStorage.getItem('mockapi:' + name)
    if (raw) return JSON.parse(raw)
  } catch {}
  return fallback
}

function saveCollection(name, value) {
  try { localStorage.setItem('mockapi:' + name, JSON.stringify(value)) } catch {}
}

export function MockAPIProvider({ children }) {
  const [store, setStore] = useState(() => {
    const s = {}
    for (const key of Object.keys(SEED)) s[key] = loadCollection(key, SEED[key])
    return s
  })

  const update = (collection, nextValue) => {
    setStore((prev) => {
      const next = { ...prev, [collection]: nextValue }
      saveCollection(collection, nextValue)
      return next
    })
  }

  const api = useMemo(() => ({
    list: (collection) => store[collection] || [],
    get: (collection, id) => (store[collection] || []).find((x) => x.id === id) || null,
    create: (collection, item) => {
      const withId = { id: collection.slice(0, 1) + '_' + Date.now(), createdAt: new Date().toISOString(), ...item }
      const next = [...(store[collection] || []), withId]
      update(collection, next)
      return withId
    },
    patch: (collection, id, partial) => {
      const next = (store[collection] || []).map((x) => x.id === id ? { ...x, ...partial } : x)
      update(collection, next)
      return next.find((x) => x.id === id) || null
    },
    remove: (collection, id) => {
      const next = (store[collection] || []).filter((x) => x.id !== id)
      update(collection, next)
    },
  }), [store])

  return React.createElement(MockAPIContext.Provider, { value: api }, children)
}

export function useMockAPI() {
  return useContext(MockAPIContext) || { list: () => [], get: () => null, create: () => null, patch: () => null, remove: () => {} }
}

export default MockAPIProvider`,
  },

  // ── Root router (app/page.jsx) ──
  app_router: {
    name: 'App',
    file: 'app/page.jsx',
    description: 'Root route switcher. State-based routing; wraps app in AuthProvider + MockAPIProvider.',
    code: `import AuthProvider from '../components/AuthContext'
import MockAPIProvider from '../components/MockAPIProvider'
// Builder: add one import per page below, then one render line in the switch.

export default function App() {
  const [route, setRoute] = useState('landing')
  const [routeParams, setRouteParams] = useState({})
  const navigate = (to, params = {}) => { setRoute(to); setRouteParams(params); if (typeof window !== 'undefined') window.scrollTo(0, 0) }

  const renderRoute = () => {
    // Builder: generate one line per route, keys MUST match plan.routes[i].id
    // Example: if (route === 'landing') return <Landing onNavigate={navigate} params={routeParams} />
    return null
  }

  return (
    <AuthProvider>
      <MockAPIProvider>
        <div className="min-h-screen">
          {renderRoute()}
        </div>
      </MockAPIProvider>
    </AuthProvider>
  )
}`,
  },

  // ── Glass navbar ──
  navbar_glass: {
    name: 'Navbar',
    file: 'components/Navbar.jsx',
    description: 'Sticky glass navbar. Shows public links when logged out, app links + avatar when logged in.',
    code: `import { useAuth } from './AuthContext'

export default function Navbar({ onNavigate, currentRoute }) {
  const { user, isAuthenticated, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const publicLinks = [
    { id: 'landing', label: 'Home' },
    { id: 'features', label: 'Features' },
    { id: 'pricing', label: 'Pricing' },
  ]

  return (
    <nav className="sticky top-0 z-50 backdrop-blur-xl bg-black/40 border-b border-white/10" data-testid="navbar">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
        <button onClick={() => onNavigate('landing')} className="flex items-center gap-2" data-testid="navbar-brand">
          {/* Builder: replace with brand-appropriate SVG mark */}
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500" />
          <span className="font-semibold text-white">{/* Builder: BRAND NAME */}Brand</span>
        </button>
        <div className="hidden md:flex items-center gap-8">
          {publicLinks.map((l) => (
            <button key={l.id} onClick={() => onNavigate(l.id)} data-testid={'navbar-link-' + l.id}
              className={'text-sm transition-colors ' + (currentRoute === l.id ? 'text-white' : 'text-white/70 hover:text-white')}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <button onClick={() => onNavigate('dashboard')} data-testid="navbar-dashboard" className="text-sm text-white/70 hover:text-white">Dashboard</button>
              <button onClick={() => { logout(); onNavigate('landing') }} data-testid="navbar-logout" className="text-sm text-white/70 hover:text-white">Log out</button>
            </>
          ) : (
            <>
              <button onClick={() => onNavigate('login')} data-testid="navbar-login" className="text-sm text-white/70 hover:text-white">Log in</button>
              <button onClick={() => onNavigate('signup')} data-testid="navbar-signup" className="px-4 py-2 rounded-xl bg-white text-black text-sm font-medium hover:scale-105 transition-transform">Get started</button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}`,
  },

  // ── 4-column footer ──
  footer_4col: {
    name: 'Footer',
    file: 'components/Footer.jsx',
    description: '4-column footer. Brand + product + resources + legal.',
    code: `export default function Footer({ onNavigate }) {
  return (
    <footer className="border-t border-white/10 bg-black/60 mt-24" data-testid="footer">
      <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500" />
            <span className="font-semibold text-white">{/* Builder: BRAND */}Brand</span>
          </div>
          <p className="text-sm text-white/50">{/* Builder: one-line positioning statement */}Tagline here.</p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-white mb-3">Product</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><button onClick={() => onNavigate('features')} className="hover:text-white" data-testid="footer-features">Features</button></li>
            <li><button onClick={() => onNavigate('pricing')} className="hover:text-white" data-testid="footer-pricing">Pricing</button></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-medium text-white mb-3">Resources</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><a href="#" className="hover:text-white">Documentation</a></li>
            <li><a href="#" className="hover:text-white">Blog</a></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-medium text-white mb-3">Legal</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><a href="#" className="hover:text-white">Privacy</a></li>
            <li><a href="#" className="hover:text-white">Terms</a></li>
          </ul>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-6 border-t border-white/5 text-sm text-white/40">
        © 2026 {/* Builder: BRAND */}Brand. All rights reserved.
      </div>
    </footer>
  )
}`,
  },

  // ── Signup form ──
  signup_form: {
    name: 'Signup',
    file: 'pages/Signup.jsx',
    description: 'Email + password signup. Validates, creates mock user, routes to onboarding (or dashboard if archetype has none).',
    code: `import { useAuth } from '../components/AuthContext'
import Navbar from '../components/Navbar'

export default function Signup({ onNavigate, params }) {
  const { signup } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!email || !password) { setErr('Email and password are required'); return }
    if (!/^[^@]+@[^@]+\\.[^@]+$/.test(email)) { setErr('Enter a valid email'); return }
    if (password.length < 6) { setErr('Password must be at least 6 characters'); return }
    setLoading(true)
    try {
      await signup({ email, password, name })
      // Builder: if archetype has onboarding route, go to onboarding; else dashboard.
      onNavigate('onboarding')
    } catch (e2) { setErr(e2.message || 'Signup failed') } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen" data-testid="signup-page">
      <Navbar onNavigate={onNavigate} currentRoute="signup" />
      <div className="max-w-md mx-auto px-6 py-20">
        <h1 className="text-3xl font-semibold text-white mb-2">Create your account</h1>
        <p className="text-white/60 mb-8">{/* Builder: brand-specific pitch */}Start in under a minute.</p>
        <form onSubmit={submit} className="space-y-4 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8" data-testid="signup-form">
          <div>
            <label className="block text-sm text-white/70 mb-2">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="signup-name"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" placeholder="Jane Doe" />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-2">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="signup-email"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" placeholder="you@company.com" required />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-2">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="signup-password"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" placeholder="At least 6 characters" required />
          </div>
          {err ? <p className="text-sm text-red-400" data-testid="signup-error">{err}</p> : null}
          <button type="submit" disabled={loading} data-testid="signup-submit"
            className="w-full py-3 rounded-xl bg-white text-black font-medium hover:scale-[1.02] transition-transform disabled:opacity-60">
            {loading ? 'Creating…' : 'Create account'}
          </button>
          <p className="text-sm text-white/60 text-center">
            Already have an account?{' '}
            <button type="button" onClick={() => onNavigate('login')} className="text-white underline" data-testid="signup-login-link">Log in</button>
          </p>
        </form>
      </div>
    </div>
  )
}`,
  },

  // ── Login form ──
  login_form: {
    name: 'Login',
    file: 'pages/Login.jsx',
    description: 'Email + password login. Routes to dashboard on success. Offers signup + forgot password links.',
    code: `import { useAuth } from '../components/AuthContext'
import Navbar from '../components/Navbar'

export default function Login({ onNavigate }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!email || !password) { setErr('Email and password are required'); return }
    setLoading(true)
    try { await login({ email, password }); onNavigate('dashboard') }
    catch (e2) { setErr(e2.message || 'Login failed') } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen" data-testid="login-page">
      <Navbar onNavigate={onNavigate} currentRoute="login" />
      <div className="max-w-md mx-auto px-6 py-20">
        <h1 className="text-3xl font-semibold text-white mb-2">Welcome back</h1>
        <p className="text-white/60 mb-8">Log in to your account.</p>
        <form onSubmit={submit} className="space-y-4 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8" data-testid="login-form">
          <div>
            <label className="block text-sm text-white/70 mb-2">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" required />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-2">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" required />
          </div>
          {err ? <p className="text-sm text-red-400" data-testid="login-error">{err}</p> : null}
          <button type="submit" disabled={loading} data-testid="login-submit"
            className="w-full py-3 rounded-xl bg-white text-black font-medium hover:scale-[1.02] transition-transform disabled:opacity-60">
            {loading ? 'Signing in…' : 'Log in'}
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => onNavigate('forgot_password')} className="text-white/60 hover:text-white" data-testid="login-forgot-link">Forgot password?</button>
            <button type="button" onClick={() => onNavigate('signup')} className="text-white/60 hover:text-white" data-testid="login-signup-link">Create account</button>
          </div>
        </form>
      </div>
    </div>
  )
}`,
  },

  // ── Forgot password ──
  forgot_password_form: {
    name: 'ForgotPassword',
    file: 'pages/ForgotPassword.jsx',
    description: 'Email-only form. Shows success state on submit. Mock — does not actually send email.',
    code: `import Navbar from '../components/Navbar'

export default function ForgotPassword({ onNavigate }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  return (
    <div className="min-h-screen" data-testid="forgot-page">
      <Navbar onNavigate={onNavigate} currentRoute="forgot_password" />
      <div className="max-w-md mx-auto px-6 py-20">
        <h1 className="text-3xl font-semibold text-white mb-2">Reset password</h1>
        <p className="text-white/60 mb-8">We'll email you a reset link.</p>
        {sent ? (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 text-center" data-testid="forgot-success">
            <p className="text-white mb-4">If an account exists for <strong>{email}</strong>, we've sent reset instructions.</p>
            <button onClick={() => onNavigate('login')} className="text-white/70 hover:text-white" data-testid="forgot-back-login">Back to login</button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setSent(true) }} className="space-y-4 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8" data-testid="forgot-form">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="forgot-email"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" placeholder="you@company.com" />
            <button type="submit" className="w-full py-3 rounded-xl bg-white text-black font-medium hover:scale-[1.02] transition-transform" data-testid="forgot-submit">Send reset link</button>
          </form>
        )}
      </div>
    </div>
  )
}`,
  },

  // ── Onboarding (3-step wizard) ──
  onboarding_wizard: {
    name: 'Onboarding',
    file: 'pages/Onboarding.jsx',
    description: '3-step wizard. Last step routes to dashboard. Archetype-specific questions injected by builder.',
    code: `import { useAuth } from '../components/AuthContext'

export default function Onboarding({ onNavigate }) {
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const total = 3

  // Builder: replace labels + options with archetype-specific onboarding questions.
  const steps = [
    { title: 'Welcome' + (user?.name ? ', ' + user.name : '') + '!', body: 'Let\\'s get you set up in under a minute.' },
    { title: 'Tell us about your work', body: 'Pick the option that fits best.' },
    { title: 'You\\'re all set', body: 'Take a quick tour or jump straight in.' },
  ]

  const next = () => step < total - 1 ? setStep(step + 1) : onNavigate('dashboard')
  const back = () => step > 0 && setStep(step - 1)

  return (
    <div className="min-h-screen flex items-center justify-center px-6" data-testid="onboarding-page">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-8">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className={'h-1 flex-1 rounded-full ' + (i <= step ? 'bg-white' : 'bg-white/10')} />
          ))}
        </div>
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-10" data-testid="onboarding-card">
          <h2 className="text-2xl font-semibold text-white mb-3">{steps[step].title}</h2>
          <p className="text-white/60 mb-8">{steps[step].body}</p>
          <div className="flex items-center justify-between">
            <button onClick={back} disabled={step === 0} className="text-white/60 hover:text-white disabled:opacity-30" data-testid="onboarding-back">Back</button>
            <button onClick={next} className="px-6 py-3 rounded-xl bg-white text-black font-medium hover:scale-[1.02] transition-transform" data-testid="onboarding-next">
              {step < total - 1 ? 'Continue' : 'Go to dashboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}`,
  },

  // ── Pricing (3-tier) ──
  pricing_3tier: {
    name: 'Pricing',
    file: 'pages/Pricing.jsx',
    description: '3-tier pricing grid. Middle tier highlighted. CTAs route to signup with tier query param.',
    code: `import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Pricing({ onNavigate }) {
  // Builder: replace with archetype-appropriate tier names, prices, and feature bullets tied to brief features.
  const tiers = [
    { name: 'Free', price: '$0', period: '/mo', features: ['Feature one', 'Feature two', 'Feature three'], highlighted: false, cta: 'Start free' },
    { name: 'Pro', price: '$29', period: '/mo', features: ['Everything in Free', 'Feature four', 'Feature five', 'Priority support'], highlighted: true, cta: 'Start free trial' },
    { name: 'Enterprise', price: 'Custom', period: '', features: ['Everything in Pro', 'SSO', 'Dedicated support', 'SLA'], highlighted: false, cta: 'Talk to sales' },
  ]

  return (
    <div className="min-h-screen" data-testid="pricing-page">
      <Navbar onNavigate={onNavigate} currentRoute="pricing" />
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-semibold text-white mb-4">Pricing that scales with you</h1>
          <p className="text-white/60 text-lg">Start free. Upgrade when you need more.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((t) => (
            <div key={t.name} data-testid={'pricing-tier-' + t.name.toLowerCase()}
              className={'rounded-2xl p-8 border ' + (t.highlighted ? 'bg-white text-black border-white' : 'backdrop-blur-xl bg-white/5 border-white/10')}>
              {t.highlighted ? <div className="text-xs font-medium mb-4 inline-block px-3 py-1 rounded-full bg-black text-white">Most popular</div> : null}
              <h3 className={'text-xl font-semibold mb-2 ' + (t.highlighted ? 'text-black' : 'text-white')}>{t.name}</h3>
              <div className="mb-6">
                <span className={'text-5xl font-bold ' + (t.highlighted ? 'text-black' : 'text-white')}>{t.price}</span>
                <span className={t.highlighted ? 'text-black/60' : 'text-white/60'}>{t.period}</span>
              </div>
              <ul className="space-y-3 mb-8">
                {t.features.map((f) => (
                  <li key={f} className={'flex items-start gap-2 text-sm ' + (t.highlighted ? 'text-black/80' : 'text-white/80')}>
                    <span className="mt-0.5">✓</span><span>{f}</span>
                  </li>
                ))}
              </ul>
              <button onClick={() => onNavigate('signup', { tier: t.name.toLowerCase() })} data-testid={'pricing-cta-' + t.name.toLowerCase()}
                className={'w-full py-3 rounded-xl font-medium transition-transform hover:scale-[1.02] ' + (t.highlighted ? 'bg-black text-white' : 'bg-white text-black')}>
                {t.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
      <Footer onNavigate={onNavigate} />
    </div>
  )
}`,
  },

  // ── Dashboard empty state ──
  dashboard_empty_state: {
    name: 'Dashboard',
    file: 'pages/Dashboard.jsx',
    description: 'Post-login dashboard. Sidebar + main area with onboarding CTA cards. Uses real user name from AuthContext.',
    code: `import { useAuth } from '../components/AuthContext'

export default function Dashboard({ onNavigate }) {
  const { user, logout } = useAuth()
  // Builder: replace the 3 setup cards with archetype-appropriate getting-started steps.
  const setupCards = [
    { title: 'Complete your profile', desc: 'Add a name and avatar so teammates know you.', cta: 'Go to settings', to: 'settings' },
    { title: 'Create your first item', desc: 'This is where the core product value appears.', cta: 'Create', to: 'dashboard' },
    { title: 'Invite teammates', desc: 'Work is better together.', cta: 'Invite', to: 'settings' },
  ]

  return (
    <div className="min-h-screen flex" data-testid="dashboard-page">
      <aside className="w-60 border-r border-white/10 bg-black/60 p-4 hidden md:block">
        <div className="flex items-center gap-2 mb-8 px-2">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500" />
          <span className="text-white font-semibold">{/* Builder: BRAND */}Brand</span>
        </div>
        <nav className="space-y-1">
          <button onClick={() => onNavigate('dashboard')} className="w-full text-left px-3 py-2 rounded-lg bg-white/10 text-white text-sm" data-testid="sidebar-dashboard">Dashboard</button>
          <button onClick={() => onNavigate('settings')} className="w-full text-left px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 text-sm" data-testid="sidebar-settings">Settings</button>
        </nav>
        <button onClick={() => { logout(); onNavigate('landing') }} className="w-full text-left px-3 py-2 rounded-lg text-white/50 hover:text-white text-sm mt-8" data-testid="sidebar-logout">Log out</button>
      </aside>
      <main className="flex-1 p-10">
        <h1 className="text-3xl font-semibold text-white mb-2">Welcome{user?.name ? ', ' + user.name : ''}</h1>
        <p className="text-white/60 mb-10">Here are a few things to get you started.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {setupCards.map((c) => (
            <div key={c.title} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 hover:-translate-y-1 transition-transform" data-testid={'dashboard-card-' + c.title.toLowerCase().replace(/\\s+/g,'-')}>
              <h3 className="text-lg font-semibold text-white mb-2">{c.title}</h3>
              <p className="text-sm text-white/60 mb-4">{c.desc}</p>
              <button onClick={() => onNavigate(c.to)} className="text-sm text-white hover:underline">{c.cta} →</button>
            </div>
          ))}
        </div>
        <div className="mt-10 backdrop-blur-xl bg-white/5 border border-dashed border-white/20 rounded-2xl p-16 text-center" data-testid="dashboard-empty">
          <p className="text-white/50">No activity yet. Once you start using the product, it'll show up here.</p>
        </div>
      </main>
    </div>
  )
}`,
  },

  // ── Landing (hero + features + social proof + CTA) ──
  landing_page: {
    name: 'Landing',
    file: 'pages/Landing.jsx',
    description: 'Full landing: hero, social proof, features, CTA band. CTAs route to signup.',
    code: `import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Landing({ onNavigate }) {
  // Builder: replace features with the actual feature list from the brief.
  // Each should have a unique inline SVG icon + brand-specific copy.
  const features = [
    { title: 'Feature one', desc: 'Describe it in one sentence.' },
    { title: 'Feature two', desc: 'Describe it in one sentence.' },
    { title: 'Feature three', desc: 'Describe it in one sentence.' },
  ]

  return (
    <div className="min-h-screen" data-testid="landing-page">
      <Navbar onNavigate={onNavigate} currentRoute="landing" />
      <section className="max-w-7xl mx-auto px-6 pt-20 pb-32 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div>
          <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white mb-6" data-testid="hero-badge">
            {/* Builder: short positioning pill */}New
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white leading-tight mb-6" data-testid="hero-headline">
            {/* Builder: inject brief.heroHeadline here, bold + gradient accent on key word */}
            Headline goes here.
          </h1>
          <p className="text-xl text-white/70 mb-8" data-testid="hero-subtitle">
            {/* Builder: inject brief.keyMessaging */}Supporting sentence explaining the value.
          </p>
          <div className="flex gap-4">
            <button onClick={() => onNavigate('signup')} data-testid="hero-primary-cta"
              className="px-6 py-4 rounded-xl bg-white text-black font-medium hover:scale-105 transition-transform">Start free</button>
            <button onClick={() => onNavigate('features')} data-testid="hero-secondary-cta"
              className="px-6 py-4 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-colors">See how it works</button>
          </div>
        </div>
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 aspect-square flex items-center justify-center">
          {/* Builder: replace with product-hint mockup SVG or card grid */}
          <div className="w-full h-full rounded-2xl bg-gradient-to-br from-violet-500/30 to-indigo-500/30" />
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-16 border-y border-white/10" data-testid="landing-social-proof">
        <p className="text-center text-sm text-white/50 mb-8">Trusted by teams at</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 opacity-60">
          {['Logoipsum', 'Brandmark', 'Companyco', 'Teamname'].map((l) => (
            <div key={l} className="text-center text-white/70 font-medium">{l}</div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-24" data-testid="landing-features">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-semibold text-white mb-4">Everything you need</h2>
          <p className="text-white/60 text-lg">No bloat. Just the essentials done right.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div key={i} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 hover:-translate-y-1 transition-transform" data-testid={'feature-card-' + i}>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-white/60">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-24 text-center" data-testid="landing-final-cta">
        <h2 className="text-4xl font-semibold text-white mb-4">Ready to get started?</h2>
        <p className="text-white/60 mb-8">Free for as long as you want. Upgrade when you need more.</p>
        <button onClick={() => onNavigate('signup')} className="px-8 py-4 rounded-xl bg-white text-black font-medium hover:scale-105 transition-transform" data-testid="landing-cta-final">Start free</button>
      </section>

      <Footer onNavigate={onNavigate} />
    </div>
  )
}`,
  },

  // ── Settings page ──
  settings_page: {
    name: 'Settings',
    file: 'pages/Settings.jsx',
    description: 'Settings page: profile form (name/email) + preferences toggles + danger zone logout. Persists via useAuth().',
    code: `import { useAuth } from '../components/AuthContext'

export default function Settings({ onNavigate }) {
  const { user, logout } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [saved, setSaved] = useState(false)
  const [notifications, setNotifications] = useState(true)
  const [marketingEmails, setMarketingEmails] = useState(false)

  const save = (e) => {
    e.preventDefault()
    try {
      const cur = JSON.parse(localStorage.getItem('auth:user') || '{}')
      localStorage.setItem('auth:user', JSON.stringify({ ...cur, name, email }))
    } catch {}
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="min-h-screen flex" data-testid="settings-page">
      <aside className="w-60 border-r border-white/10 bg-black/60 p-4 hidden md:block">
        <nav className="space-y-1">
          <button onClick={() => onNavigate('dashboard')} className="w-full text-left px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 text-sm" data-testid="settings-sidebar-dashboard">Dashboard</button>
          <button className="w-full text-left px-3 py-2 rounded-lg bg-white/10 text-white text-sm" data-testid="settings-sidebar-settings">Settings</button>
        </nav>
      </aside>
      <main className="flex-1 p-10 max-w-3xl">
        <h1 className="text-3xl font-semibold text-white mb-2">Settings</h1>
        <p className="text-white/60 mb-10">Manage your profile and preferences.</p>
        <section className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 mb-6" data-testid="settings-profile-section">
          <h2 className="text-xl font-semibold text-white mb-6">Profile</h2>
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="block text-sm text-white/70 mb-2">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} data-testid="settings-name" className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" />
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-2">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="settings-email" className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" data-testid="settings-save" className="px-5 py-2.5 rounded-xl bg-white text-black text-sm font-medium hover:scale-[1.02] transition-transform">Save changes</button>
              {saved ? <span className="text-sm text-emerald-400" data-testid="settings-saved">Saved</span> : null}
            </div>
          </form>
        </section>
        <section className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 mb-6" data-testid="settings-prefs-section">
          <h2 className="text-xl font-semibold text-white mb-6">Preferences</h2>
          <div className="space-y-4">
            {[
              { label: 'Email notifications', desc: 'Get notified about activity on your account.', value: notifications, set: setNotifications, testid: 'toggle-notifications' },
              { label: 'Marketing emails', desc: 'Tips, updates, and product news.', value: marketingEmails, set: setMarketingEmails, testid: 'toggle-marketing' },
            ].map((t) => (
              <label key={t.label} className="flex items-start justify-between gap-6 cursor-pointer">
                <div>
                  <div className="text-sm text-white">{t.label}</div>
                  <div className="text-xs text-white/50">{t.desc}</div>
                </div>
                <button type="button" onClick={() => t.set(!t.value)} data-testid={t.testid} className={'relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ' + (t.value ? 'bg-violet-500' : 'bg-white/10')}>
                  <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ' + (t.value ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
              </label>
            ))}
          </div>
        </section>
        <section className="rounded-2xl p-8 border border-red-500/20 bg-red-500/5" data-testid="settings-danger-section">
          <h2 className="text-xl font-semibold text-red-300 mb-2">Danger zone</h2>
          <p className="text-sm text-white/50 mb-4">Log out of this session.</p>
          <button onClick={() => { logout(); onNavigate('landing') }} data-testid="settings-logout" className="px-5 py-2.5 rounded-xl border border-red-500/30 text-red-300 text-sm font-medium hover:bg-red-500/10 transition-colors">Log out</button>
        </section>
      </main>
    </div>
  )
}`,
  },

  // ── Data table (reusable) ──
  data_table: {
    name: 'DataTable',
    file: 'components/DataTable.jsx',
    description: 'Reusable data table: column sort, inline search, empty state, row click. Drop into any list page.',
    code: `export default function DataTable({ rows, columns, onRowClick, emptyMessage, searchPlaceholder }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const filtered = useMemo(() => {
    let out = rows || []
    const q = query.trim().toLowerCase()
    if (q) out = out.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)))
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        if (av == null) return 1
        if (bv == null) return -1
        const cmp = av > bv ? 1 : av < bv ? -1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }, [rows, columns, query, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  return (
    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden" data-testid="data-table">
      <div className="p-4 border-b border-white/10">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder || 'Search…'} className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/30" data-testid="data-table-search" />
      </div>
      {filtered.length === 0 ? (
        <div className="p-12 text-center text-white/50" data-testid="data-table-empty">{emptyMessage || 'No results.'}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-white/10">
                {columns.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)} className="px-4 py-3 text-white/70 font-medium cursor-pointer hover:text-white select-none" data-testid={'data-table-col-' + c.key}>{c.label} {sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : null}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => onRowClick && onRowClick(r)} data-testid={'data-table-row-' + r.id} className={'border-b border-white/5 ' + (onRowClick ? 'cursor-pointer hover:bg-white/5' : '')}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3 text-white/80">{c.render ? c.render(r) : r[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}`,
  },

  // ── Chat interface ──
  chat_interface: {
    name: 'ChatInterface',
    file: 'components/ChatInterface.jsx',
    description: 'Chat UI: sidebar conversations + message thread + input. Mock streaming response. Persists via useMockAPI.',
    code: `import { useMockAPI } from './MockAPIProvider'
import { useAuth } from './AuthContext'

export default function ChatInterface({ onNavigate }) {
  const { user } = useAuth()
  const api = useMockAPI()
  const conversations = api.list('conversations') || []
  const [activeId, setActiveId] = useState(conversations[0]?.id || null)
  const [draft, setDraft] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const scrollRef = useRef(null)

  const messages = (api.list('messages') || []).filter((m) => m.conversationId === activeId)

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages.length, isThinking])

  const startNew = () => {
    const conv = api.create('conversations', { title: 'New chat', userId: user?.id })
    setActiveId(conv.id)
  }

  const send = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !activeId) return
    api.create('messages', { conversationId: activeId, role: 'user', content: text })
    setDraft('')
    setIsThinking(true)
    setTimeout(() => {
      api.create('messages', { conversationId: activeId, role: 'assistant', content: 'Got it — mock response to: ' + text.slice(0, 80) })
      setIsThinking(false)
    }, 900)
  }

  return (
    <div className="min-h-screen flex" data-testid="chat-interface">
      <aside className="w-64 border-r border-white/10 bg-black/60 p-3 hidden md:flex md:flex-col">
        <button onClick={startNew} data-testid="chat-new" className="mb-4 px-4 py-2.5 rounded-xl bg-white text-black text-sm font-medium hover:scale-[1.02] transition-transform">+ New chat</button>
        <div className="flex-1 overflow-y-auto space-y-1" data-testid="chat-conversations-list">
          {conversations.length === 0 ? (
            <p className="text-xs text-white/40 px-2">No conversations yet.</p>
          ) : conversations.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} data-testid={'chat-conv-' + c.id} className={'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ' + (activeId === c.id ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5')}>
              {c.title || 'Untitled'}
            </button>
          ))}
        </div>
      </aside>
      <main className="flex-1 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4" data-testid="chat-messages">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-white/40 text-sm">Start a conversation below.</div>
          ) : messages.map((m) => (
            <div key={m.id} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')} data-testid={'chat-msg-' + m.id}>
              <div className={'max-w-lg px-4 py-3 rounded-2xl ' + (m.role === 'user' ? 'bg-violet-500 text-white' : 'bg-white/5 border border-white/10 text-white/90')}>{m.content}</div>
            </div>
          ))}
          {isThinking ? (
            <div className="flex justify-start" data-testid="chat-thinking">
              <div className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white/50 text-sm">Thinking…</div>
            </div>
          ) : null}
        </div>
        <form onSubmit={send} className="p-4 border-t border-white/10 flex gap-3" data-testid="chat-input-form">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message…" className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/30" data-testid="chat-input" disabled={!activeId} />
          <button type="submit" disabled={!activeId || !draft.trim()} data-testid="chat-send" className="px-5 rounded-xl bg-white text-black font-medium hover:scale-[1.02] transition-transform disabled:opacity-40">Send</button>
        </form>
      </main>
    </div>
  )
}`,
  },
}

/**
 * Get the recipes relevant for a given build wave + archetype.
 * Builder uses this to inject only the recipes needed for the current wave.
 */
export function recipesForWave(waveId, archetypeId) {
  const base = {
    scaffold: ['auth_context', 'mock_api', 'app_router', 'navbar_glass', 'footer_4col'],
    public: ['landing_page', 'pricing_3tier'],
    auth: ['signup_form', 'login_form', 'forgot_password_form', 'onboarding_wizard'],
    app: ['dashboard_empty_state', 'settings_page'],
  }
  // landing_only archetype skips auth plumbing
  if (archetypeId === 'landing_only') {
    return (base[waveId] || []).filter((r) => !['auth_context', 'mock_api', 'signup_form', 'login_form', 'forgot_password_form', 'onboarding_wizard', 'dashboard_empty_state', 'settings_page'].includes(r))
  }
  // AI and chat archetypes benefit from the chat recipe in the app wave
  if ((archetypeId === 'ai_app' || archetypeId === 'chat_app') && waveId === 'app') {
    return [...(base.app || []), 'chat_interface']
  }
  // Dashboard-heavy archetypes benefit from the data_table recipe in the app wave
  if (['crm', 'dashboard_internal', 'marketplace', 'ecommerce', 'booking', 'productivity'].includes(archetypeId) && waveId === 'app') {
    return [...(base.app || []), 'data_table']
  }
  return base[waveId] || []
}

/**
 * Format recipes as a single prompt-ready string for injection into the
 * builder's system message.
 */
export function formatRecipesForPrompt(recipeIds) {
  const selected = recipeIds.map((id) => RECIPES[id]).filter(Boolean)
  if (selected.length === 0) return ''
  return selected
    .map((r) => `// ── Recipe: ${r.name} (${r.file}) ──\n// ${r.description}\n\n${r.code}`)
    .join('\n\n// ════════════════════════════════════════════════════════════\n\n')
}
