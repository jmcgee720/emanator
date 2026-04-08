'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Loader2, ChevronDown, ChevronRight, Check, Sparkles } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { ScrollArea } from '@/components/ui/scroll-area'

const MOOD_OPTIONS = ['Professional', 'Playful', 'Bold', 'Minimal', 'Luxurious', 'Techy', 'Warm', 'Edgy', 'Elegant', 'Rustic']
const GOAL_OPTIONS = ['Generate leads', 'Sell products', 'Showcase work', 'Inform / educate', 'Build community', 'Internal tool', 'Other']
const PAGE_OPTIONS = ['Home', 'About', 'Pricing', 'Features', 'Blog', 'Contact', 'Dashboard', 'Login', 'FAQ', 'Testimonials', 'Gallery']
const TONE_OPTIONS = ['Formal', 'Conversational', 'Technical', 'Friendly', 'Authoritative', 'Witty']
const BUDGET_OPTIONS = ['MVP / lean', 'Polished', 'Premium']

const EMPTY_BRIEF = {
  elevator_pitch: '',
  target_audience: '',
  primary_goal: '',
  brand_name: '',
  mood: [],
  color_preferences: '',
  reference_sites: '',
  pages: [],
  custom_pages: '',
  most_important_page: '',
  must_have_features: '',
  nice_to_have_features: '',
  headline: '',
  key_messaging: '',
  tone_of_voice: '',
  integrations: '',
  timeline: '',
  budget_tier: '',
  things_to_avoid: '',
}

function Section({ title, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-1" data-testid={`brief-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left rounded-xl transition-all duration-200 hover:bg-[rgba(255,255,255,0.02)]"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-[var(--em-text-muted)] shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--em-text-muted)] shrink-0" />}
        <div>
          <p className="text-xs font-semibold em-text-primary">{title}</p>
          {subtitle && <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-2 space-y-3">{children}</div>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, label, testId }) {
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-[var(--em-text-muted)] mb-1 block">{label}</label>}
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none transition-all duration-200 focus:border-[rgba(167,139,250,0.3)]"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--em-text-primary)' }}
        data-testid={testId}
      />
    </div>
  )
}

function TextArea({ value, onChange, placeholder, label, rows = 3, testId }) {
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-[var(--em-text-muted)] mb-1 block">{label}</label>}
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none transition-all duration-200 focus:border-[rgba(167,139,250,0.3)]"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--em-text-primary)', lineHeight: 1.6 }}
        data-testid={testId}
      />
    </div>
  )
}

