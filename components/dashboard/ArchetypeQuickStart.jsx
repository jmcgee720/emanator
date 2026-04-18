'use client'

/**
 * ArchetypeQuickStart — row of clickable archetype tiles shown at the top of
 * the InlineBrief form. Clicking a tile pre-fills the brief with a starter
 * template for that archetype, so a first-time user doesn't face a blank page.
 */
import { Sparkles } from 'lucide-react'

const STARTERS = [
  { id: 'saas_tool', label: 'SaaS tool', icon: '⚙️', starter: 'A SaaS workspace for [audience] to [core action]. Users sign up, set up their workspace, and [primary outcome].' },
  { id: 'ai_app', label: 'AI app', icon: '✨', starter: 'An AI-powered tool that helps [audience] [core action] using natural language. Chat-based interface with conversation history.' },
  { id: 'marketplace', label: 'Marketplace', icon: '🏪', starter: 'A two-sided marketplace connecting [sellers] with [buyers]. Sellers create listings, buyers browse and purchase.' },
  { id: 'portfolio', label: 'Portfolio', icon: '🎨', starter: 'A personal portfolio site showcasing my projects and experience as a [role]. About, projects, and contact.' },
  { id: 'ecommerce', label: 'Store', icon: '🛒', starter: 'An online store selling [product type] to [audience]. Product catalog, cart, checkout, and order confirmation.' },
  { id: 'crm', label: 'CRM', icon: '📇', starter: 'A CRM for small sales teams. Contacts, sales pipeline (drag-and-drop deal stages), activity log.' },
]

export default function ArchetypeQuickStart({ onPick }) {
  return (
    <div className="mb-4" data-testid="archetype-quickstart">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-3 h-3 text-violet-300" />
        <span className="text-[11px] font-medium text-white/60 uppercase tracking-wider">Quick start — or write your own below</span>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {STARTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id, s.starter)}
            data-testid={`quickstart-${s.id}`}
            className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-white/10 bg-white/5 hover:border-violet-400/40 hover:bg-violet-500/10 transition-colors text-center"
          >
            <span className="text-base leading-none">{s.icon}</span>
            <span className="text-[10px] text-white/80 font-medium">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
