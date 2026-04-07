// Pre-built project templates for one-click cloning
// 25 Templates: 5 per category (Marketing, Business, Personal, Content, Commerce)

export const PROJECT_TEMPLATES = [

  // ═══════════════════════════════════════════
  //  MARKETING TEMPLATES
  // ═══════════════════════════════════════════

  {
    id: 'saas-landing',
    name: 'SaaS Landing Page',
    description: 'Hero section with pricing tiers, testimonials, and email CTA',
    category: 'Marketing',
    icon: 'Rocket',
    color: '#00E5FF',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function SaasLanding() {
  const [email, setEmail] = useState('')

  const features = [
    { title: 'Lightning Fast', desc: 'Edge-first architecture for sub-100ms responses', icon: '\u26A1' },
    { title: 'Fully Responsive', desc: 'Beautiful on every device and screen size', icon: '\uD83D\uDCF1' },
    { title: 'SEO Optimized', desc: 'Built-in best practices for search visibility', icon: '\uD83D\uDD0D' },
    { title: 'Real-time Analytics', desc: 'Understand your audience with live dashboards', icon: '\uD83D\uDCCA' },
    { title: 'Team Collaboration', desc: 'Built for teams with role-based access', icon: '\uD83D\uDC65' },
    { title: '24/7 Support', desc: 'Round-the-clock help when you need it', icon: '\uD83D\uDEE1\uFE0F' },
  ]

  const plans = [
    { name: 'Starter', price: 0, features: ['1 Project', '1K API calls/mo', 'Community support'], cta: 'Get Started Free' },
    { name: 'Pro', price: 29, features: ['Unlimited Projects', '100K API calls/mo', 'Priority support', 'Custom domains'], cta: 'Start Pro Trial', popular: true },
    { name: 'Enterprise', price: 99, features: ['Everything in Pro', 'Unlimited API calls', 'SSO & SAML', 'Dedicated CSM', 'SLA guarantee'], cta: 'Contact Sales' },
  ]

  const testimonials = [
    { name: 'Sarah Chen', role: 'CTO, TechFlow', text: 'Reduced our development time by 60%. The API is incredibly well-designed.' },
    { name: 'Marcus Rivera', role: 'Founder, DataPulse', text: 'Best developer experience I have encountered. Our team shipped 3x faster.' },
    { name: 'Emily Zhao', role: 'Lead Engineer, Nexus', text: 'The analytics alone paid for the subscription within the first week.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0A0E17 0%, #0C1020 50%, #0A0E17 100%)', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 800, background: 'linear-gradient(90deg, #00E5FF, #6366F1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>YourSaaS</div>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <a href="#features" style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Features</a>
          <a href="#pricing" style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Pricing</a>
          <button style={{ padding: '10px 24px', borderRadius: 999, fontSize: 14, fontWeight: 600, background: 'linear-gradient(135deg, #00E5FF, #6366F1)', border: 'none', color: 'white', cursor: 'pointer' }}>Get Started</button>
        </div>
      </nav>

      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 40px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '6px 16px', borderRadius: 999, fontSize: 12, fontWeight: 500, background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', color: '#00E5FF', marginBottom: 32 }}>Now in Beta \u2014 Try it free</div>
        <h1 style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1, marginBottom: 24 }}>
          Build Something<br />
          <span style={{ background: 'linear-gradient(90deg, #00E5FF, #A78BFA, #EC4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Extraordinary</span>
        </h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', maxWidth: 560, margin: '0 auto 40px' }}>Ship faster with our developer-first platform. From prototype to production in minutes, not months.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={{ flex: 1, padding: '12px 16px', borderRadius: 12, fontSize: 14, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', outline: 'none' }} />
          <button style={{ padding: '12px 28px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'linear-gradient(135deg, #00E5FF, #6366F1)', border: 'none', color: 'white', cursor: 'pointer' }}>Start Free</button>
        </div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 12 }}>No credit card required \u2022 Free forever tier</p>
      </section>

      <section id="features" style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, textAlign: 'center', marginBottom: 48 }}>Everything You Need</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {features.map((f, i) => (
            <div key={i} style={{ padding: 28, borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 28, display: 'block', marginBottom: 12 }}>{f.icon}</span>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, textAlign: 'center', marginBottom: 48 }}>Simple Pricing</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {plans.map((p, i) => (
            <div key={i} style={{ padding: 32, borderRadius: 16, background: p.popular ? 'rgba(0,229,255,0.04)' : 'rgba(255,255,255,0.02)', border: p.popular ? '1px solid rgba(0,229,255,0.2)' : '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
              {p.popular && <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', padding: '4px 12px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: 'linear-gradient(135deg, #00E5FF, #6366F1)', color: 'white' }}>Most Popular</div>}
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{p.name}</h3>
              <div style={{ fontSize: 40, fontWeight: 800, marginBottom: 24 }}>\${p.price}<span style={{ fontSize: 14, fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>/mo</span></div>
              <ul style={{ listStyle: 'none', padding: 0, marginBottom: 24 }}>
                {p.features.map((f, j) => <li key={j} style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>\u2713 {f}</li>)}
              </ul>
              <button style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: p.popular ? 'linear-gradient(135deg, #00E5FF, #6366F1)' : 'rgba(255,255,255,0.06)', border: p.popular ? 'none' : '1px solid rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer' }}>{p.cta}</button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, textAlign: 'center', marginBottom: 48 }}>Loved by Developers</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {testimonials.map((t, i) => (
            <div key={i} style={{ padding: 28, borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, marginBottom: 16 }}>"{t.text}"</p>
              <p style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{t.role}</p>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ maxWidth: 1200, margin: '0 auto', padding: '40px', borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>\u00A9 2026 YourSaaS. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default SaasLanding`,
      },
    ],
  },

  {
    id: 'product-launch',
    name: 'Product Launch',
    description: 'Countdown timer, email capture, and feature showcase',
    category: 'Marketing',
    icon: 'Zap',
    color: '#F59E0B',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState, useEffect } from 'react'

function ProductLaunch() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const launchDate = new Date('2026-06-01T00:00:00')

  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      const diff = launchDate - now
      if (diff <= 0) { clearInterval(timer); return }
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const features = [
    { title: 'AI-Powered Insights', desc: 'Machine learning algorithms analyze your data in real-time', icon: '\uD83E\uDDE0' },
    { title: 'One-Click Deploy', desc: 'Ship to production with a single command', icon: '\uD83D\uDE80' },
    { title: 'Enterprise Security', desc: 'SOC 2 Type II compliant with end-to-end encryption', icon: '\uD83D\uDD12' },
    { title: 'Global CDN', desc: 'Content delivery from 200+ edge locations worldwide', icon: '\uD83C\uDF0D' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0F0A1A 0%, #1A0F2E 50%, #0F0A1A 100%)', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '6px 16px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B', marginBottom: 32 }}>Coming Soon</div>
        <h1 style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1, marginBottom: 20 }}>
          The Future of<br />
          <span style={{ background: 'linear-gradient(90deg, #F59E0B, #EC4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Product Development</span>
        </h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', maxWidth: 480, margin: '0 auto 48px' }}>Be the first to experience a new era of building. Join the waitlist for early access.</p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 48 }}>
          {[['days', timeLeft.days], ['hours', timeLeft.hours], ['minutes', timeLeft.minutes], ['seconds', timeLeft.seconds]].map(([label, val]) => (
            <div key={label} style={{ padding: '20px 16px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', minWidth: 80 }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#F59E0B' }}>{String(val).padStart(2, '0')}</div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        {submitted ? (
          <div style={{ padding: '16px 32px', borderRadius: 12, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', color: '#34D399', fontSize: 14, fontWeight: 500 }}>You are on the list! We will notify you at launch.</div>
        ) : (
          <div style={{ display: 'flex', gap: 12, maxWidth: 440, margin: '0 auto' }}>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email" style={{ flex: 1, padding: '14px 16px', borderRadius: 12, fontSize: 14, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', outline: 'none' }} />
            <button onClick={() => email && setSubmitted(true)} style={{ padding: '14px 28px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'linear-gradient(135deg, #F59E0B, #EC4899)', border: 'none', color: 'white', cursor: 'pointer' }}>Join Waitlist</button>
          </div>
        )}
      </div>

      <section style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
          {features.map((f, i) => (
            <div key={i} style={{ padding: 28, borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 28, display: 'block', marginBottom: 12 }}>{f.icon}</span>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default ProductLaunch`,
      },
    ],
  },

  {
    id: 'agency-site',
    name: 'Agency Website',
    description: 'Services, case studies, and team section',
    category: 'Marketing',
    icon: 'Building2',
    color: '#A78BFA',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function AgencySite() {
  const [activeCase, setActiveCase] = useState(0)

  const services = [
    { title: 'Brand Strategy', desc: 'We define your market position, voice, and visual identity from the ground up.', icon: '\uD83C\uDFAF' },
    { title: 'Web Development', desc: 'Custom-built applications and sites with modern technology stacks.', icon: '\uD83D\uDCBB' },
    { title: 'Growth Marketing', desc: 'Data-driven campaigns that generate qualified leads and revenue.', icon: '\uD83D\uDCC8' },
    { title: 'Product Design', desc: 'User-centered interfaces that drive engagement and conversion.', icon: '\uD83C\uDFA8' },
  ]

  const cases = [
    { client: 'Fintech Startup', result: '+340% user growth', desc: 'Redesigned onboarding flow and launched targeted acquisition campaigns.', tag: 'Growth' },
    { client: 'E-Commerce Brand', result: '2.8x revenue increase', desc: 'Full rebrand, new storefront, and omnichannel marketing strategy.', tag: 'Branding' },
    { client: 'Healthcare Platform', result: '98% satisfaction score', desc: 'Built HIPAA-compliant patient portal with intuitive UX.', tag: 'Development' },
  ]

  const team = [
    { name: 'Alex Morgan', role: 'Creative Director', color: '#A78BFA' },
    { name: 'Jordan Lee', role: 'Lead Developer', color: '#00E5FF' },
    { name: 'Sam Patel', role: 'Growth Strategist', color: '#34D399' },
    { name: 'Taylor Kim', role: 'UX Designer', color: '#F59E0B' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#090B11', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#A78BFA' }}>STUDIO</div>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          {['Services', 'Work', 'Team', 'Contact'].map(item => (
            <a key={item} href={'#' + item.toLowerCase()} style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>{item}</a>
          ))}
        </div>
      </nav>

      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 40px 80px' }}>
        <h1 style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05, maxWidth: 700 }}>We build brands that <span style={{ color: '#A78BFA' }}>stand out</span></h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', maxWidth: 500, marginTop: 24 }}>A full-service digital agency partnering with ambitious companies to create exceptional products and brands.</p>
      </section>

      <section id="services" style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 40px 80px' }}>
        <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 32 }}>Services</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
          {services.map((s, i) => (
            <div key={i} style={{ padding: 28, borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 32, display: 'block', marginBottom: 16 }}>{s.icon}</span>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{s.title}</h3>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="work" style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 40px 80px' }}>
        <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 32 }}>Case Studies</h2>
        <div style={{ display: 'flex', gap: 16 }}>
          {cases.map((c, i) => (
            <div key={i} onClick={() => setActiveCase(i)} style={{ flex: 1, padding: 28, borderRadius: 16, background: activeCase === i ? 'rgba(167,139,250,0.06)' : 'rgba(255,255,255,0.02)', border: activeCase === i ? '1px solid rgba(167,139,250,0.2)' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'all 0.2s' }}>
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.1)', color: '#A78BFA' }}>{c.tag}</span>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: '14px 0 6px' }}>{c.client}</h3>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#A78BFA', marginBottom: 10 }}>{c.result}</div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="team" style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 40px 80px' }}>
        <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 32 }}>Our Team</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
          {team.map((t, i) => (
            <div key={i} style={{ padding: 28, borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: t.color + '20', border: '2px solid ' + t.color + '40', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: t.color }}>{t.name[0]}</div>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</h3>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{t.role}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default AgencySite`,
      },
    ],
  },

  {
    id: 'newsletter-landing',
    name: 'Newsletter Landing',
    description: 'Email capture with social proof and benefits',
    category: 'Marketing',
    icon: 'Mail',
    color: '#34D399',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function NewsletterLanding() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)

  const benefits = [
    { title: 'Weekly Insights', desc: 'Curated industry trends delivered every Tuesday', icon: '\uD83D\uDCE7' },
    { title: 'Exclusive Research', desc: 'Original data and analysis you won\\'t find elsewhere', icon: '\uD83D\uDCCA' },
    { title: 'Expert Interviews', desc: 'Conversations with founders and industry leaders', icon: '\uD83C\uDF99\uFE0F' },
    { title: 'Actionable Tips', desc: 'Strategies you can implement immediately', icon: '\uD83D\uDCA1' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #021A18 0%, #0A1F1C 100%)', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '100px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: '#34D399', fontWeight: 600, marginBottom: 24 }}>The Insider Newsletter</div>
        <h1 style={{ fontSize: 48, fontWeight: 800, lineHeight: 1.1, marginBottom: 20 }}>Stay Ahead of the Curve</h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginBottom: 40, lineHeight: 1.6 }}>Join 15,000+ professionals who get our weekly digest of trends, strategies, and insights.</p>

        {subscribed ? (
          <div style={{ padding: '20px 32px', borderRadius: 16, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', color: '#34D399', fontSize: 15 }}>Welcome aboard! Check your inbox to confirm.</div>
        ) : (
          <div style={{ display: 'flex', gap: 10, maxWidth: 460, margin: '0 auto' }}>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ flex: 1, padding: '14px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: 14, outline: 'none' }} />
            <button onClick={() => email && setSubscribed(true)} style={{ padding: '14px 28px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: '#34D399', border: 'none', color: '#021A18', cursor: 'pointer' }}>Subscribe</button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 24 }}>
          {['Free forever', 'Unsubscribe anytime', 'No spam'].map(item => (
            <span key={item} style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>\u2713 {item}</span>
          ))}
        </div>
      </div>

      <section style={{ maxWidth: 700, margin: '0 auto', padding: '0 24px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {benefits.map((b, i) => (
            <div key={i} style={{ padding: 24, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 24, display: 'block', marginBottom: 10 }}>{b.icon}</span>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{b.title}</h3>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{b.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default NewsletterLanding`,
      },
    ],
  },

  {
    id: 'app-download',
    name: 'App Download Page',
    description: 'Mobile mockup, app store badges, and features list',
    category: 'Marketing',
    icon: 'Smartphone',
    color: '#EC4899',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React from 'react'

function AppDownload() {
  const features = [
    { title: 'Offline Mode', desc: 'Access everything without an internet connection' },
    { title: 'Push Notifications', desc: 'Stay updated with real-time alerts' },
    { title: 'Biometric Login', desc: 'Secure access with Face ID or fingerprint' },
    { title: 'Dark Mode', desc: 'Easy on the eyes, day and night' },
    { title: 'Cloud Sync', desc: 'Your data, everywhere, always up to date' },
    { title: 'Widgets', desc: 'Quick glance info right on your home screen' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #1A0526 0%, #0D0219 100%)', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#EC4899' }}>AppName</div>
        <button style={{ padding: '10px 24px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: '#EC4899', border: 'none', color: 'white', cursor: 'pointer' }}>Download</button>
      </nav>

      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 40px', display: 'flex', alignItems: 'center', gap: 80 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.1, marginBottom: 20 }}>Your Life,<br /><span style={{ color: '#EC4899' }}>Simplified</span></h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginBottom: 32, lineHeight: 1.6 }}>The all-in-one app that helps you organize, plan, and achieve more every day. Available on iOS and Android.</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={{ padding: '14px 24px', borderRadius: 12, fontSize: 13, fontWeight: 600, background: 'white', color: '#0D0219', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>\uF8FF App Store</button>
            <button style={{ padding: '14px 24px', borderRadius: 12, fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>\u25B6 Google Play</button>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 16 }}>4.9 stars \u2022 500K+ downloads \u2022 Free to start</p>
        </div>
        <div style={{ width: 240, height: 480, borderRadius: 32, background: 'linear-gradient(180deg, rgba(236,72,153,0.15), rgba(236,72,153,0.03))', border: '2px solid rgba(236,72,153,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>\uD83D\uDCF1</div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>App Preview</p>
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 40px 80px' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, textAlign: 'center', marginBottom: 40 }}>Everything in your pocket</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {features.map((f, i) => (
            <div key={i} style={{ padding: 24, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{f.title}</h3>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default AppDownload`,
      },
    ],
  },


  // ═══════════════════════════════════════════
  //  BUSINESS TEMPLATES
  // ═══════════════════════════════════════════

  {
    id: 'admin-dashboard',
    name: 'Admin Dashboard',
    description: 'KPIs, charts, data tables, and sidebar navigation',
    category: 'Business',
    icon: 'LayoutDashboard',
    color: '#6366F1',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function AdminDashboard() {
  const [sidebarItem, setSidebarItem] = useState('dashboard')

  const stats = [
    { label: 'Total Revenue', value: '$48,290', change: '+12.5%', up: true },
    { label: 'Active Users', value: '2,847', change: '+8.2%', up: true },
    { label: 'Conversion Rate', value: '3.24%', change: '-0.4%', up: false },
    { label: 'Avg Session', value: '4m 32s', change: '+1.1%', up: true },
  ]

  const recentOrders = [
    { id: '#3241', customer: 'Alice Johnson', amount: '$125.00', status: 'Completed', date: 'Jan 15' },
    { id: '#3240', customer: 'Bob Smith', amount: '$89.50', status: 'Processing', date: 'Jan 15' },
    { id: '#3239', customer: 'Carol White', amount: '$342.00', status: 'Completed', date: 'Jan 14' },
    { id: '#3238', customer: 'David Brown', amount: '$67.25', status: 'Pending', date: 'Jan 14' },
    { id: '#3237', customer: 'Eva Martinez', amount: '$198.00', status: 'Completed', date: 'Jan 13' },
  ]

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '\uD83D\uDCCA' },
    { id: 'orders', label: 'Orders', icon: '\uD83D\uDCE6' },
    { id: 'customers', label: 'Customers', icon: '\uD83D\uDC65' },
    { id: 'products', label: 'Products', icon: '\uD83C\uDFF7\uFE0F' },
    { id: 'analytics', label: 'Analytics', icon: '\uD83D\uDCC8' },
    { id: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
  ]

  const statusColor = (s) => {
    if (s === 'Completed') return { bg: 'rgba(52,211,153,0.1)', color: '#34D399' }
    if (s === 'Processing') return { bg: 'rgba(251,191,36,0.1)', color: '#FBBF24' }
    return { bg: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0B0E14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <aside style={{ width: 220, padding: '24px 16px', borderRight: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#6366F1', marginBottom: 32, paddingLeft: 8 }}>Admin</div>
        {navItems.map(item => (
          <div key={item.id} onClick={() => setSidebarItem(item.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, marginBottom: 4, cursor: 'pointer', background: sidebarItem === item.id ? 'rgba(99,102,241,0.08)' : 'transparent', color: sidebarItem === item.id ? '#6366F1' : 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: sidebarItem === item.id ? 600 : 400 }}>
            <span>{item.icon}</span> {item.label}
          </div>
        ))}
      </aside>

      <main style={{ flex: 1, padding: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 28 }}>Dashboard</h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ padding: 20, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{s.label}</p>
              <p style={{ fontSize: 24, fontWeight: 700 }}>{s.value}</p>
              <p style={{ fontSize: 11, marginTop: 4, color: s.up ? '#34D399' : '#F87171' }}>{s.change}</p>
            </div>
          ))}
        </div>

        <div style={{ borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Recent Orders</h2>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {['Order', 'Customer', 'Amount', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '12px 20px', fontSize: 13, fontWeight: 500 }}>{o.id}</td>
                  <td style={{ padding: '12px 20px', fontSize: 13 }}>{o.customer}</td>
                  <td style={{ padding: '12px 20px', fontSize: 13, fontWeight: 600 }}>{o.amount}</td>
                  <td style={{ padding: '12px 20px' }}><span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, ...statusColor(o.status) }}>{o.status}</span></td>
                  <td style={{ padding: '12px 20px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{o.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

export default AdminDashboard`,
      },
    ],
  },

  {
    id: 'crm-lite',
    name: 'CRM Lite',
    description: 'Contact list, pipeline board, and activity log',
    category: 'Business',
    icon: 'Users',
    color: '#00E5FF',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function CRMLite() {
  const [view, setView] = useState('pipeline')
  const stages = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed']
  const stageColors = ['#6366F1', '#00E5FF', '#F59E0B', '#EC4899', '#34D399']

  const contacts = [
    { name: 'Acme Corp', contact: 'John Doe', value: '$12,000', stage: 'Proposal', activity: '2h ago' },
    { name: 'TechFlow Inc', contact: 'Jane Smith', value: '$8,500', stage: 'Qualified', activity: '5h ago' },
    { name: 'DataPulse', contact: 'Mike Chen', value: '$25,000', stage: 'Negotiation', activity: '1d ago' },
    { name: 'Nexus AI', contact: 'Sarah Lee', value: '$15,000', stage: 'Lead', activity: '2d ago' },
    { name: 'CloudBase', contact: 'Tom Brown', value: '$32,000', stage: 'Closed', activity: '3d ago' },
    { name: 'ShipFast', contact: 'Amy Wu', value: '$6,200', stage: 'Lead', activity: '4h ago' },
    { name: 'GrowthLab', contact: 'Dan Miller', value: '$18,000', stage: 'Proposal', activity: '1d ago' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif", padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Pipeline</h1>
        <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3 }}>
          {['pipeline', 'list'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: view === v ? 'rgba(0,229,255,0.1)' : 'transparent', color: view === v ? '#00E5FF' : 'rgba(255,255,255,0.5)', border: 'none', cursor: 'pointer', textTransform: 'capitalize' }}>{v}</button>
          ))}
        </div>
      </div>

      {view === 'pipeline' ? (
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>
          {stages.map((stage, si) => (
            <div key={stage} style={{ minWidth: 240, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: stageColors[si] }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{stage}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>{contacts.filter(c => c.stage === stage).length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {contacts.filter(c => c.stage === stage).map((c, i) => (
                  <div key={i} style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{c.name}</p>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{c.contact}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: stageColors[si] }}>{c.value}</span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{c.activity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {['Company', 'Contact', 'Value', 'Stage', 'Last Activity'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{c.contact}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{c.value}</td>
                  <td style={{ padding: '12px 16px' }}><span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: stageColors[stages.indexOf(c.stage)] + '15', color: stageColors[stages.indexOf(c.stage)] }}>{c.stage}</span></td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{c.activity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default CRMLite`,
      },
    ],
  },

  {
    id: 'invoice-generator',
    name: 'Invoice Generator',
    description: 'Invoice form, line items, and PDF-ready preview',
    category: 'Business',
    icon: 'FileText',
    color: '#34D399',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function InvoiceGenerator() {
  const [items, setItems] = useState([
    { desc: 'Website Design', qty: 1, rate: 2500 },
    { desc: 'Frontend Development', qty: 40, rate: 150 },
    { desc: 'Hosting Setup', qty: 1, rate: 200 },
  ])
  const [client, setClient] = useState({ name: 'Acme Corp', email: 'billing@acme.com', address: '123 Business Ave' })
  const [invoiceNo, setInvoiceNo] = useState('INV-001')

  const addItem = () => setItems([...items, { desc: '', qty: 1, rate: 0 }])
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i))
  const updateItem = (i, field, val) => setItems(items.map((item, idx) => idx === i ? { ...item, [field]: field === 'desc' ? val : Number(val) } : item))
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.rate, 0)
  const tax = subtotal * 0.1
  const total = subtotal + tax

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif", padding: 40 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 40 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#34D399' }}>INVOICE</h1>
            <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', fontSize: 13, outline: 'none' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 13, fontWeight: 600 }}>Your Company</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>hello@yourcompany.com</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Date: {new Date().toLocaleDateString()}</p>
          </div>
        </div>

        <div style={{ padding: 20, borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 24 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>Bill To</p>
          <input value={client.name} onChange={e => setClient({ ...client, name: e.target.value })} placeholder="Client name" style={{ width: '100%', marginBottom: 6, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', fontSize: 13, outline: 'none' }} />
          <input value={client.email} onChange={e => setClient({ ...client, email: e.target.value })} placeholder="Client email" style={{ width: '100%', marginBottom: 6, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', fontSize: 13, outline: 'none' }} />
          <input value={client.address} onChange={e => setClient({ ...client, address: e.target.value })} placeholder="Client address" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', fontSize: 13, outline: 'none' }} />
        </div>

        <div style={{ borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Description', 'Qty', 'Rate', 'Amount', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '8px 14px' }}><input value={item.desc} onChange={e => updateItem(i, 'desc', e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'white', fontSize: 13, outline: 'none' }} /></td>
                  <td style={{ padding: '8px 14px', width: 80 }}><input type="number" value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'white', fontSize: 13, outline: 'none' }} /></td>
                  <td style={{ padding: '8px 14px', width: 100 }}><input type="number" value={item.rate} onChange={e => updateItem(i, 'rate', e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'white', fontSize: 13, outline: 'none' }} /></td>
                  <td style={{ padding: '8px 14px', width: 100, fontSize: 13, fontWeight: 600 }}>\${(item.qty * item.rate).toLocaleString()}</td>
                  <td style={{ padding: '8px 14px', width: 40 }}><button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: 14 }}>\u00D7</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '10px 14px' }}>
            <button onClick={addItem} style={{ fontSize: 12, color: '#34D399', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>+ Add Line Item</button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 260 }}>
            {[['Subtotal', subtotal], ['Tax (10%)', tax], ['Total', total]].map(([label, val], i) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <span style={{ fontSize: 13, color: i === 2 ? 'white' : 'rgba(255,255,255,0.5)', fontWeight: i === 2 ? 700 : 400 }}>{label}</span>
                <span style={{ fontSize: i === 2 ? 18 : 13, fontWeight: i === 2 ? 800 : 500, color: i === 2 ? '#34D399' : 'white' }}>\${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default InvoiceGenerator`,
      },
    ],
  },

  {
    id: 'project-tracker',
    name: 'Project Tracker',
    description: 'Kanban board with tasks, team assignments, and progress',
    category: 'Business',
    icon: 'KanbanSquare',
    color: '#F59E0B',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function ProjectTracker() {
  const [tasks, setTasks] = useState([
    { id: 1, title: 'Design system setup', assignee: 'AJ', column: 'done', priority: 'high' },
    { id: 2, title: 'API authentication', assignee: 'BK', column: 'in-progress', priority: 'high' },
    { id: 3, title: 'Database schema design', assignee: 'CL', column: 'in-progress', priority: 'medium' },
    { id: 4, title: 'User onboarding flow', assignee: 'AJ', column: 'todo', priority: 'medium' },
    { id: 5, title: 'Payment integration', assignee: 'BK', column: 'todo', priority: 'high' },
    { id: 6, title: 'Email notifications', assignee: 'CL', column: 'todo', priority: 'low' },
    { id: 7, title: 'Landing page copy', assignee: 'DM', column: 'review', priority: 'medium' },
    { id: 8, title: 'Unit test coverage', assignee: 'BK', column: 'review', priority: 'low' },
  ])

  const columns = [
    { id: 'todo', label: 'To Do', color: '#6366F1' },
    { id: 'in-progress', label: 'In Progress', color: '#F59E0B' },
    { id: 'review', label: 'Review', color: '#A78BFA' },
    { id: 'done', label: 'Done', color: '#34D399' },
  ]

  const priorityColors = { high: '#F87171', medium: '#FBBF24', low: '#6B7280' }
  const assigneeColors = { AJ: '#00E5FF', BK: '#A78BFA', CL: '#EC4899', DM: '#34D399' }

  const moveTask = (taskId, newCol) => setTasks(tasks.map(t => t.id === taskId ? { ...t, column: newCol } : t))

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif", padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sprint #14</h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{tasks.filter(t => t.column === 'done').length}/{tasks.length} tasks completed</p>
        </div>
        <div style={{ width: 200, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)' }}>
          <div style={{ width: (tasks.filter(t => t.column === 'done').length / tasks.length * 100) + '%', height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #34D399, #00E5FF)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        {columns.map(col => (
          <div key={col.id} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '0 4px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{col.label}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>{tasks.filter(t => t.column === col.id).length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tasks.filter(t => t.column === col.id).map(task => (
                <div key={task.id} style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 10 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3, flex: 1 }}>{task.title}</p>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: priorityColors[task.priority], flexShrink: 0, marginTop: 4, marginLeft: 8 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: (assigneeColors[task.assignee] || '#666') + '20', border: '1px solid ' + (assigneeColors[task.assignee] || '#666') + '40', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: assigneeColors[task.assignee] }}>{task.assignee}</div>
                    <select value={task.column} onChange={e => moveTask(task.id, e.target.value)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', outline: 'none' }}>
                      {columns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ProjectTracker`,
      },
    ],
  },

  {
    id: 'analytics-dashboard',
    name: 'Analytics Dashboard',
    description: 'Charts, filters, metrics, and export controls',
    category: 'Business',
    icon: 'BarChart3',
    color: '#EC4899',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function AnalyticsDashboard() {
  const [period, setPeriod] = useState('7d')

  const metrics = [
    { label: 'Page Views', value: '128,430', change: '+14.2%', up: true },
    { label: 'Unique Visitors', value: '42,180', change: '+8.7%', up: true },
    { label: 'Bounce Rate', value: '34.2%', change: '-2.1%', up: true },
    { label: 'Avg Duration', value: '3m 48s', change: '+0.5%', up: true },
  ]

  const topPages = [
    { page: '/', views: 45280, bounce: '28%' },
    { page: '/pricing', views: 23410, bounce: '35%' },
    { page: '/features', views: 18920, bounce: '31%' },
    { page: '/blog/ai-trends', views: 12840, bounce: '22%' },
    { page: '/docs/getting-started', views: 9760, bounce: '18%' },
  ]

  const sources = [
    { name: 'Organic Search', pct: 42, color: '#34D399' },
    { name: 'Direct', pct: 28, color: '#6366F1' },
    { name: 'Social Media', pct: 18, color: '#EC4899' },
    { name: 'Referral', pct: 8, color: '#F59E0B' },
    { name: 'Email', pct: 4, color: '#00E5FF' },
  ]

  const chartData = [65, 72, 58, 80, 92, 76, 88, 95, 82, 78, 90, 105, 98, 112]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif", padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Analytics</h1>
        <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3 }}>
          {['24h', '7d', '30d', '90d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 500, background: period === p ? 'rgba(236,72,153,0.1)' : 'transparent', color: period === p ? '#EC4899' : 'rgba(255,255,255,0.5)', border: 'none', cursor: 'pointer' }}>{p}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ padding: 20, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{m.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700 }}>{m.value}</p>
            <p style={{ fontSize: 11, marginTop: 4, color: m.up ? '#34D399' : '#F87171' }}>{m.change} vs prev period</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 24, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20 }}>Traffic Trend</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160 }}>
            {chartData.map((val, i) => (
              <div key={i} style={{ flex: 1, height: (val / Math.max(...chartData)) * 140, borderRadius: '4px 4px 0 0', background: 'linear-gradient(180deg, #EC4899, rgba(236,72,153,0.2))', opacity: 0.6 + (i / chartData.length) * 0.4 }} />
            ))}
          </div>
        </div>

        <div style={{ padding: 24, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20 }}>Traffic Sources</h2>
          {sources.map((s, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>{s.name}</span>
                <span style={{ fontWeight: 600 }}>{s.pct}%</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.04)' }}>
                <div style={{ width: s.pct + '%', height: '100%', borderRadius: 2, background: s.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600 }}>Top Pages</h2>
          <button style={{ fontSize: 11, color: '#EC4899', background: 'none', border: 'none', cursor: 'pointer' }}>Export CSV</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              {['Page', 'Views', 'Bounce Rate'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topPages.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <td style={{ padding: '12px 20px', fontSize: 13, fontWeight: 500, fontFamily: 'monospace' }}>{p.page}</td>
                <td style={{ padding: '12px 20px', fontSize: 13 }}>{p.views.toLocaleString()}</td>
                <td style={{ padding: '12px 20px', fontSize: 13 }}>{p.bounce}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default AnalyticsDashboard`,
      },
    ],
  },


  // ═══════════════════════════════════════════
  //  PERSONAL TEMPLATES
  // ═══════════════════════════════════════════

  {
    id: 'dev-portfolio',
    name: 'Developer Portfolio',
    description: 'Project cards, skills section, and GitHub-style activity',
    category: 'Personal',
    icon: 'Code2',
    color: '#A78BFA',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React from 'react'

function DevPortfolio() {
  const projects = [
    { name: 'AIChat', desc: 'Real-time AI chat with streaming responses', tech: ['React', 'Node.js', 'GPT-4'], stars: 234, color: '#00E5FF' },
    { name: 'DataViz', desc: 'Interactive data visualization library', tech: ['D3.js', 'TypeScript', 'Canvas'], stars: 189, color: '#A78BFA' },
    { name: 'CloudDeploy', desc: 'One-click deployment to any cloud provider', tech: ['Go', 'Docker', 'K8s'], stars: 412, color: '#34D399' },
    { name: 'PixelForge', desc: 'AI-powered image editing in the browser', tech: ['WebGL', 'WASM', 'Python'], stars: 156, color: '#F59E0B' },
  ]

  const skills = [
    { name: 'TypeScript', level: 95 }, { name: 'React', level: 92 }, { name: 'Node.js', level: 88 },
    { name: 'Python', level: 85 }, { name: 'Go', level: 72 }, { name: 'PostgreSQL', level: 80 },
    { name: 'Docker', level: 78 }, { name: 'AWS', level: 75 },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '80px 24px' }}>
        <div style={{ marginBottom: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #A78BFA, #6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800 }}>JD</div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 800 }}>Jane Developer</h1>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Full-Stack Engineer \u2022 Open Source Enthusiast</p>
            </div>
          </div>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, maxWidth: 600 }}>
            I build developer tools and open-source libraries. Passionate about clean code, great DX, and making complex things simple.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            {['GitHub', 'Twitter', 'LinkedIn'].map(l => (
              <a key={l} href="#" style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
        </div>

        <section style={{ marginBottom: 56 }}>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 20 }}>Featured Projects</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {projects.map((p, i) => (
              <div key={i} style={{ padding: 24, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</h3>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>\u2605 {p.stars}</span>
                </div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 14 }}>{p.desc}</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {p.tech.map(t => <span key={t} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: p.color + '12', color: p.color, border: '1px solid ' + p.color + '25' }}>{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 20 }}>Skills</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {skills.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, width: 90, color: 'rgba(255,255,255,0.6)' }}>{s.name}</span>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ width: s.level + '%', height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #A78BFA, #6366F1)' }} />
                </div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', width: 30 }}>{s.level}%</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default DevPortfolio`,
      },
    ],
  },

  {
    id: 'creative-portfolio',
    name: 'Creative Portfolio',
    description: 'Masonry gallery, case studies, and about section',
    category: 'Personal',
    icon: 'Palette',
    color: '#EC4899',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function CreativePortfolio() {
  const [filter, setFilter] = useState('all')

  const works = [
    { title: 'Brand Identity: Luxe', cat: 'branding', color: '#EC4899', tall: true },
    { title: 'Mobile App: FitTrack', cat: 'ui', color: '#00E5FF', tall: false },
    { title: 'Web: TechConf 2026', cat: 'web', color: '#A78BFA', tall: false },
    { title: 'Packaging: EcoBlend', cat: 'branding', color: '#34D399', tall: true },
    { title: 'Dashboard: FinPulse', cat: 'ui', color: '#F59E0B', tall: false },
    { title: 'Campaign: NightOwl', cat: 'branding', color: '#6366F1', tall: false },
    { title: 'Website: Artisan Co', cat: 'web', color: '#F87171', tall: true },
    { title: 'App: MindSpace', cat: 'ui', color: '#EC4899', tall: false },
  ]

  const filtered = filter === 'all' ? works : works.filter(w => w.cat === filter)

  return (
    <div style={{ minHeight: '100vh', background: '#090B11', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', padding: '24px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Studio <span style={{ color: '#EC4899' }}>K.</span></div>
        <div style={{ display: 'flex', gap: 24 }}>
          {['Work', 'About', 'Contact'].map(l => (
            <a key={l} href={'#' + l.toLowerCase()} style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>{l}</a>
          ))}
        </div>
      </nav>

      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '60px 40px' }}>
        <h1 style={{ fontSize: 48, fontWeight: 800, marginBottom: 12 }}>Creative Work</h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', marginBottom: 32 }}>Selected projects from branding, UI/UX, and web design.</p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
          {['all', 'branding', 'ui', 'web'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: filter === f ? 'rgba(236,72,153,0.1)' : 'rgba(255,255,255,0.03)', border: filter === f ? '1px solid rgba(236,72,153,0.2)' : '1px solid rgba(255,255,255,0.06)', color: filter === f ? '#EC4899' : 'rgba(255,255,255,0.5)', cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>

        <div style={{ columns: 2, gap: 16 }}>
          {filtered.map((w, i) => (
            <div key={i} style={{ breakInside: 'avoid', marginBottom: 16, padding: 0, borderRadius: 16, overflow: 'hidden', background: w.color + '08', border: '1px solid ' + w.color + '15', cursor: 'pointer' }}>
              <div style={{ height: w.tall ? 320 : 200, background: 'linear-gradient(135deg, ' + w.color + '15, ' + w.color + '05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: w.color + '20', border: '1px solid ' + w.color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{w.cat === 'branding' ? '\uD83C\uDFA8' : w.cat === 'ui' ? '\uD83D\uDCF1' : '\uD83C\uDF10'}</div>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>{w.title}</h3>
                <span style={{ fontSize: 10, color: w.color, textTransform: 'uppercase', letterSpacing: 1 }}>{w.cat}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="about" style={{ maxWidth: 700, margin: '0 auto', padding: '60px 40px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>About</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8 }}>
          I am a multidisciplinary designer with 8+ years of experience creating brands, interfaces, and digital experiences for startups and enterprises. I believe great design solves real problems while delighting users at every touchpoint.
        </p>
      </section>
    </div>
  )
}

export default CreativePortfolio`,
      },
    ],
  },

  {
    id: 'resume-cv',
    name: 'Resume / CV Page',
    description: 'Timeline, skills bars, education, and contact form',
    category: 'Personal',
    icon: 'FileUser',
    color: '#00E5FF',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React from 'react'

function ResumePage() {
  const experience = [
    { company: 'TechGlobal Inc.', role: 'Senior Engineer', period: '2024 - Present', desc: 'Leading a team of 8 engineers building the core platform. Shipped 3 major features that increased revenue by 40%.' },
    { company: 'StartupXYZ', role: 'Full-Stack Developer', period: '2022 - 2024', desc: 'Built the MVP from scratch. Scaled from 0 to 50K users. Implemented CI/CD and microservices architecture.' },
    { company: 'DigitalCraft Agency', role: 'Frontend Developer', period: '2020 - 2022', desc: 'Developed responsive web applications for 20+ clients across e-commerce, SaaS, and media sectors.' },
  ]

  const education = [
    { school: 'MIT', degree: 'M.S. Computer Science', year: '2020' },
    { school: 'UC Berkeley', degree: 'B.S. Computer Science', year: '2018' },
  ]

  const skills = [
    { name: 'JavaScript / TypeScript', level: 95 },
    { name: 'React / Next.js', level: 92 },
    { name: 'Python', level: 85 },
    { name: 'System Design', level: 88 },
    { name: 'Team Leadership', level: 82 },
    { name: 'Cloud (AWS/GCP)', level: 78 },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'linear-gradient(135deg, #00E5FF, #6366F1)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800 }}>JD</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 4 }}>John Developer</h1>
          <p style={{ fontSize: 14, color: '#00E5FF', fontWeight: 500 }}>Senior Software Engineer</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>San Francisco, CA \u2022 john@dev.com \u2022 +1 (555) 123-4567</p>
        </div>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 20 }}>Experience</h2>
          {experience.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 20, marginBottom: 24, paddingLeft: 20, borderLeft: '2px solid rgba(0,229,255,0.2)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: -5, top: 4, width: 8, height: 8, borderRadius: '50%', background: '#00E5FF' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600 }}>{e.role}</h3>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{e.period}</span>
                </div>
                <p style={{ fontSize: 13, color: '#00E5FF', marginBottom: 6 }}>{e.company}</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{e.desc}</p>
              </div>
            </div>
          ))}
        </section>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 20 }}>Skills</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {skills.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, width: 160, color: 'rgba(255,255,255,0.6)' }}>{s.name}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.04)' }}>
                  <div style={{ width: s.level + '%', height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #00E5FF, #6366F1)' }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 20 }}>Education</h2>
          {education.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{e.degree}</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{e.school}</p>
              </div>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{e.year}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

export default ResumePage`,
      },
    ],
  },

  {
    id: 'link-in-bio',
    name: 'Link-in-Bio',
    description: 'Social links, featured content, and profile card',
    category: 'Personal',
    icon: 'LinkIcon',
    color: '#F59E0B',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React from 'react'

function LinkInBio() {
  const links = [
    { label: 'My Website', url: '#', color: '#6366F1', icon: '\uD83C\uDF10' },
    { label: 'Latest Blog Post', url: '#', color: '#00E5FF', icon: '\uD83D\uDCDD' },
    { label: 'YouTube Channel', url: '#', color: '#F87171', icon: '\u25B6\uFE0F' },
    { label: 'GitHub', url: '#', color: '#A78BFA', icon: '\uD83D\uDCBB' },
    { label: 'Newsletter', url: '#', color: '#34D399', icon: '\uD83D\uDCE7' },
    { label: 'Book a Call', url: '#', color: '#F59E0B', icon: '\uD83D\uDCC5' },
  ]

  const socials = ['Twitter', 'Instagram', 'LinkedIn', 'TikTok']

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #1A0F2E 0%, #0F0A1A 100%)', color: 'white', fontFamily: "'Inter', system-ui, sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'linear-gradient(135deg, #F59E0B, #EC4899)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, fontWeight: 800, border: '3px solid rgba(255,255,255,0.1)' }}>A</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>@alexcreator</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 28 }}>Designer, creator, builder of cool things</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
          {links.map((link, i) => (
            <a key={i} href={link.url} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', textDecoration: 'none', color: 'white', transition: 'all 0.2s' }}>
              <span style={{ fontSize: 18 }}>{link.icon}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, textAlign: 'left' }}>{link.label}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>\u2192</span>
            </a>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
          {socials.map(s => (
            <a key={s} href="#" style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>{s}</a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LinkInBio`,
      },
    ],
  },

  {
    id: 'personal-blog',
    name: 'Personal Blog',
    description: 'Article grid, categories, and dark mode reading',
    category: 'Personal',
    icon: 'BookOpen',
    color: '#34D399',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function PersonalBlog() {
  const [category, setCategory] = useState('all')
  const posts = [
    { title: 'Why I Switched to Rust for Backend Services', cat: 'engineering', date: 'Jan 15, 2026', readTime: '8 min', excerpt: 'After years of Python and Node, I made the leap to Rust. Here is what changed.' },
    { title: 'The Art of Writing Clean Commit Messages', cat: 'productivity', date: 'Jan 10, 2026', readTime: '5 min', excerpt: 'Good commits tell a story. Learn the patterns that make your git history readable.' },
    { title: 'Building My Home Lab: A Complete Guide', cat: 'engineering', date: 'Jan 5, 2026', readTime: '12 min', excerpt: 'From Proxmox to self-hosted services, heres everything I run at home.' },
    { title: 'My 2025 Reading List: 24 Books in Review', cat: 'life', date: 'Dec 28, 2025', readTime: '10 min', excerpt: 'The best books I read this year across tech, business, and fiction.' },
    { title: 'Understanding WebSocket vs SSE in 2026', cat: 'engineering', date: 'Dec 20, 2025', readTime: '7 min', excerpt: 'When to use WebSockets, when to use Server-Sent Events, and when neither.' },
    { title: 'Morning Routines That Actually Stick', cat: 'life', date: 'Dec 15, 2025', readTime: '4 min', excerpt: 'Forget the 5 AM club. Here is what works for real people with real schedules.' },
  ]

  const cats = ['all', 'engineering', 'productivity', 'life']
  const catColors = { engineering: '#00E5FF', productivity: '#F59E0B', life: '#EC4899' }
  const filtered = category === 'all' ? posts : posts.filter(p => p.cat === category)

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 740, margin: '0 auto', padding: '60px 24px' }}>
        <header style={{ marginBottom: 48 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>The Developer\\'s Journal</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Thoughts on engineering, productivity, and life.</p>
        </header>

        <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
          {cats.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: category === c ? 'rgba(52,211,153,0.1)' : 'transparent', border: category === c ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(255,255,255,0.06)', color: category === c ? '#34D399' : 'rgba(255,255,255,0.5)', cursor: 'pointer', textTransform: 'capitalize' }}>{c}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.map((post, i) => (
            <article key={i} style={{ padding: '24px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: (catColors[post.cat] || '#666') + '12', color: catColors[post.cat] || '#666', textTransform: 'capitalize' }}>{post.cat}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{post.date}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>\u2022 {post.readTime}</span>
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>{post.title}</h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{post.excerpt}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PersonalBlog`,
      },
    ],
  },


  // ═══════════════════════════════════════════
  //  CONTENT TEMPLATES
  // ═══════════════════════════════════════════

  {
    id: 'blog-platform',
    name: 'Blog Platform',
    description: 'Article cards, categories, newsletter signup',
    category: 'Content',
    icon: 'Newspaper',
    color: '#F59E0B',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function BlogPlatform() {
  const [email, setEmail] = useState('')
  const articles = [
    { title: 'The Rise of Edge Computing in 2026', cat: 'Technology', readTime: '6 min', featured: true, excerpt: 'How edge-first architectures are reshaping the way we build and deploy applications.', author: 'Tech Team' },
    { title: 'Design Systems That Scale', cat: 'Design', readTime: '8 min', featured: false, excerpt: 'Lessons from building a design system used by 200+ developers.', author: 'Sarah K.' },
    { title: '10 Productivity Hacks for Remote Teams', cat: 'Business', readTime: '5 min', featured: false, excerpt: 'Practical tips that actually work for distributed teams.', author: 'Mike R.' },
    { title: 'Understanding Large Language Models', cat: 'AI', readTime: '10 min', featured: false, excerpt: 'A non-technical guide to how LLMs work and why they matter.', author: 'AI Lab' },
    { title: 'The Future of No-Code Development', cat: 'Technology', readTime: '7 min', featured: false, excerpt: 'Why traditional developers should care about the no-code revolution.', author: 'Tech Team' },
    { title: 'Building Trust Through Transparent Design', cat: 'Design', readTime: '4 min', featured: false, excerpt: 'How design choices communicate trustworthiness to users.', author: 'Sarah K.' },
  ]

  const featured = articles.find(a => a.featured)
  const rest = articles.filter(a => !a.featured)

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>The <span style={{ color: '#F59E0B' }}>Pulse</span></div>
        <div style={{ display: 'flex', gap: 24 }}>
          {['Latest', 'Technology', 'Design', 'Business'].map(l => <a key={l} href="#" style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>{l}</a>)}
        </div>
      </nav>

      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 40px 24px' }}>
        {featured && (
          <div style={{ padding: 32, borderRadius: 16, background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02))', border: '1px solid rgba(245,158,11,0.15)', marginBottom: 32, cursor: 'pointer' }}>
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>Featured</span>
            <h2 style={{ fontSize: 28, fontWeight: 700, margin: '12px 0 8px' }}>{featured.title}</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>{featured.excerpt}</p>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{featured.author} \u2022 {featured.readTime}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {rest.map((a, i) => (
            <article key={i} style={{ padding: 24, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)' }}>{a.cat}</span>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: '10px 0 6px', lineHeight: 1.3 }}>{a.title}</h3>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5, marginBottom: 12 }}>{a.excerpt}</p>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{a.author} \u2022 {a.readTime}</span>
            </article>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Subscribe to The Pulse</h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>Weekly insights on tech, design, and business. No spam, ever.</p>
        <div style={{ display: 'flex', gap: 10, maxWidth: 400, margin: '0 auto' }}>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" style={{ flex: 1, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: 13, outline: 'none' }} />
          <button style={{ padding: '12px 24px', borderRadius: 10, background: '#F59E0B', border: 'none', color: '#0A0D14', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Subscribe</button>
        </div>
      </section>
    </div>
  )
}

export default BlogPlatform`,
      },
    ],
  },

  {
    id: 'docs-site',
    name: 'Documentation Site',
    description: 'Sidebar navigation, search bar, and code blocks',
    category: 'Content',
    icon: 'BookOpen',
    color: '#6366F1',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function DocsSite() {
  const [activePage, setActivePage] = useState('getting-started')
  const [search, setSearch] = useState('')

  const nav = [
    { section: 'Getting Started', items: [{ id: 'getting-started', label: 'Introduction' }, { id: 'installation', label: 'Installation' }, { id: 'quickstart', label: 'Quick Start' }] },
    { section: 'Core Concepts', items: [{ id: 'components', label: 'Components' }, { id: 'routing', label: 'Routing' }, { id: 'state', label: 'State Management' }] },
    { section: 'API Reference', items: [{ id: 'hooks', label: 'Hooks' }, { id: 'utils', label: 'Utilities' }] },
  ]

  const content = {
    'getting-started': { title: 'Introduction', body: 'Welcome to the documentation. This guide will help you get up and running quickly with our framework.\\n\\nOur framework is designed to be simple, fast, and developer-friendly. It provides everything you need to build modern web applications.' },
    'installation': { title: 'Installation', body: 'Install the package using your preferred package manager:', code: 'npm install @framework/core\\n# or\\nyarn add @framework/core' },
    'quickstart': { title: 'Quick Start', body: 'Create your first application in just a few lines:', code: 'import { createApp } from "@framework/core"\\n\\nconst app = createApp({\\n  root: "#app",\\n  routes: [\\n    { path: "/", component: HomePage },\\n    { path: "/about", component: AboutPage },\\n  ]\\n})\\n\\napp.mount()' },
  }

  const page = content[activePage] || content['getting-started']

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <aside style={{ width: 250, padding: '20px 16px', borderRight: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#6366F1', marginBottom: 16, paddingLeft: 8 }}>Framework</div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search docs..." style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', fontSize: 12, outline: 'none', marginBottom: 20 }} />
        {nav.map(section => (
          <div key={section.section} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: 'rgba(255,255,255,0.3)', marginBottom: 8, paddingLeft: 8 }}>{section.section}</p>
            {section.items.map(item => (
              <div key={item.id} onClick={() => setActivePage(item.id)} style={{ padding: '7px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: activePage === item.id ? 'rgba(99,102,241,0.08)' : 'transparent', color: activePage === item.id ? '#6366F1' : 'rgba(255,255,255,0.5)', fontWeight: activePage === item.id ? 600 : 400, marginBottom: 2 }}>{item.label}</div>
            ))}
          </div>
        ))}
      </aside>
      <main style={{ flex: 1, padding: '40px 60px', maxWidth: 800 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>{page.title}</h1>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8, whiteSpace: 'pre-line' }}>{page.body}</div>
        {page.code && (
          <pre style={{ marginTop: 20, padding: 20, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: '#A78BFA', overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre' }}>{page.code}</pre>
        )}
      </main>
    </div>
  )
}

export default DocsSite`,
      },
    ],
  },

  {
    id: 'recipe-collection',
    name: 'Recipe Collection',
    description: 'Recipe cards with filters, ingredients, and cook times',
    category: 'Content',
    icon: 'ChefHat',
    color: '#F87171',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function RecipeCollection() {
  const [filter, setFilter] = useState('all')
  const [selectedRecipe, setSelectedRecipe] = useState(null)

  const recipes = [
    { title: 'Spicy Miso Ramen', cat: 'dinner', time: '45 min', difficulty: 'Medium', ingredients: ['Ramen noodles', 'Miso paste', 'Soft-boiled egg', 'Chashu pork', 'Green onions', 'Nori'], color: '#F87171' },
    { title: 'Avocado Toast Supreme', cat: 'breakfast', time: '10 min', difficulty: 'Easy', ingredients: ['Sourdough bread', 'Avocado', 'Cherry tomatoes', 'Feta cheese', 'Microgreens', 'Chili flakes'], color: '#34D399' },
    { title: 'Berry Smoothie Bowl', cat: 'breakfast', time: '5 min', difficulty: 'Easy', ingredients: ['Mixed berries', 'Banana', 'Greek yogurt', 'Granola', 'Honey', 'Chia seeds'], color: '#A78BFA' },
    { title: 'Mediterranean Grain Bowl', cat: 'lunch', time: '25 min', difficulty: 'Easy', ingredients: ['Quinoa', 'Chickpeas', 'Cucumber', 'Cherry tomatoes', 'Feta', 'Olive oil'], color: '#F59E0B' },
    { title: 'Thai Green Curry', cat: 'dinner', time: '35 min', difficulty: 'Medium', ingredients: ['Coconut milk', 'Green curry paste', 'Chicken', 'Thai basil', 'Bamboo shoots', 'Rice'], color: '#00E5FF' },
    { title: 'Chocolate Lava Cake', cat: 'dessert', time: '20 min', difficulty: 'Hard', ingredients: ['Dark chocolate', 'Butter', 'Eggs', 'Sugar', 'Flour', 'Vanilla'], color: '#EC4899' },
  ]

  const cats = ['all', 'breakfast', 'lunch', 'dinner', 'dessert']
  const filtered = filter === 'all' ? recipes : recipes.filter(r => r.cat === filter)

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 24px' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>Recipe Collection</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>Simple, delicious recipes for every meal.</p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {cats.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, textTransform: 'capitalize', background: filter === c ? 'rgba(248,113,113,0.1)' : 'transparent', border: filter === c ? '1px solid rgba(248,113,113,0.2)' : '1px solid rgba(255,255,255,0.06)', color: filter === c ? '#F87171' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>{c}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {filtered.map((r, i) => (
            <div key={i} onClick={() => setSelectedRecipe(selectedRecipe === i ? null : i)} style={{ padding: 24, borderRadius: 14, background: selectedRecipe === i ? r.color + '08' : 'rgba(255,255,255,0.02)', border: selectedRecipe === i ? '1px solid ' + r.color + '30' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'all 0.2s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: r.color + '15', color: r.color, textTransform: 'capitalize' }}>{r.cat}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{r.time}</span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{r.title}</h3>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Difficulty: {r.difficulty}</p>
              {selectedRecipe === i && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>Ingredients</p>
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {r.ingredients.map((ing, j) => <li key={j} style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', padding: '2px 0' }}>\u2022 {ing}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default RecipeCollection`,
      },
    ],
  },

  {
    id: 'podcast-landing',
    name: 'Podcast Landing',
    description: 'Episode list, audio player, and subscribe links',
    category: 'Content',
    icon: 'Mic',
    color: '#A78BFA',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function PodcastLanding() {
  const [playing, setPlaying] = useState(null)

  const episodes = [
    { num: 42, title: 'The Future of AI-Assisted Development', guest: 'Sarah Chen, CTO of DevFlow', duration: '48 min', date: 'Jan 14, 2026' },
    { num: 41, title: 'Building a $10M ARR SaaS in 18 Months', guest: 'Marcus Rivera, Founder of Pluto', duration: '55 min', date: 'Jan 7, 2026' },
    { num: 40, title: 'Why TypeScript Won', guest: 'Emily Zhao, TC39 Member', duration: '42 min', date: 'Dec 31, 2025' },
    { num: 39, title: 'Remote Team Culture at Scale', guest: 'David Park, VP Eng at Nexus', duration: '38 min', date: 'Dec 24, 2025' },
    { num: 38, title: 'The State of Web Performance in 2026', guest: 'Alex Morgan, Core Web Vitals Lead', duration: '51 min', date: 'Dec 17, 2025' },
  ]

  const platforms = ['Apple Podcasts', 'Spotify', 'YouTube', 'RSS']

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0F0A1A 0%, #0A0D14 100%)', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ width: 80, height: 80, borderRadius: 20, background: 'linear-gradient(135deg, #A78BFA, #6366F1)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>\uD83C\uDF99\uFE0F</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>The Dev Podcast</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Weekly conversations with the people building the future of tech.</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 20 }}>
            {platforms.map(p => (
              <a key={p} href="#" style={{ fontSize: 11, padding: '6px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>{p}</a>
            ))}
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>Latest Episodes</h2>
          {episodes.map((ep, i) => (
            <div key={i} style={{ padding: 20, borderRadius: 14, background: playing === i ? 'rgba(167,139,250,0.06)' : 'rgba(255,255,255,0.02)', border: playing === i ? '1px solid rgba(167,139,250,0.2)' : '1px solid rgba(255,255,255,0.06)', marginBottom: 10, cursor: 'pointer' }} onClick={() => setPlaying(playing === i ? null : i)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(167,139,250,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, color: '#A78BFA' }}>
                  {playing === i ? '\u23F8' : '\u25B6'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#A78BFA', fontWeight: 600 }}>#{ep.num}</span>
                    <h3 style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{ep.title}</h3>
                  </div>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{ep.guest}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{ep.duration}</p>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{ep.date}</p>
                </div>
              </div>
              {playing === i && (
                <div style={{ marginTop: 14, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ width: '35%', height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #A78BFA, #6366F1)' }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PodcastLanding`,
      },
    ],
  },

  {
    id: 'course-platform',
    name: 'Course Platform',
    description: 'Lesson list, progress tracking, and video embed area',
    category: 'Content',
    icon: 'GraduationCap',
    color: '#34D399',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function CoursePlatform() {
  const [activeLesson, setActiveLesson] = useState(0)
  const [completedLessons, setCompletedLessons] = useState([0, 1, 2])

  const modules = [
    { title: 'Module 1: Foundations', lessons: [
      { title: 'Welcome & Course Overview', duration: '5 min' },
      { title: 'Setting Up Your Environment', duration: '12 min' },
      { title: 'Core Concepts Explained', duration: '18 min' },
    ]},
    { title: 'Module 2: Building Blocks', lessons: [
      { title: 'Components & Props', duration: '22 min' },
      { title: 'State Management Patterns', duration: '28 min' },
      { title: 'Working with APIs', duration: '20 min' },
    ]},
    { title: 'Module 3: Advanced Topics', lessons: [
      { title: 'Performance Optimization', duration: '25 min' },
      { title: 'Testing Strategies', duration: '30 min' },
      { title: 'Deployment & CI/CD', duration: '15 min' },
    ]},
  ]

  const allLessons = modules.flatMap(m => m.lessons)
  const totalLessons = allLessons.length
  const progress = Math.round((completedLessons.length / totalLessons) * 100)

  let lessonIndex = 0

  const toggleComplete = (idx) => {
    setCompletedLessons(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <aside style={{ width: 300, padding: '20px 16px', borderRight: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, paddingLeft: 8 }}>React Masterclass</h1>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 16, paddingLeft: 8 }}>{completedLessons.length}/{totalLessons} lessons completed</p>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', marginBottom: 20, marginLeft: 8, marginRight: 8 }}>
          <div style={{ width: progress + '%', height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #34D399, #00E5FF)', transition: 'width 0.3s' }} />
        </div>

        {modules.map((mod, mi) => (
          <div key={mi} style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, color: 'rgba(255,255,255,0.3)', marginBottom: 8, paddingLeft: 8 }}>{mod.title}</p>
            {mod.lessons.map((lesson, li) => {
              const idx = lessonIndex++
              const isActive = activeLesson === idx
              const isComplete = completedLessons.includes(idx)
              return (
                <div key={li} onClick={() => setActiveLesson(idx)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: isActive ? 'rgba(52,211,153,0.08)' : 'transparent', marginBottom: 2 }}>
                  <div onClick={(e) => { e.stopPropagation(); toggleComplete(idx) }} style={{ width: 18, height: 18, borderRadius: 6, background: isComplete ? '#34D399' : 'rgba(255,255,255,0.06)', border: isComplete ? 'none' : '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#0A0D14', fontWeight: 700, flexShrink: 0, cursor: 'pointer' }}>{isComplete ? '\u2713' : ''}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? '#34D399' : 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lesson.title}</p>
                  </div>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>{lesson.duration}</span>
                </div>
              )
            })}
          </div>
        ))}
      </aside>

      <main style={{ flex: 1, padding: 32 }}>
        <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(52,211,153,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 24, cursor: 'pointer' }}>\u25B6</div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Video Player Area</p>
          </div>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{allLessons[activeLesson]?.title}</h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Duration: {allLessons[activeLesson]?.duration}</p>
      </main>
    </div>
  )
}

export default CoursePlatform`,
      },
    ],
  },


  // ═══════════════════════════════════════════
  //  COMMERCE TEMPLATES
  // ═══════════════════════════════════════════

  {
    id: 'storefront',
    name: 'Storefront',
    description: 'Product grid, cart sidebar, and checkout flow',
    category: 'Commerce',
    icon: 'ShoppingBag',
    color: '#EC4899',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function Storefront() {
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)

  const products = [
    { id: 1, name: 'Minimal Desk Lamp', price: 89, cat: 'Lighting', color: '#F59E0B' },
    { id: 2, name: 'Ceramic Mug Set', price: 42, cat: 'Kitchen', color: '#A78BFA' },
    { id: 3, name: 'Leather Notebook', price: 35, cat: 'Stationery', color: '#34D399' },
    { id: 4, name: 'Wireless Charger', price: 59, cat: 'Tech', color: '#00E5FF' },
    { id: 5, name: 'Plant Pot (Medium)', price: 28, cat: 'Home', color: '#EC4899' },
    { id: 6, name: 'Canvas Tote Bag', price: 24, cat: 'Accessories', color: '#F87171' },
    { id: 7, name: 'Scented Candle', price: 32, cat: 'Home', color: '#FBBF24' },
    { id: 8, name: 'Desk Organizer', price: 48, cat: 'Stationery', color: '#6366F1' },
  ]

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id)
      if (existing) return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { ...product, qty: 1 }]
    })
  }

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.id !== id))
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Shop<span style={{ color: '#EC4899' }}>.</span></div>
        <button onClick={() => setShowCart(!showCart)} style={{ position: 'relative', padding: '8px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer', fontSize: 13 }}>
          Cart ({cart.reduce((s, i) => s + i.qty, 0)})
        </button>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 40px', display: 'flex', gap: 32 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>All Products</h1>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {products.map(p => (
              <div key={p.id} style={{ borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ height: 160, background: p.color + '08', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: p.color + '20', border: '1px solid ' + p.color + '30' }} />
                </div>
                <div style={{ padding: 16 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{p.name}</p>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>{p.cat}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>\${p.price}</span>
                    <button onClick={() => addToCart(p)} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: p.color + '15', border: '1px solid ' + p.color + '25', color: p.color, cursor: 'pointer' }}>Add</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {showCart && (
          <div style={{ width: 320, padding: 20, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', alignSelf: 'flex-start', position: 'sticky', top: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Your Cart</h2>
            {cart.length === 0 ? (
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Cart is empty</p>
            ) : (
              <>
                {cart.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</p>
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>x{item.qty}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>\${item.price * item.qty}</span>
                      <button onClick={() => removeFromCart(item.id)} style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: 14 }}>\u00D7</button>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Total</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#EC4899' }}>\${cartTotal}</span>
                </div>
                <button style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 10, background: '#EC4899', border: 'none', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Checkout</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Storefront`,
      },
    ],
  },

  {
    id: 'digital-products',
    name: 'Digital Products',
    description: 'Download cards, pricing tiers, and purchase flow',
    category: 'Commerce',
    icon: 'Download',
    color: '#6366F1',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function DigitalProducts() {
  const [selected, setSelected] = useState(null)

  const products = [
    { id: 1, name: 'UI Component Kit', desc: '200+ production-ready React components', price: 49, format: 'React + Figma', downloads: '2.4K', color: '#6366F1' },
    { id: 2, name: 'Icon Pack Pro', desc: '1,000+ hand-crafted SVG icons in 3 styles', price: 29, format: 'SVG + React', downloads: '5.1K', color: '#00E5FF' },
    { id: 3, name: 'Dashboard Templates', desc: '12 complete admin dashboard layouts', price: 79, format: 'Next.js', downloads: '1.8K', color: '#34D399' },
    { id: 4, name: 'Landing Page Pack', desc: '8 conversion-optimized landing pages', price: 39, format: 'React + Tailwind', downloads: '3.2K', color: '#F59E0B' },
    { id: 5, name: 'Email Template Kit', desc: '50+ responsive email templates', price: 35, format: 'HTML + MJML', downloads: '890', color: '#EC4899' },
    { id: 6, name: 'Motion Library', desc: 'Copy-paste animation presets for React', price: 19, format: 'React + Framer', downloads: '4.7K', color: '#A78BFA' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '60px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 12 }}>Digital Products</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>Premium resources for modern developers and designers.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {products.map(p => (
            <div key={p.id} onClick={() => setSelected(p.id)} style={{ borderRadius: 16, overflow: 'hidden', background: selected === p.id ? p.color + '08' : 'rgba(255,255,255,0.02)', border: selected === p.id ? '1px solid ' + p.color + '30' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'all 0.2s' }}>
              <div style={{ height: 120, background: 'linear-gradient(135deg, ' + p.color + '12, ' + p.color + '04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: p.color + '20', border: '1px solid ' + p.color + '30' }} />
              </div>
              <div style={{ padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{p.name}</h3>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 12, lineHeight: 1.5 }}>{p.desc}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{p.format}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{p.downloads} downloads</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 22, fontWeight: 800 }}>\${p.price}</span>
                  <button style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, background: p.color, border: 'none', color: 'white', cursor: 'pointer' }}>Buy Now</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DigitalProducts`,
      },
    ],
  },

  {
    id: 'restaurant-menu',
    name: 'Restaurant Menu',
    description: 'Menu sections, order cart, and reservation form',
    category: 'Commerce',
    icon: 'UtensilsCrossed',
    color: '#F59E0B',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function RestaurantMenu() {
  const [section, setSection] = useState('mains')
  const [order, setOrder] = useState([])

  const menu = {
    starters: [
      { name: 'Truffle Arancini', desc: 'Crispy risotto balls with black truffle', price: 14 },
      { name: 'Tuna Tartare', desc: 'Fresh tuna, avocado, citrus ponzu', price: 18 },
      { name: 'Burrata & Heirloom Tomato', desc: 'Creamy burrata, basil oil, flaky salt', price: 16 },
    ],
    mains: [
      { name: 'Wagyu Burger', desc: 'A5 wagyu patty, aged cheddar, brioche bun', price: 32 },
      { name: 'Pan-Seared Salmon', desc: 'Atlantic salmon, miso glaze, bok choy', price: 28 },
      { name: 'Mushroom Risotto', desc: 'Arborio rice, wild mushrooms, truffle oil', price: 24 },
      { name: 'Grilled Lamb Chops', desc: 'Herb-crusted, rosemary jus, roasted potatoes', price: 36 },
    ],
    desserts: [
      { name: 'Tiramisu', desc: 'Classic Italian, espresso-soaked ladyfingers', price: 12 },
      { name: 'Creme Brulee', desc: 'Madagascar vanilla, caramelized sugar', price: 11 },
      { name: 'Chocolate Fondant', desc: 'Warm center, vanilla bean ice cream', price: 14 },
    ],
  }

  const addToOrder = (item) => setOrder(prev => [...prev, item])
  const orderTotal = order.reduce((sum, i) => sum + i.price, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 4, color: '#F59E0B', fontWeight: 500, marginBottom: 8 }}>Est. 2020</p>
          <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 8 }}>The Golden Fork</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Modern European cuisine with a creative twist</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 32, background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, maxWidth: 360, margin: '0 auto 32px' }}>
          {['starters', 'mains', 'desserts'].map(s => (
            <button key={s} onClick={() => setSection(s)} style={{ flex: 1, padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, textTransform: 'capitalize', background: section === s ? 'rgba(245,158,11,0.1)' : 'transparent', color: section === s ? '#F59E0B' : 'rgba(255,255,255,0.5)', border: 'none', cursor: 'pointer' }}>{s}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 32 }}>
          <div style={{ flex: 1 }}>
            {menu[section].map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{item.name}</h3>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{item.desc}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>\${item.price}</span>
                  <button onClick={() => addToOrder(item)} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#F59E0B', cursor: 'pointer' }}>Add</button>
                </div>
              </div>
            ))}
          </div>

          {order.length > 0 && (
            <div style={{ width: 260, padding: 20, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', alignSelf: 'flex-start' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Your Order</h3>
              {order.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>{item.name}</span>
                  <span style={{ fontWeight: 600 }}>\${item.price}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontWeight: 600 }}>Total</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#F59E0B' }}>\${orderTotal}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RestaurantMenu`,
      },
    ],
  },

  {
    id: 'booking-system',
    name: 'Booking System',
    description: 'Service selection, date picker, and confirmation',
    category: 'Commerce',
    icon: 'Calendar',
    color: '#00E5FF',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function BookingSystem() {
  const [step, setStep] = useState(1)
  const [selectedService, setSelectedService] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTime, setSelectedTime] = useState(null)

  const services = [
    { id: 1, name: 'Consultation Call', duration: '30 min', price: 0, desc: 'Free introductory meeting', color: '#00E5FF' },
    { id: 2, name: 'Strategy Session', duration: '60 min', price: 150, desc: 'Deep dive into your project goals', color: '#A78BFA' },
    { id: 3, name: 'Workshop', duration: '2 hours', price: 400, desc: 'Hands-on collaborative session', color: '#34D399' },
    { id: 4, name: 'Full Day Engagement', duration: '8 hours', price: 1200, desc: 'Dedicated full-day sprint', color: '#F59E0B' },
  ]

  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i + 1)
    return { date: d, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), available: i % 7 !== 5 && i % 7 !== 6 }
  })

  const times = ['9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 600, padding: 32, borderRadius: 20, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: step >= s ? '#00E5FF' : 'rgba(255,255,255,0.06)' }} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Select a Service</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>Choose the type of session you need.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {services.map(s => (
                <div key={s.id} onClick={() => setSelectedService(s)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 12, background: selectedService?.id === s.id ? s.color + '08' : 'rgba(255,255,255,0.02)', border: selectedService?.id === s.id ? '1px solid ' + s.color + '30' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</p>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{s.desc} \u2022 {s.duration}</p>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.price === 0 ? 'Free' : '$' + s.price}</span>
                </div>
              ))}
            </div>
            <button onClick={() => selectedService && setStep(2)} disabled={!selectedService} style={{ width: '100%', marginTop: 20, padding: 12, borderRadius: 12, background: selectedService ? '#00E5FF' : 'rgba(255,255,255,0.06)', border: 'none', color: selectedService ? '#0A0D14' : 'rgba(255,255,255,0.3)', fontSize: 14, fontWeight: 600, cursor: selectedService ? 'pointer' : 'default' }}>Continue</button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Pick a Date & Time</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>Available slots for {selectedService?.name}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {dates.filter(d => d.available).slice(0, 8).map((d, i) => (
                <button key={i} onClick={() => setSelectedDate(d.label)} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: selectedDate === d.label ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.03)', border: selectedDate === d.label ? '1px solid rgba(0,229,255,0.3)' : '1px solid rgba(255,255,255,0.06)', color: selectedDate === d.label ? '#00E5FF' : 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>{d.label}</button>
              ))}
            </div>
            {selectedDate && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                {times.map(t => (
                  <button key={t} onClick={() => setSelectedTime(t)} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: selectedTime === t ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.03)', border: selectedTime === t ? '1px solid rgba(0,229,255,0.3)' : '1px solid rgba(255,255,255,0.06)', color: selectedTime === t ? '#00E5FF' : 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>{t}</button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(1)} style={{ flex: 1, padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Back</button>
              <button onClick={() => selectedDate && selectedTime && setStep(3)} disabled={!selectedDate || !selectedTime} style={{ flex: 2, padding: 12, borderRadius: 12, background: selectedDate && selectedTime ? '#00E5FF' : 'rgba(255,255,255,0.06)', border: 'none', color: selectedDate && selectedTime ? '#0A0D14' : 'rgba(255,255,255,0.3)', fontSize: 14, fontWeight: 600, cursor: selectedDate && selectedTime ? 'pointer' : 'default' }}>Confirm</button>
            </div>
          </>
        )}

        {step === 3 && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(52,211,153,0.1)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>\u2713</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Booking Confirmed!</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>Your {selectedService?.name} is booked.</p>
            <div style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left', marginBottom: 20 }}>
              <p style={{ fontSize: 13, marginBottom: 4 }}><span style={{ color: 'rgba(255,255,255,0.4)' }}>Service:</span> {selectedService?.name}</p>
              <p style={{ fontSize: 13, marginBottom: 4 }}><span style={{ color: 'rgba(255,255,255,0.4)' }}>Date:</span> {selectedDate}</p>
              <p style={{ fontSize: 13, marginBottom: 4 }}><span style={{ color: 'rgba(255,255,255,0.4)' }}>Time:</span> {selectedTime}</p>
              <p style={{ fontSize: 13 }}><span style={{ color: 'rgba(255,255,255,0.4)' }}>Price:</span> {selectedService?.price === 0 ? 'Free' : '$' + selectedService?.price}</p>
            </div>
            <button onClick={() => { setStep(1); setSelectedService(null); setSelectedDate(null); setSelectedTime(null) }} style={{ padding: '10px 24px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' }}>Book Another</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default BookingSystem`,
      },
    ],
  },

  {
    id: 'marketplace-listings',
    name: 'Marketplace',
    description: 'Listings with filters, seller profiles, and search',
    category: 'Commerce',
    icon: 'Store',
    color: '#34D399',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function Marketplace() {
  const [search, setSearch] = useState('')
  const [priceRange, setPriceRange] = useState('all')

  const listings = [
    { title: 'Vintage Camera Collection', seller: 'RetroFinds', price: 280, cat: 'Electronics', rating: 4.8, reviews: 42, location: 'Portland, OR', color: '#F59E0B' },
    { title: 'Handmade Ceramic Set', seller: 'ClayStudio', price: 95, cat: 'Home & Garden', rating: 4.9, reviews: 128, location: 'Austin, TX', color: '#A78BFA' },
    { title: 'Mechanical Keyboard Kit', seller: 'TypeLab', price: 165, cat: 'Electronics', rating: 4.7, reviews: 67, location: 'Seattle, WA', color: '#00E5FF' },
    { title: 'Artisan Coffee Beans (1lb)', seller: 'BeanOrigin', price: 24, cat: 'Food', rating: 4.6, reviews: 256, location: 'Brooklyn, NY', color: '#34D399' },
    { title: 'Wooden Desk Shelf', seller: 'WoodCraft', price: 145, cat: 'Home & Garden', rating: 4.5, reviews: 34, location: 'Denver, CO', color: '#EC4899' },
    { title: 'Custom Sneaker Art', seller: 'SoleArtist', price: 200, cat: 'Fashion', rating: 5.0, reviews: 89, location: 'Los Angeles, CA', color: '#F87171' },
  ]

  const ranges = { all: [0, Infinity], under50: [0, 50], '50-150': [50, 150], '150+': [150, Infinity] }
  const [lo, hi] = ranges[priceRange]
  const filtered = listings.filter(l => l.price >= lo && l.price < hi && (search === '' || l.title.toLowerCase().includes(search.toLowerCase())))

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D14', color: 'white', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 20 }}>Marketplace</h1>

        <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search listings..." style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', fontSize: 13, outline: 'none' }} />
          <select value={priceRange} onChange={e => setPriceRange(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontSize: 13, outline: 'none' }}>
            <option value="all">All Prices</option>
            <option value="under50">Under $50</option>
            <option value="50-150">$50 - $150</option>
            <option value="150+">$150+</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {filtered.map((l, i) => (
            <div key={i} style={{ borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ height: 140, background: l.color + '08', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: l.color + '20', border: '1px solid ' + l.color + '30' }} />
              </div>
              <div style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{l.title}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: l.color, fontWeight: 600 }}>\u2605 {l.rating}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>({l.reviews} reviews)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>\${l.price}</span>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>{l.seller}</p>
                    <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{l.location}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Marketplace`,
      },
    ],
  },
]