function Select({ value, onChange, options, placeholder, label, testId }) {
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

function ChipPicker({ selected = [], options, onChange, label, testId }) {
  const toggle = (option) => {
    onChange(selected.includes(option) ? selected.filter(s => s !== option) : [...selected, option])
  }
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-[var(--em-text-muted)] mb-1.5 block">{label}</label>}
      <div className="flex flex-wrap gap-1.5" data-testid={testId}>
        {options.map(o => {
          const active = selected.includes(o)
          return (
            <button
              key={o}
              onClick={() => toggle(o)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-150"
              style={{
                background: active ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.03)',
                border: active ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.06)',
                color: active ? '#A78BFA' : 'var(--em-text-muted)',
              }}
            >
              {active && <Check className="w-2.5 h-2.5 inline mr-1" />}
              {o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function buildPromptFromBrief(brief) {
  const parts = []
  parts.push('Build this project now with COMPLETE, production-ready pages. Every page MUST have at least 5 distinct sections (nav, hero, 3+ content sections, footer). Each section must have real content — not placeholders. Use rich Tailwind CSS styling with gradients, shadows, and responsive layouts. Each component file must be 150+ lines minimum.')
  if (brief.elevator_pitch) parts.push(`Project: ${brief.elevator_pitch}`)
  if (brief.target_audience) parts.push(`Target audience: ${brief.target_audience}`)
  if (brief.primary_goal) parts.push(`Primary goal: ${brief.primary_goal}`)
  if (brief.brand_name) parts.push(`Brand name: ${brief.brand_name}`)
  if (brief.mood?.length > 0) parts.push(`Style/mood: ${brief.mood.join(', ')}`)
  if (brief.color_preferences) parts.push(`Colors: ${brief.color_preferences}`)
  if (brief.reference_sites) parts.push(`Reference sites: ${brief.reference_sites}`)
  const allPages = [...(brief.pages || []), ...(brief.custom_pages ? brief.custom_pages.split(',').map(p => p.trim()).filter(Boolean) : [])]
  if (allPages.length > 0) parts.push(`Pages needed (CREATE SEPARATE COMPONENT FILES FOR EACH): ${allPages.join(', ')}`)
  if (brief.most_important_page) parts.push(`Most important page (build with the most detail and content): ${brief.most_important_page}`)
  if (brief.must_have_features) parts.push(`Must-have features (implement ALL of these): ${brief.must_have_features}`)
  if (brief.nice_to_have_features) parts.push(`Nice-to-have (implement if possible): ${brief.nice_to_have_features}`)
  if (brief.headline) parts.push(`Headline/tagline: ${brief.headline}`)
  if (brief.key_messaging) parts.push(`Key messaging: ${brief.key_messaging}`)
  if (brief.tone_of_voice) parts.push(`Tone: ${brief.tone_of_voice}`)
  if (brief.integrations) parts.push(`Integrations: ${brief.integrations}`)
  if (brief.budget_tier) parts.push(`Budget tier: ${brief.budget_tier}`)
  if (brief.things_to_avoid) parts.push(`Avoid: ${brief.things_to_avoid}`)
  if (parts.length <= 1) return null
  return parts.join('\n')
}

export default function CanvasPanel({ project, onClose, onStartBuilding }) {
  const [brief, setBrief] = useState(EMPTY_BRIEF)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const lastSavedRef = useRef(null)

  useEffect(() => {
    if (!project?.id) return
    setLoading(true)
    authFetch(`/api/projects/${project.id}/canvas`)
      .then(r => r.json())
      .then(data => {
        const canvas = data.canvas_content || data
        if (canvas?.creative_brief) {
          setBrief({ ...EMPTY_BRIEF, ...canvas.creative_brief })
        }
        lastSavedRef.current = JSON.stringify(canvas?.creative_brief || EMPTY_BRIEF)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [project?.id])

  const saveBrief = useCallback(async (briefData) => {
    if (!project?.id) return
    setSaving(true)
    try {
      const getRes = await authFetch(`/api/projects/${project.id}/canvas`)
      const existing = await getRes.json()
      const canvasContent = existing.canvas_content || existing || {}
      canvasContent.creative_brief = briefData

      await authFetch(`/api/projects/${project.id}/canvas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvas_content: canvasContent }),
      })
      lastSavedRef.current = JSON.stringify(briefData)
    } catch (err) {
      console.error('Failed to save brief:', err)
    } finally {
      setSaving(false)
    }
  }, [project?.id])

  const updateField = useCallback((field, value) => {
    setBrief(prev => ({ ...prev, [field]: value }))
  }, [])

  const handleStartBuilding = async () => {
    const prompt = buildPromptFromBrief(brief)
    if (!prompt) return
    setStarting(true)
    try {
      await saveBrief(brief)
      onStartBuilding(prompt)
    } catch {
      setStarting(false)
    }
  }

  const hasContent = brief.elevator_pitch || brief.must_have_features || brief.brand_name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose} data-testid="creative-brief-overlay">
      <div
        className="em-glass rounded-2xl w-[580px] max-h-[85vh] flex flex-col border border-[rgba(167,139,250,0.15)]"
        onClick={e => e.stopPropagation()}
        data-testid="creative-brief-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h2 className="text-base font-bold em-text-primary">Creative Brief</h2>
            <p className="text-[11px] text-[var(--em-text-muted)] mt-0.5">Guide the AI with your project vision</p>
          </div>
          <button onClick={onClose} className="text-[var(--em-text-muted)] hover:text-white transition-colors p-1 rounded-lg hover:bg-[rgba(255,255,255,0.06)]" data-testid="brief-close-btn">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--em-text-muted)]" />
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="py-3">
              <Section title="The Big Picture" subtitle="What are you building and for whom?">
                <TextArea
                  value={brief.elevator_pitch}
                  onChange={v => updateField('elevator_pitch', v)}
                  placeholder="e.g., A SaaS landing page for a project management tool aimed at freelancers who need simple, affordable task tracking"
                  label="What are you building?"
                  rows={3}
                  testId="brief-elevator-pitch"
                />
                <TextArea
                  value={brief.target_audience}
                  onChange={v => updateField('target_audience', v)}
                  placeholder="e.g., Freelance designers and developers, 25-40, tech-savvy, value simplicity over features"
                  label="Who is it for?"
                  rows={2}
                  testId="brief-target-audience"
                />
                <Select
                  value={brief.primary_goal}
                  onChange={v => updateField('primary_goal', v)}
                  options={GOAL_OPTIONS}
                  placeholder="Select primary goal..."
                  label="Primary goal"
                  testId="brief-primary-goal"
                />
              </Section>

              <Section title="Brand & Style" subtitle="Visual direction and identity" defaultOpen={false}>
                <TextInput
                  value={brief.brand_name}
                  onChange={v => updateField('brand_name', v)}
                  placeholder="e.g., FlowTask"
                  label="Brand name"
                  testId="brief-brand-name"
                />
                <ChipPicker
                  selected={brief.mood || []}
                  options={MOOD_OPTIONS}
                  onChange={v => updateField('mood', v)}
                  label="Mood / personality (pick all that apply)"
                  testId="brief-mood-picker"
                />
                <TextArea
                  value={brief.color_preferences}
                  onChange={v => updateField('color_preferences', v)}
                  placeholder="e.g., Dark theme with electric blue accents. No red. Think Linear or Vercel vibes."
                  label="Color preferences"
                  rows={2}
                  testId="brief-colors"
                />
                <TextArea
                  value={brief.reference_sites}
                  onChange={v => updateField('reference_sites', v)}
                  placeholder="e.g., linear.app, vercel.com/home, stripe.com -- I love their clean dark aesthetic"
                  label="Reference sites / inspiration"
                  rows={2}
                  testId="brief-references"
                />
              </Section>

              <Section title="Pages & Structure" subtitle="What pages does your site need?" defaultOpen={false}>
                <ChipPicker
                  selected={brief.pages || []}
                  options={PAGE_OPTIONS}
                  onChange={v => updateField('pages', v)}
                  label="Select pages"
                  testId="brief-pages-picker"
                />
                <TextInput
                  value={brief.custom_pages}
                  onChange={v => updateField('custom_pages', v)}
                  placeholder="e.g., Integrations, Changelog, Careers"
                  label="Custom pages (comma separated)"
                  testId="brief-custom-pages"
                />
                <Select
                  value={brief.most_important_page}
                  onChange={v => updateField('most_important_page', v)}
                  options={[...(brief.pages || []), ...(brief.custom_pages ? brief.custom_pages.split(',').map(p => p.trim()).filter(Boolean) : [])]}
                  placeholder="Which page matters most?"
                  label="Most important page"
                  testId="brief-important-page"
                />
              </Section>

              <Section title="Key Features" subtitle="What must this project do?" defaultOpen={false}>
                <TextArea
                  value={brief.must_have_features}
                  onChange={v => updateField('must_have_features', v)}
                  placeholder="e.g., Email signup form, animated hero section, pricing table with toggle, mobile responsive, dark mode"
                  label="Must-have features"
                  rows={3}
                  testId="brief-must-have"
                />
                <TextArea
                  value={brief.nice_to_have_features}
                  onChange={v => updateField('nice_to_have_features', v)}
                  placeholder="e.g., Blog section, testimonials carousel, live chat widget, multi-language support"
                  label="Nice-to-have features"
                  rows={2}
                  testId="brief-nice-to-have"
                />
              </Section>

              <Section title="Content Direction" subtitle="Messaging and tone" defaultOpen={false}>
                <TextInput
                  value={brief.headline}
                  onChange={v => updateField('headline', v)}
                  placeholder="e.g., Ship faster. Stress less."
                  label="Headline / tagline ideas"
                  testId="brief-headline"
                />
                <TextArea
                  value={brief.key_messaging}
                  onChange={v => updateField('key_messaging', v)}
                  placeholder="e.g., Visitors should feel like this tool will save them hours every week. Emphasize simplicity and speed, not feature count."
                  label="Key messaging points"
                  rows={2}
                  testId="brief-messaging"
                />
                <Select
                  value={brief.tone_of_voice}
                  onChange={v => updateField('tone_of_voice', v)}
                  options={TONE_OPTIONS}
                  placeholder="Select tone..."
                  label="Tone of voice"
                  testId="brief-tone"
                />
              </Section>

              <Section title="Technical & Constraints" subtitle="Integrations, timeline, and limits" defaultOpen={false}>
                <TextInput
                  value={brief.integrations}
                  onChange={v => updateField('integrations', v)}
                  placeholder="e.g., Stripe for payments, Mailchimp for newsletter, Google Analytics"
                  label="Integrations needed"
                  testId="brief-integrations"
                />
                <TextInput
                  value={brief.timeline}
                  onChange={v => updateField('timeline', v)}
                  placeholder="e.g., Need it live by end of this week"
                  label="Timeline"
                  testId="brief-timeline"
                />
                <Select
                  value={brief.budget_tier}
                  onChange={v => updateField('budget_tier', v)}
                  options={BUDGET_OPTIONS}
                  placeholder="Select budget tier..."
                  label="Budget tier"
                  testId="brief-budget"
                />
                <TextArea
                  value={brief.things_to_avoid}
                  onChange={v => updateField('things_to_avoid', v)}
                  placeholder="e.g., No stock photos, no purple gradients, avoid generic corporate language, no cookie banners"
                  label="Anything to avoid?"
                  rows={2}
                  testId="brief-avoid"
                />
              </Section>

              <div className="px-4 py-3">
                <div className="p-3 rounded-xl" style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.08)' }}>
                  <p className="text-[10px] text-[#A78BFA] font-medium">How this helps the AI</p>
                  <p className="text-[9px] text-[var(--em-text-muted)] mt-1 leading-relaxed">Everything you fill in here is saved to your project and automatically fed to the AI as context in every conversation. The more detail you provide, the better it can match your vision on the first try.</p>
                </div>
              </div>
            </div>
          </ScrollArea>
        )}

        {/* Footer with actions */}
        {!loading && (
          <div className="px-6 py-4 shrink-0 flex items-center justify-between gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.06)] em-text-secondary transition-all"
              data-testid="brief-cancel-btn"
            >
              Cancel
            </button>
            <button
              onClick={handleStartBuilding}
              disabled={!hasContent || saving || starting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed shadow-[0_0_16px_rgba(167,139,250,0.15)]"
              style={{
                background: 'linear-gradient(135deg, rgba(167,139,250,0.9), rgba(139,92,246,0.9))',
                color: '#fff',
              }}
              data-testid="brief-start-building-btn"
            >
              {starting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Start Building
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
