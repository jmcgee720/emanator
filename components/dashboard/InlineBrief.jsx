'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, ChevronDown, ChevronRight, Check, Sparkles, LayoutGrid, Settings } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

const MOOD_OPTIONS = ['Professional', 'Playful', 'Bold', 'Minimal', 'Luxurious', 'Techy', 'Warm', 'Edgy', 'Elegant', 'Rustic']
const GOAL_OPTIONS = ['Generate leads', 'Sell products', 'Showcase work', 'Inform / educate', 'Build community', 'Internal tool', 'Other']
const PAGE_OPTIONS = ['Home', 'About', 'Pricing', 'Features', 'Blog', 'Contact', 'Dashboard', 'Login', 'FAQ', 'Testimonials', 'Gallery']
const TONE_OPTIONS = ['Formal', 'Conversational', 'Technical', 'Friendly', 'Authoritative', 'Witty']
const BUDGET_OPTIONS = ['MVP / lean', 'Polished', 'Premium']

const EMPTY_BRIEF = {
  project_name: '', elevator_pitch: '', target_audience: '', primary_goal: '', brand_name: '',
  mood: [], color_preferences: '', reference_sites: '', pages: [], custom_pages: '',
  most_important_page: '', must_have_features: '', nice_to_have_features: '',
  headline: '', key_messaging: '', tone_of_voice: '', integrations: '',
  timeline: '', budget_tier: '', things_to_avoid: '',
}

