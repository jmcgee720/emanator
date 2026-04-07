// Pre-built project templates for one-click cloning
export const PROJECT_TEMPLATES = [
  {
    id: 'landing-page',
    name: 'Landing Page',
    description: 'Modern hero section with features grid, testimonials, and CTA',
    category: 'Marketing',
    icon: 'Rocket',
    color: '#00E5FF',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function LandingPage() {
  const [email, setEmail] = useState('')

  const features = [
    { title: 'Lightning Fast', desc: 'Optimized for speed with edge-first architecture', icon: '⚡' },
    { title: 'Fully Responsive', desc: 'Beautiful on every device, from mobile to desktop', icon: '📱' },
    { title: 'SEO Ready', desc: 'Built-in best practices for search engine visibility', icon: '🔍' },
    { title: 'Analytics', desc: 'Real-time insights into your audience behavior', icon: '📊' },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
      <nav className="flex items-center justify-between px-8 py-5 max-w-7xl mx-auto">
        <div className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
          YourBrand
        </div>
        <div className="flex items-center gap-8">
          <a href="#features" className="text-sm text-white/60 hover:text-white transition-colors">Features</a>
          <a href="#pricing" className="text-sm text-white/60 hover:text-white transition-colors">Pricing</a>
          <button className="px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/25">
            Get Started
          </button>
        </div>
      </nav>

      <section className="max-w-7xl mx-auto px-8 pt-24 pb-32 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 mb-8">
          Now in Beta — Try it free
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold leading-tight tracking-tight mb-6">
          Build Something
          <br />
          <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            Extraordinary
          </span>
        </h1>
        <p className="text-lg text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
          The modern platform that helps you ship faster, iterate smarter, and grow without limits.
        </p>
        <div className="flex items-center justify-center gap-3 max-w-md mx-auto">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="flex-1 px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-cyan-500/50 placeholder:text-white/30"
          />
          <button className="px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all">
            Join Waitlist
          </button>
        </div>
      </section>

      <section id="features" className="max-w-7xl mx-auto px-8 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <div key={i} className="p-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm hover:bg-white/[0.06] transition-all duration-300">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="text-base font-bold mb-2">{f.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/[0.06] py-8 text-center text-xs text-white/30">
        Built with Emanator AI Builder
      </footer>
    </div>
  )
}

export default LandingPage`,
      },
    ],
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Personal portfolio with about section, projects grid, and contact form',
    category: 'Personal',
    icon: 'User',
    color: '#A78BFA',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function Portfolio() {
  const [activeSection, setActiveSection] = useState('work')

  const projects = [
    { title: 'E-Commerce Redesign', tag: 'UI/UX', img: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=400&fit=crop', desc: 'Complete redesign of a major e-commerce platform' },
    { title: 'Finance Dashboard', tag: 'Product', img: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=400&fit=crop', desc: 'Real-time analytics dashboard for fintech startup' },
    { title: 'Health Tracker', tag: 'Mobile', img: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&h=400&fit=crop', desc: 'iOS and Android health monitoring application' },
    { title: 'AI Writing Tool', tag: 'SaaS', img: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=400&fit=crop', desc: 'AI-powered content generation platform' },
  ]

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <header className="fixed top-0 left-0 right-0 z-50 px-8 py-4 backdrop-blur-xl bg-[#0A0A0A]/80 border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight">Jane Doe</span>
          <nav className="flex items-center gap-6">
            {['work', 'about', 'contact'].map(s => (
              <button key={s} onClick={() => setActiveSection(s)} className={\`text-sm capitalize transition-colors \${activeSection === s ? 'text-white' : 'text-white/40 hover:text-white/70'}\`}>{s}</button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 pt-28 pb-20">
        <section className="mb-20">
          <p className="text-sm text-violet-400 font-medium mb-3">Product Designer & Developer</p>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            I craft digital<br />experiences that<br /><span className="text-violet-400">matter.</span>
          </h1>
          <p className="text-base text-white/40 max-w-lg leading-relaxed">
            7+ years designing and building products for startups and enterprises. Currently available for freelance work.
          </p>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-[0.2em] text-white/30 font-bold mb-8">Selected Work</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {projects.map((p, i) => (
              <div key={i} className="group rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.06] hover:border-violet-500/20 transition-all duration-500">
                <div className="aspect-video overflow-hidden">
                  <img src={p.img} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold">{p.title}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">{p.tag}</span>
                  </div>
                  <p className="text-xs text-white/35">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default Portfolio`,
      },
    ],
  },
  {
    id: 'saas-dashboard',
    name: 'SaaS Dashboard',
    description: 'Analytics dashboard with metrics cards, charts area, and activity feed',
    category: 'Business',
    icon: 'BarChart3',
    color: '#34D399',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function Dashboard() {
  const [period, setPeriod] = useState('7d')

  const metrics = [
    { label: 'Total Revenue', value: '$48,290', change: '+12.5%', up: true },
    { label: 'Active Users', value: '2,847', change: '+8.2%', up: true },
    { label: 'Conversion Rate', value: '3.24%', change: '-0.4%', up: false },
    { label: 'Avg. Session', value: '4m 32s', change: '+18.7%', up: true },
  ]

  const activities = [
    { user: 'Sarah K.', action: 'upgraded to Pro plan', time: '2m ago', avatar: 'SK' },
    { user: 'Mike R.', action: 'completed onboarding', time: '15m ago', avatar: 'MR' },
    { user: 'Team Alpha', action: 'deployed v2.4.1', time: '1h ago', avatar: 'TA' },
    { user: 'Lisa M.', action: 'invited 3 members', time: '3h ago', avatar: 'LM' },
    { user: 'Alex P.', action: 'created new project', time: '5h ago', avatar: 'AP' },
  ]

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-white">
      <aside className="fixed left-0 top-0 bottom-0 w-56 border-r border-white/[0.06] bg-[#0B0F1A] p-5">
        <div className="text-lg font-bold mb-8 bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">AppName</div>
        <nav className="space-y-1">
          {['Dashboard', 'Analytics', 'Customers', 'Products', 'Settings'].map((item, i) => (
            <button key={item} className={\`w-full text-left px-3 py-2 rounded-lg text-sm transition-all \${i === 0 ? 'bg-emerald-500/10 text-emerald-300 font-medium' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.03]'}\`}>
              {item}
            </button>
          ))}
        </nav>
      </aside>

      <main className="ml-56 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold">Dashboard</h1>
            <p className="text-sm text-white/40 mt-1">Welcome back, here's what's happening</p>
          </div>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            {['24h', '7d', '30d', '90d'].map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={\`px-3 py-1.5 rounded-md text-xs font-medium transition-all \${period === p ? 'bg-emerald-500/15 text-emerald-300' : 'text-white/40 hover:text-white/70'}\`}>{p}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-8">
          {metrics.map((m, i) => (
            <div key={i} className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
              <p className="text-[11px] text-white/40 font-medium mb-2">{m.label}</p>
              <p className="text-2xl font-bold tracking-tight">{m.value}</p>
              <span className={\`text-xs font-semibold \${m.up ? 'text-emerald-400' : 'text-red-400'}\`}>{m.change}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
            <h3 className="text-sm font-semibold mb-4">Revenue Overview</h3>
            <div className="h-48 flex items-end gap-2">
              {[35, 52, 44, 68, 55, 78, 62, 85, 73, 92, 88, 95].map((h, i) => (
                <div key={i} className="flex-1 rounded-t-lg bg-gradient-to-t from-emerald-500/20 to-emerald-500/60 transition-all hover:from-emerald-500/30 hover:to-emerald-500/80" style={{ height: h + '%' }} />
              ))}
            </div>
          </div>
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
            <h3 className="text-sm font-semibold mb-4">Recent Activity</h3>
            <div className="space-y-4">
              {activities.map((a, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-bold text-white/50">{a.avatar}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs"><span className="font-semibold">{a.user}</span> <span className="text-white/40">{a.action}</span></p>
                    <p className="text-[10px] text-white/25">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default Dashboard`,
      },
    ],
  },
  {
    id: 'blog',
    name: 'Blog',
    description: 'Minimal blog with article cards, reading view, and newsletter signup',
    category: 'Content',
    icon: 'FileText',
    color: '#F59E0B',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function Blog() {
  const [selectedPost, setSelectedPost] = useState(null)

  const posts = [
    { id: 1, title: 'The Future of AI in Product Design', excerpt: 'How artificial intelligence is reshaping the way we think about user experience and product development.', date: 'Mar 15, 2025', tag: 'AI', readTime: '5 min', img: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=500&fit=crop' },
    { id: 2, title: 'Building Scalable Design Systems', excerpt: 'A practical guide to creating design systems that grow with your organization.', date: 'Mar 10, 2025', tag: 'Design', readTime: '8 min', img: 'https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=800&h=500&fit=crop' },
    { id: 3, title: 'The Rise of Edge Computing', excerpt: 'Why edge-first architecture is becoming the standard for modern web applications.', date: 'Mar 5, 2025', tag: 'Tech', readTime: '6 min', img: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&h=500&fit=crop' },
    { id: 4, title: 'Remote Work Culture Done Right', excerpt: 'Lessons learned from building a distributed team across 12 time zones.', date: 'Feb 28, 2025', tag: 'Culture', readTime: '4 min', img: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=500&fit=crop' },
  ]

  return (
    <div className="min-h-screen bg-[#FAFAF9] text-[#1A1A1A]">
      <nav className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight">The Journal</h1>
        <div className="flex items-center gap-5 text-sm text-[#1A1A1A]/40">
          <a href="#" className="hover:text-[#1A1A1A] transition-colors">Archive</a>
          <a href="#" className="hover:text-[#1A1A1A] transition-colors">About</a>
          <button className="px-4 py-1.5 rounded-full bg-[#1A1A1A] text-white text-xs font-medium hover:bg-[#333] transition-colors">Subscribe</button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-16">
          <p className="text-sm text-[#1A1A1A]/40 font-medium mb-3">Latest thoughts on</p>
          <h2 className="text-3xl md:text-4xl font-extrabold leading-tight tracking-tight">
            Design, Technology<br />& Building Products
          </h2>
        </div>

        <div className="space-y-12">
          {posts.map((post) => (
            <article key={post.id} className="group cursor-pointer" onClick={() => setSelectedPost(post)}>
              <div className="flex gap-8 items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{post.tag}</span>
                    <span className="text-xs text-[#1A1A1A]/30">{post.date}</span>
                    <span className="text-xs text-[#1A1A1A]/30">{post.readTime} read</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2 group-hover:text-amber-700 transition-colors">{post.title}</h3>
                  <p className="text-sm text-[#1A1A1A]/50 leading-relaxed">{post.excerpt}</p>
                </div>
                <div className="w-48 h-32 rounded-xl overflow-hidden shrink-0">
                  <img src={post.img} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      <footer className="max-w-4xl mx-auto px-6 py-12 mt-12 border-t border-[#1A1A1A]/[0.06]">
        <div className="text-center">
          <h3 className="text-lg font-bold mb-2">Stay in the loop</h3>
          <p className="text-sm text-[#1A1A1A]/40 mb-4">Get new posts delivered to your inbox. No spam.</p>
          <div className="flex items-center justify-center gap-2 max-w-sm mx-auto">
            <input type="email" placeholder="your@email.com" className="flex-1 px-4 py-2.5 rounded-xl border border-[#1A1A1A]/10 text-sm outline-none focus:border-amber-500/50" />
            <button className="px-5 py-2.5 rounded-xl bg-[#1A1A1A] text-white text-sm font-medium">Subscribe</button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Blog`,
      },
    ],
  },
  {
    id: 'ecommerce',
    name: 'E-Commerce',
    description: 'Product catalog with shopping cart, filters, and checkout UI',
    category: 'Commerce',
    icon: 'ShoppingBag',
    color: '#EC4899',
    files: [
      {
        path: 'pages/index.jsx',
        file_type: 'jsx',
        content: `import React, { useState } from 'react'

function Store() {
  const [cart, setCart] = useState([])
  const [filter, setFilter] = useState('all')

  const products = [
    { id: 1, name: 'Wireless Headphones', price: 249, cat: 'audio', img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop', badge: 'Best Seller' },
    { id: 2, name: 'Mechanical Keyboard', price: 189, cat: 'peripherals', img: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&h=400&fit=crop', badge: null },
    { id: 3, name: 'Smart Watch Pro', price: 399, cat: 'wearables', img: 'https://images.unsplash.com/photo-1546868871-af0de0ae72be?w=400&h=400&fit=crop', badge: 'New' },
    { id: 4, name: 'USB-C Hub', price: 79, cat: 'peripherals', img: 'https://images.unsplash.com/photo-1625842268584-8f3296236761?w=400&h=400&fit=crop', badge: null },
    { id: 5, name: 'Noise Cancelling Buds', price: 179, cat: 'audio', img: 'https://images.unsplash.com/photo-1590658268037-6bf12f032f55?w=400&h=400&fit=crop', badge: 'Popular' },
    { id: 6, name: 'Fitness Tracker', price: 129, cat: 'wearables', img: 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=400&h=400&fit=crop', badge: null },
  ]

  const filtered = filter === 'all' ? products : products.filter(p => p.cat === filter)
  const cartTotal = cart.reduce((sum, id) => sum + (products.find(p => p.id === id)?.price || 0), 0)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/[0.04]">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <h1 className="text-xl font-extrabold tracking-tight text-[#111]">STORE</h1>
          <button className="relative px-5 py-2 rounded-full bg-[#111] text-white text-sm font-medium">
            Cart ({cart.length}) {cart.length > 0 && <span className="ml-1 text-pink-300">\${cartTotal}</span>}
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-8">
          {['all', 'audio', 'peripherals', 'wearables'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={\`px-4 py-2 rounded-full text-xs font-semibold capitalize transition-all \${filter === f ? 'bg-[#111] text-white' : 'bg-black/[0.04] text-[#111]/50 hover:bg-black/[0.08]'}\`}>
              {f}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(product => (
            <div key={product.id} className="group bg-white rounded-2xl overflow-hidden border border-black/[0.04] hover:shadow-xl hover:shadow-black/[0.04] transition-all duration-500">
              <div className="relative aspect-square bg-[#F5F5F5] overflow-hidden">
                <img src={product.img} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                {product.badge && (
                  <span className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-white text-[10px] font-bold text-[#111] shadow-sm">{product.badge}</span>
                )}
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-[#111]">{product.name}</h3>
                  <span className="text-sm font-bold text-pink-500">\${product.price}</span>
                </div>
                <button
                  onClick={() => setCart(prev => [...prev, product.id])}
                  className="w-full py-2.5 rounded-xl text-xs font-semibold bg-[#111] text-white hover:bg-[#333] transition-colors"
                >
                  Add to Cart
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export default Store`,
      },
    ],
  },
]
