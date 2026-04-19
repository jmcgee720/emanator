'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, ChevronDown, ChevronRight, Check, Sparkles, ImagePlus, X as XIcon } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import ArchetypeHint from './ArchetypeHint'
import ArchetypeQuickStart from './ArchetypeQuickStart'

const MOOD_OPTIONS = ['Professional', 'Playful', 'Bold', 'Minimal', 'Luxurious', 'Techy', 'Warm', 'Edgy', 'Elegant', 'Confident', 'Rustic']
const PAGE_OPTIONS = ['Home', 'About', 'Pricing', 'Features', 'Blog', 'Contact', 'Dashboard', 'Login', 'FAQ', 'Testimonials', 'Gallery']

const EMPTY_BRIEF = {
  project_name: '', elevator_pitch: '', target_audience: '', primary_goal: '', brand_name: '',
  mood: [], color_preferences: '', reference_sites: '', pages: [], custom_pages: '',
  most_important_page: '', must_have_features: '', nice_to_have_features: '',
  headline: '', key_messaging: '', tone_of_voice: '', integrations: '',
  timeline: '', budget_tier: '', things_to_avoid: '', media_assets: [],
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

function ArtDirection({ assets = [], onChange }) {
  // Three explicit categories so the pipeline knows what to DO with each image:
  //   'brand'      → rendered in the generated site (logo, photos, illustrations)
  //   'aesthetic'  → never rendered; used for palette/font/vibe extraction + image-in-wave
  //   'structural' → never rendered; used for layout/flow blueprint extraction
  const categories = [
    { id: 'brand',      label: 'Brand assets',    hint: 'Logo, product photos, illustrations — these will be rendered in your site',  testId: 'upload-brand' },
    { id: 'aesthetic',  label: 'Aesthetic inspo', hint: 'Mood boards, palette refs — guides colors, fonts, vibe (not shown in site)', testId: 'upload-aesthetic' },
    { id: 'structural', label: 'Layout / flow',   hint: 'Screenshots of UIs whose layout you want — guides composition + section order', testId: 'upload-structural' },
  ]

  const buildAsset = (file, role, cb) => {
    if (file.size > 5 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = () => cb({
      id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      note: '',
      name: file.name,
      dataUrl: reader.result,
      size: file.size,
    })
    reader.readAsDataURL(file)
  }

  const handleFiles = useCallback((files, role) => {
    Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .forEach((file) => buildAsset(file, role, (asset) => onChange((prev) => [...prev, asset])))
  }, [onChange])

  const updateNote = (id, note) => onChange((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)))
  const removeAsset = (id) => onChange((prev) => prev.filter((a) => a.id !== id))

  return (
    <div className="space-y-3">
      {categories.map((cat) => (
        <CategoryDropzone
          key={cat.id}
          category={cat}
          assets={assets.filter((a) => (a.role || 'brand') === cat.id)}
          onFiles={(files) => handleFiles(files, cat.id)}
          onNoteChange={updateNote}
          onRemove={removeAsset}
        />
      ))}
    </div>
  )
}

function CategoryDropzone({ category, assets, onFiles, onNoteChange, onRemove }) {
  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    onFiles(e.dataTransfer.files)
  }, [onFiles])

  return (
    <div data-testid={`category-${category.id}`}>
      <label className="text-[10px] font-medium text-[var(--em-text-muted)] mb-1 block">
        {category.label}
      </label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="rounded-lg cursor-pointer transition-all duration-200 flex flex-col items-center justify-center py-3 gap-1"
        style={{
          background: dragging ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.03)',
          border: dragging ? '1.5px dashed rgba(0,229,255,0.4)' : '1.5px dashed rgba(255,255,255,0.10)',
        }}
        data-testid={category.testId}
      >
        <ImagePlus className="w-4 h-4 text-[var(--em-text-muted)]" style={{ opacity: 0.5 }} />
        <span className="text-[10px] text-[var(--em-text-muted)]">Drop or click to upload</span>
        <span className="text-[9px] text-[var(--em-text-muted)]" style={{ opacity: 0.6 }}>{category.hint}</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
        data-testid={`${category.testId}-input`}
      />
      {assets.length > 0 && (
        <div className="space-y-2 mt-2">
          {assets.map((asset) => (
            <div key={asset.id} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="relative group rounded-md overflow-hidden shrink-0" style={{ width: 44, height: 44 }}>
                <img src={asset.dataUrl} alt={asset.name} className="w-full h-full object-cover" />
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(asset.id) }}
                  className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.7)' }}
                  data-testid={`asset-remove-${asset.id}`}
                >
                  <XIcon className="w-2.5 h-2.5 text-white" />
                </button>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="truncate text-[10px] text-[var(--em-text-muted)]">{asset.name}</div>
                <input
                  value={asset.note || ''}
                  onChange={(e) => onNoteChange(asset.id, e.target.value)}
                  placeholder={
                    category.id === 'brand' ? 'How should this be used? e.g. "navbar logo + feature badges"'
                    : category.id === 'aesthetic' ? 'What to match? e.g. "this exact palette + serif headlines"'
                    : 'Which part inspires you? e.g. "copy the pricing layout"'
                  }
                  className="w-full px-2 py-1 rounded text-[10px] outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--em-text-primary)' }}
                  data-testid={`asset-note-${asset.id}`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function buildPromptFromBrief(brief) {
  const displayParts = []
  if (brief.project_name) displayParts.push(brief.project_name)
  if (brief.elevator_pitch) displayParts.push(brief.elevator_pitch)
  const displayMessage = displayParts.length > 0
    ? displayParts.join(' — ')
    : 'Build my project'

  // Build comprehensive AI instruction from ALL brief fields
  const instrParts = []
  instrParts.push('Build this project now with COMPLETE, production-ready pages. Every component must have full UI with real layouts, navigation, forms, cards, and proper styling — no placeholder pages with just a title.')

  // Identity
  if (brief.brand_name) instrParts.push(`Brand name (MUST use this exact name throughout the UI): ${brief.brand_name}`)
  if (brief.project_name && brief.project_name !== brief.brand_name) instrParts.push(`Project name: ${brief.project_name}`)
  if (brief.elevator_pitch) instrParts.push(`Project description: ${brief.elevator_pitch}`)
  if (brief.target_audience) instrParts.push(`Target audience: ${brief.target_audience}`)
  if (brief.primary_goal) instrParts.push(`Primary goal: ${brief.primary_goal}`)

  // Visual direction
  if (brief.mood?.length > 0) instrParts.push(`Design mood/personality: ${brief.mood.join(', ')}`)
  if (brief.color_preferences) instrParts.push(`Color direction: ${brief.color_preferences}`)
  if (brief.reference_sites) instrParts.push(`Design references (match this quality/style): ${brief.reference_sites}`)

  // Structure
  const allPages = [...(brief.pages || []), ...(brief.custom_pages ? brief.custom_pages.split(',').map(p => p.trim()).filter(Boolean) : [])]
  if (allPages.length > 0) instrParts.push(`Pages to build (create navigation between these): ${allPages.join(', ')}`)
  if (brief.most_important_page) instrParts.push(`Most important page (build this with the most detail): ${brief.most_important_page}`)

  // Features
  if (brief.must_have_features) instrParts.push(`Must-have features (implement ALL of these with full UI):\n${brief.must_have_features}`)
  if (brief.nice_to_have_features) instrParts.push(`Nice-to-have features: ${brief.nice_to_have_features}`)
  // User-picked archetype override (overrides regex + LLM classification)
  if (brief.archetype_override) instrParts.push(`Archetype override: ${brief.archetype_override}`)

  // Content
  if (brief.headline) instrParts.push(`Hero headline/tagline: "${brief.headline}"`)
  if (brief.key_messaging) instrParts.push(`Key messaging to weave throughout: ${brief.key_messaging}`)
  if (brief.tone_of_voice) instrParts.push(`Tone of voice: ${brief.tone_of_voice}`)

  // Technical
  if (brief.integrations) instrParts.push(`Integrations to show in UI: ${brief.integrations}`)
  if (brief.timeline) instrParts.push(`Timeline context: ${brief.timeline}`)
  if (brief.budget_tier) instrParts.push(`Budget/scope: ${brief.budget_tier}`)
  if (brief.things_to_avoid) instrParts.push(`AVOID these (critical): ${brief.things_to_avoid}`)

  // Art direction assets — three categories, each feeds the pipeline differently.
  if (brief.media_assets?.length > 0) {
    const byRole = brief.media_assets.reduce((acc, a) => {
      const r = a.role || 'brand'
      acc[r] = (acc[r] || 0) + 1
      return acc
    }, {})
    const summary = Object.entries(byRole).map(([r, n]) => `${n} ${r}`).join(', ')
    instrParts.push(`Art direction: User uploaded ${brief.media_assets.length} image(s) — ${summary}. Brand assets will be rendered in the site (logo in navbar, photos in hero/feature slots). Aesthetic refs will drive palette/fonts/mood. Structural refs will drive layout/flow.`)
  }

  if (brief.project_name && instrParts.length <= 1) {
    instrParts.push(`Project name: ${brief.project_name}. Build a clean, modern web application.`)
  }
  if (instrParts.length <= 1) return null

  const attachments = brief.media_assets?.length > 0
    ? brief.media_assets.map((a) => ({
        type: 'image',
        name: a.name,
        data: a.dataUrl,
        role: a.role || 'brand',
        note: a.note || '',
      }))
    : null
  return { displayMessage, fullInstruction: instrParts.join('\n'), attachments }
}

const STORAGE_KEY = 'emanator_creative_brief_draft'

function loadDraft() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      // Don't restore media_assets (base64 is too large for localStorage)
      return { ...EMPTY_BRIEF, ...parsed, media_assets: [] }
    }
  } catch {}
  return EMPTY_BRIEF
}