function BriefSection({ title, subtitle, open, onToggle, children }) {
  return (
    <div data-testid={`brief-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left rounded-xl transition-all duration-200 hover:bg-[rgba(255,255,255,0.03)]"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-[var(--em-cyan)] shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-[var(--em-text-muted)] shrink-0" />
        }
        <div>
          <p className="text-xs font-semibold em-text-primary">{title}</p>
          {subtitle && <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  )
}

function Input({ value, onChange, placeholder, label, testId, rows }) {
  const Tag = rows ? 'textarea' : 'input'
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-[var(--em-text-muted)] mb-1 block">{label}</label>}
      <Tag
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none transition-all duration-200 focus:border-[rgba(0,229,255,0.3)] resize-none"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--em-text-primary)', lineHeight: rows ? 1.6 : undefined }}
        data-testid={testId}
      />
    </div>
  )
}

function Sel({ value, onChange, options, placeholder, label, testId }) {
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-[var(--em-text-muted)] mb-1 block">{label}</label>}
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: value ? 'var(--em-text-primary)' : 'var(--em-text-muted)' }}
        data-testid={testId}
      >
        <option value="">{placeholder || 'Select...'}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function Chips({ selected = [], options, onChange, label, testId }) {
  const toggle = (o) => onChange(selected.includes(o) ? selected.filter(s => s !== o) : [...selected, o])
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-[var(--em-text-muted)] mb-1.5 block">{label}</label>}
      <div className="flex flex-wrap gap-1.5" data-testid={testId}>
        {options.map(o => {
          const active = selected.includes(o)
          return (
            <button
              key={o} onClick={() => toggle(o)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-150"
              style={{
                background: active ? 'rgba(0,229,255,0.10)' : 'rgba(255,255,255,0.03)',
                border: active ? '1px solid rgba(0,229,255,0.25)' : '1px solid rgba(255,255,255,0.06)',
                color: active ? 'var(--em-cyan)' : 'var(--em-text-muted)',
              }}
            >
              {active && <Check className="w-2.5 h-2.5 inline mr-1" />}{o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function buildPromptFromBrief(brief) {
  const parts = []
  parts.push('Build this project now with COMPLETE, production-ready pages. Every component must have full UI with real layouts, navigation, forms, cards, and proper styling — no placeholder pages with just a title.')
  if (brief.elevator_pitch) parts.push(`Project: ${brief.elevator_pitch}`)
  if (brief.target_audience) parts.push(`Target audience: ${brief.target_audience}`)
  if (brief.primary_goal) parts.push(`Primary goal: ${brief.primary_goal}`)
  if (brief.brand_name) parts.push(`Brand name: ${brief.brand_name}`)
  if (brief.mood?.length > 0) parts.push(`Style/mood: ${brief.mood.join(', ')}`)
  if (brief.color_preferences) parts.push(`Colors: ${brief.color_preferences}`)
  if (brief.reference_sites) parts.push(`Reference sites: ${brief.reference_sites}`)
  const allPages = [...(brief.pages || []), ...(brief.custom_pages ? brief.custom_pages.split(',').map(p => p.trim()).filter(Boolean) : [])]
  if (allPages.length > 0) parts.push(`Pages needed: ${allPages.join(', ')}`)
  if (brief.most_important_page) parts.push(`Most important page: ${brief.most_important_page}`)
  if (brief.must_have_features) parts.push(`Must-have features: ${brief.must_have_features}`)
  if (brief.nice_to_have_features) parts.push(`Nice-to-have: ${brief.nice_to_have_features}`)
  if (brief.headline) parts.push(`Headline/tagline: ${brief.headline}`)
  if (brief.key_messaging) parts.push(`Key messaging: ${brief.key_messaging}`)
  if (brief.tone_of_voice) parts.push(`Tone: ${brief.tone_of_voice}`)
  if (brief.integrations) parts.push(`Integrations: ${brief.integrations}`)
  if (brief.budget_tier) parts.push(`Budget tier: ${brief.budget_tier}`)
  if (brief.things_to_avoid) parts.push(`Avoid: ${brief.things_to_avoid}`)
  if (parts.length <= 1) return null
  return parts.join('\n')
}

export default function InlineBrief({ onStartBuilding, isOwner, onOpenCoreSystem, onNewProject, saving: externalSaving }) {
  const [brief, setBrief] = useState(EMPTY_BRIEF)
  const [starting, setStarting] = useState(false)
  const [openSections, setOpenSections] = useState({ big_picture: true })

  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  const updateField = useCallback((field, value) => setBrief(prev => ({ ...prev, [field]: value })), [])
  const hasContent = brief.project_name || brief.elevator_pitch || brief.must_have_features || brief.brand_name

  const handleStart = async () => {
    const prompt = buildPromptFromBrief(brief)
    if (!prompt) return
    setStarting(true)
    try {
      await onStartBuilding(prompt, brief)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full" data-testid="inline-creative-brief">
      {/* Brief form — glass panel */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(170deg, rgba(255,255,255,0.07) 0%, rgba(200,220,255,0.03) 40%, rgba(255,255,255,0.05) 100%)',
          backdropFilter: 'blur(36px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 16px 70px rgba(0,0,0,0.28), 0 4px 24px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.20)',
        }}
      >
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-semibold em-text-primary">Creative Brief</p>
          <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5">Fill in what you know — the AI fills in the rest</p>
        </div>

        {/* Project title */}
        <div className="px-5 pb-2">
          <input
            value={brief.project_name || ''}
            onChange={e => updateField('project_name', e.target.value)}
            placeholder="Project name"
            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none transition-all duration-200 focus:border-[rgba(0,229,255,0.3)]"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--em-text-primary)' }}
            data-testid="brief-project-name"
          />
        </div>

        <div className="max-h-[45vh] overflow-y-auto px-1">
          <BriefSection title="The Big Picture" subtitle="What are you building?" open={openSections.big_picture} onToggle={() => toggleSection('big_picture')}>
            <Input value={brief.elevator_pitch} onChange={v => updateField('elevator_pitch', v)} placeholder="e.g., A SaaS landing page for freelancers who need simple task tracking" label="What are you building?" rows={2} testId="brief-elevator-pitch" />
            <Input value={brief.target_audience} onChange={v => updateField('target_audience', v)} placeholder="e.g., Freelance designers, 25-40, value simplicity" label="Who is it for?" rows={2} testId="brief-target-audience" />
            <Sel value={brief.primary_goal} onChange={v => updateField('primary_goal', v)} options={GOAL_OPTIONS} placeholder="Select primary goal..." label="Primary goal" testId="brief-primary-goal" />
          </BriefSection>

          <BriefSection title="Brand & Style" subtitle="Visual direction" open={!!openSections.brand} onToggle={() => toggleSection('brand')}>
            <Input value={brief.brand_name} onChange={v => updateField('brand_name', v)} placeholder="e.g., FlowTask" label="Brand name" testId="brief-brand-name" />
            <Chips selected={brief.mood || []} options={MOOD_OPTIONS} onChange={v => updateField('mood', v)} label="Mood / personality" testId="brief-mood-picker" />
            <Input value={brief.color_preferences} onChange={v => updateField('color_preferences', v)} placeholder="e.g., Dark theme with electric blue accents" label="Color preferences" rows={2} testId="brief-colors" />
            <Input value={brief.reference_sites} onChange={v => updateField('reference_sites', v)} placeholder="e.g., linear.app, vercel.com" label="Reference sites" rows={2} testId="brief-references" />
          </BriefSection>

          <BriefSection title="Pages & Structure" subtitle="What pages does your site need?" open={!!openSections.pages} onToggle={() => toggleSection('pages')}>
            <Chips selected={brief.pages || []} options={PAGE_OPTIONS} onChange={v => updateField('pages', v)} label="Select pages" testId="brief-pages-picker" />
            <Input value={brief.custom_pages} onChange={v => updateField('custom_pages', v)} placeholder="e.g., Integrations, Changelog" label="Custom pages (comma separated)" testId="brief-custom-pages" />
            <Sel value={brief.most_important_page} onChange={v => updateField('most_important_page', v)} options={[...(brief.pages || []), ...(brief.custom_pages ? brief.custom_pages.split(',').map(p => p.trim()).filter(Boolean) : [])]} placeholder="Which page matters most?" label="Most important page" testId="brief-important-page" />
          </BriefSection>

          <BriefSection title="Key Features" subtitle="What must this project do?" open={!!openSections.features} onToggle={() => toggleSection('features')}>
            <Input value={brief.must_have_features} onChange={v => updateField('must_have_features', v)} placeholder="e.g., Email signup, animated hero, pricing table" label="Must-have features" rows={3} testId="brief-must-have" />
            <Input value={brief.nice_to_have_features} onChange={v => updateField('nice_to_have_features', v)} placeholder="e.g., Blog, testimonials carousel" label="Nice-to-have" rows={2} testId="brief-nice-to-have" />
          </BriefSection>

          <BriefSection title="Content Direction" subtitle="Messaging and tone" open={!!openSections.content} onToggle={() => toggleSection('content')}>
            <Input value={brief.headline} onChange={v => updateField('headline', v)} placeholder="e.g., Ship faster. Stress less." label="Headline / tagline" testId="brief-headline" />
            <Input value={brief.key_messaging} onChange={v => updateField('key_messaging', v)} placeholder="e.g., Emphasize simplicity and speed" label="Key messaging" rows={2} testId="brief-messaging" />
            <Sel value={brief.tone_of_voice} onChange={v => updateField('tone_of_voice', v)} options={TONE_OPTIONS} placeholder="Select tone..." label="Tone of voice" testId="brief-tone" />
          </BriefSection>

          <BriefSection title="Technical & Constraints" subtitle="Integrations, timeline, limits" open={!!openSections.technical} onToggle={() => toggleSection('technical')}>
            <Input value={brief.integrations} onChange={v => updateField('integrations', v)} placeholder="e.g., Stripe, Mailchimp, Google Analytics" label="Integrations" testId="brief-integrations" />
            <Input value={brief.timeline} onChange={v => updateField('timeline', v)} placeholder="e.g., Need it live by end of this week" label="Timeline" testId="brief-timeline" />
            <Sel value={brief.budget_tier} onChange={v => updateField('budget_tier', v)} options={BUDGET_OPTIONS} placeholder="Select budget tier..." label="Budget tier" testId="brief-budget" />
            <Input value={brief.things_to_avoid} onChange={v => updateField('things_to_avoid', v)} placeholder="e.g., No stock photos, no purple gradients" label="Anything to avoid?" rows={2} testId="brief-avoid" />
          </BriefSection>
        </div>

        {/* New Project button */}
        <div className="px-5 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={handleStart}
            disabled={!hasContent || starting}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: hasContent && !starting
                ? 'linear-gradient(135deg, #ec4899, #f43f5e, #fb923c)'
                : 'rgba(255,255,255,0.06)',
              color: hasContent && !starting ? '#fff' : 'var(--em-text-muted)',
              boxShadow: hasContent && !starting ? '0 0 24px rgba(244,63,94,0.25), 0 4px 16px rgba(0,0,0,0.3)' : 'none',
            }}
            data-testid="brief-new-project-btn"
          >
            {starting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creating Project...</>
            ) : (
              <><Sparkles className="w-4 h-4" /> New Project</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