function saveDraft(brief) {
  try {
    // Strip media_assets before saving (base64 too large)
    const { media_assets, ...rest } = brief
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest))
  } catch {}
}

export default function InlineBrief({ onStartBuilding, isOwner, onOpenCoreSystem, onNewProject, saving: externalSaving }) {
  const [brief, setBrief] = useState(() => loadDraft())
  const [starting, setStarting] = useState(false)
  const [openSections, setOpenSections] = useState({ big_picture: true })
  const [showDraftNotice, setShowDraftNotice] = useState(() => {
    try { return !!localStorage.getItem(STORAGE_KEY) } catch { return false }
  })

  // Auto-save draft on every change
  useEffect(() => {
    saveDraft(brief)
  }, [brief])

  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  const updateField = useCallback((field, value) => setBrief(prev => ({ ...prev, [field]: value })), [])
  const hasContent = brief.project_name || brief.elevator_pitch || brief.must_have_features || brief.brand_name

  const clearDraft = () => {
    setBrief(EMPTY_BRIEF)
    setShowDraftNotice(false)
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  const handleStart = async () => {
    const result = buildPromptFromBrief(brief)
    if (!result) return
    setStarting(true)
    try {
      await onStartBuilding(result.displayMessage, result.fullInstruction, brief, result.attachments)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full" data-testid="inline-creative-brief">
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
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold em-text-primary">Creative Brief</p>
              <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5">Fill in what you know — the AI fills in the rest</p>
            </div>
            {showDraftNotice && hasContent && (
              <button
                onClick={clearDraft}
                className="text-[10px] text-[var(--em-text-muted)] hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
                data-testid="clear-draft-btn"
              >
                Clear draft
              </button>
            )}
          </div>
          {showDraftNotice && hasContent && (
            <p className="text-[10px] text-[var(--em-cyan)] mt-1.5" style={{ opacity: 0.7 }}>
              Draft restored from your last session
            </p>
          )}
        </div>

        {/* Project name */}
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
            <ArchetypeQuickStart
              onPick={(archetypeId, starter) => {
                updateField('elevator_pitch', starter)
                updateField('archetype_override', archetypeId)
              }}
            />
            <Input value={brief.elevator_pitch} onChange={v => updateField('elevator_pitch', v)} placeholder="e.g., A SaaS landing page for freelancers who need simple task tracking" label="What are you building?" rows={2} testId="brief-elevator-pitch" />
            <Input value={brief.target_audience} onChange={v => updateField('target_audience', v)} placeholder="e.g., Freelance designers, 25-40, value simplicity" label="Who is it for?" rows={2} testId="brief-target-audience" />
            <Input value={brief.primary_goal} onChange={v => updateField('primary_goal', v)} placeholder="e.g., Increase signups through automated marketing with minimal manual work" label="Primary goal" rows={2} testId="brief-primary-goal" />
            <ArchetypeHint brief={brief} onOverride={(id) => updateField('archetype_override', id)} />
          </BriefSection>

          <BriefSection title="Brand & Style" subtitle="Visual direction" open={!!openSections.brand} onToggle={() => toggleSection('brand')}>
            <Input value={brief.brand_name} onChange={v => updateField('brand_name', v)} placeholder="e.g., Aurora Growth" label="Brand name" testId="brief-brand-name" />
            <Chips selected={brief.mood || []} options={MOOD_OPTIONS} onChange={v => updateField('mood', v)} label="Mood / personality" testId="brief-mood-picker" />
            <Input value={brief.color_preferences} onChange={v => updateField('color_preferences', v)} placeholder="e.g., Dark mode only, violet-blue gradients, glassmorphism, no white backgrounds" label="Color preferences" rows={2} testId="brief-colors" />
            <Input value={brief.reference_sites} onChange={v => updateField('reference_sites', v)} placeholder="e.g., linear.app, vercel.com, stripe.com" label="Reference sites" testId="brief-references" />
          </BriefSection>

          <BriefSection title="Art Direction" subtitle="Logos, brand assets, and mood board" open={!!openSections.media} onToggle={() => toggleSection('media')}>
            <ArtDirection
              assets={brief.media_assets || []}
              onChange={(updater) => setBrief(prev => ({ ...prev, media_assets: typeof updater === 'function' ? updater(prev.media_assets || []) : updater }))}
            />
          </BriefSection>

          <BriefSection title="Pages & Structure" subtitle="What pages does your site need?" open={!!openSections.pages} onToggle={() => toggleSection('pages')}>
            <Chips selected={brief.pages || []} options={PAGE_OPTIONS} onChange={v => updateField('pages', v)} label="Select pages" testId="brief-pages-picker" />
            <Input value={brief.custom_pages} onChange={v => updateField('custom_pages', v)} placeholder="e.g., SEO Engine, Ad Engine, Analytics, Automation Rules" label="Custom pages (comma separated)" testId="brief-custom-pages" />
            <Input value={brief.most_important_page} onChange={v => updateField('most_important_page', v)} placeholder="e.g., Dashboard" label="Most important page" testId="brief-important-page" />
          </BriefSection>

          <BriefSection title="Key Features" subtitle="What must this project do?" open={!!openSections.features} onToggle={() => toggleSection('features')}>
            <Input value={brief.must_have_features} onChange={v => updateField('must_have_features', v)} placeholder="e.g., Product ingestion, SEO optimization, ad copy generator, performance tracking" label="Must-have features" rows={3} testId="brief-must-have" />
            <Input value={brief.nice_to_have_features} onChange={v => updateField('nice_to_have_features', v)} placeholder="e.g., AI video ads, competitor analysis, A/B testing" label="Nice-to-have" rows={2} testId="brief-nice-to-have" />
          </BriefSection>

          <BriefSection title="Content Direction" subtitle="Messaging and tone" open={!!openSections.content} onToggle={() => toggleSection('content')}>
            <Input value={brief.headline} onChange={v => updateField('headline', v)} placeholder="e.g., Automate your marketing. Scale your growth." label="Headline / tagline" testId="brief-headline" />
            <Input value={brief.key_messaging} onChange={v => updateField('key_messaging', v)} placeholder="e.g., Replace manual marketing with intelligent automation" label="Key messaging" rows={2} testId="brief-messaging" />
            <Input value={brief.tone_of_voice} onChange={v => updateField('tone_of_voice', v)} placeholder="e.g., Direct, premium, minimal, confident" label="Tone of voice" testId="brief-tone" />
          </BriefSection>

          <BriefSection title="Technical & Constraints" subtitle="Integrations, timeline, limits" open={!!openSections.technical} onToggle={() => toggleSection('technical')}>
            <Input value={brief.integrations} onChange={v => updateField('integrations', v)} placeholder="e.g., Google Analytics, Stripe, Google Ads" label="Integrations" testId="brief-integrations" />
            <Input value={brief.timeline} onChange={v => updateField('timeline', v)} placeholder="e.g., MVP in 2-3 weeks" label="Timeline" testId="brief-timeline" />
            <Input value={brief.budget_tier} onChange={v => updateField('budget_tier', v)} placeholder="e.g., MVP / lean, or Premium" label="Budget / scope" testId="brief-budget" />
            <Input value={brief.things_to_avoid} onChange={v => updateField('things_to_avoid', v)} placeholder="e.g., No cluttered UI, no light themes, no auto-spend without approval" label="Anything to avoid?" rows={2} testId="brief-avoid" />
          </BriefSection>
        </div>

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
              <><Sparkles className="w-4 h-4" /> Build Project</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
