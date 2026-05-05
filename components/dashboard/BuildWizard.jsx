/**
 * BuildWizard — chat-inline coordinator for the 5-phase build pipeline.
 *
 * Renders as a stack of "phase cards" inside the chat thread, NOT as a
 * floating modal. Each completed phase becomes a chat-bubble-styled card
 * showing rich, human-friendly output (not JSON). Key fields are inline-
 * editable via pencil icons; edits persist server-side via /api/build/edit
 * before the user clicks Proceed.
 *
 * Phases:
 *   1. Plan structure  — brand name, tagline, mood, pages
 *   2. Write copy      — all headlines, subheads, CTAs (collapsible per page)
 *   3. Palette & fonts — color swatches + font picks (with color picker)
 *   4. Generate imagery — thumbnail grid with regenerate-on-edit
 *   5. Compose pages   — final assembly (no edits, just status)
 */
import { useState, useCallback, useEffect } from 'react'
import { Sparkles, CheckCircle2, AlertCircle, Loader2, ArrowRight, RefreshCw, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react'

const PHASES = [
  { id: 'plan',          label: 'Plan structure',         endpoint: '/api/build/plan',   editable: true },
  { id: 'copy',          label: 'Write copy',             endpoint: '/api/build/copy',   editable: true },
  { id: 'design_tokens', label: 'Choose palette + fonts', endpoint: '/api/build/tokens', editable: true },
  { id: 'images',        label: 'Generate imagery',       endpoint: '/api/build/images', editable: false },
  { id: 'compose',       label: 'Compose pages',          endpoint: '/api/build/compose', editable: false },
]

const API = process.env.NEXT_PUBLIC_BACKEND_URL || ''

async function apiCall(endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: 'bad_response' }))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export default function BuildWizard({ projectId, chatId, message, attachments, provider, model, onComplete, onCancel }) {
  const [runId, setRunId] = useState(null)
  const [currentPhase, setCurrentPhase] = useState(-1) // -1 = not started yet
  const [status, setStatus] = useState('idle') // idle | running | ready | error | complete
  const [phaseResults, setPhaseResults] = useState({})
  const [error, setError] = useState(null)

  const runPhase = useCallback(async (phaseIdx, currentRunId) => {
    const phase = PHASES[phaseIdx]
    setStatus('running')
    setCurrentPhase(phaseIdx)
    setError(null)
    try {
      const body = phaseIdx === 0
        ? { projectId, chatId, message, attachments, provider, model }
        : { runId: currentRunId }
      const resp = await apiCall(phase.endpoint, body)
      const newRunId = resp.runId || currentRunId
      setRunId(newRunId)
      setPhaseResults((prev) => ({ ...prev, [phase.id]: resp }))
      if (phase.id === 'compose') {
        setStatus('complete')
        if (onComplete) onComplete(resp)
      } else {
        setStatus('ready')
      }
    } catch (err) {
      console.error(`[BuildWizard] phase ${phase.id} failed:`, err.message)
      setError({ phase: phase.id, message: err.message })
      setStatus('error')
    }
  }, [projectId, chatId, message, attachments, provider, model, onComplete])

  // Auto-start on mount
  useEffect(() => {
    if (currentPhase === -1 && status === 'idle') {
      runPhase(0, null)
    }
  }, [currentPhase, status, runPhase])

  const handleProceed = () => runPhase(currentPhase + 1, runId)
  const handleRetry = () => runPhase(currentPhase, runId)

  const handleSaveEdits = async (phaseId, edits) => {
    if (!runId) return
    try {
      const resp = await apiCall('/api/build/edit', { runId, phase: phaseId, edits })
      // Merge updated result back into local state so the card re-renders
      // with the new values immediately.
      setPhaseResults((prev) => ({
        ...prev,
        [phaseId]: { ...prev[phaseId], ...mapServerEditToCardShape(phaseId, resp.result) },
      }))
    } catch (err) {
      console.error(`[BuildWizard] edit ${phaseId} failed:`, err.message)
    }
  }

  return (
    <div className="space-y-3" data-testid="build-wizard-inline">
      {/* Header bubble */}
      <ChatBubble icon={<Sparkles className="w-3.5 h-3.5" />} title="Building your site step by step" subtitle="Five phases. Edit anything before you proceed." />

      {/* Step indicator strip */}
      <StepStrip phases={PHASES} currentPhase={currentPhase} status={status} phaseResults={phaseResults} />

      {/* One card per started phase, in chronological order */}
      {PHASES.map((phase, idx) => {
        if (idx > currentPhase) return null
        const result = phaseResults[phase.id]
        const isActive = idx === currentPhase
        const isRunning = isActive && status === 'running'
        const isErrored = isActive && status === 'error'
        const isReadyToProceed = isActive && status === 'ready' && idx < PHASES.length - 1
        const isCompleteFinal = isActive && status === 'complete'

        return (
          <PhaseCard
            key={phase.id}
            phase={phase}
            result={result}
            running={isRunning}
            errored={isErrored}
            errorMessage={isErrored ? error?.message : null}
            onSaveEdits={(edits) => handleSaveEdits(phase.id, edits)}
            footer={
              isRunning ? (
                <div className="flex items-center gap-2 text-xs text-white/50 px-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Working on this — usually under a minute…
                </div>
              ) : isErrored ? (
                <button onClick={handleRetry} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/15 text-white text-xs font-medium px-3 py-1.5 transition" data-testid="build-wizard-retry">
                  <RefreshCw className="w-3 h-3" /> Retry this step
                </button>
              ) : isReadyToProceed ? (
                <button onClick={handleProceed} className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-xs font-medium px-3 py-1.5 transition" data-testid={`build-wizard-proceed-${phase.id}`}>
                  Proceed to {PHASES[idx + 1].label} <ArrowRight className="w-3 h-3" />
                </button>
              ) : isCompleteFinal ? (
                <div className="inline-flex items-center gap-1.5 text-emerald-300 text-xs font-medium" data-testid="build-wizard-complete">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Build complete — preview refreshing…
                </div>
              ) : null
            }
          />
        )
      })}

      {/* Cancel button */}
      {onCancel && status !== 'complete' && (
        <div className="pt-1">
          <button onClick={onCancel} className="text-[11px] text-white/40 hover:text-white/70 transition" data-testid="build-wizard-cancel">
            Cancel build
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Layout primitives ───────────────────────────────────────────── */

function ChatBubble({ icon, title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3.5">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        {icon} <span>{title}</span>
      </div>
      {subtitle && <div className="text-[11px] text-white/50 mt-0.5">{subtitle}</div>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

function StepStrip({ phases, currentPhase, status, phaseResults }) {
  return (
    <div className="flex items-center gap-1.5 px-1" data-testid="build-step-strip">
      {phases.map((p, idx) => {
        const done = idx < currentPhase || (idx === currentPhase && phaseResults[p.id] && status !== 'error' && status !== 'running')
        const active = idx === currentPhase
        const errored = active && status === 'error'
        const running = active && status === 'running'
        return (
          <div key={p.id} className="flex items-center gap-1.5 flex-1 min-w-0" data-testid={`step-${p.id}`}>
            <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${done ? 'bg-emerald-500/20 text-emerald-300' : active ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-white/40'}`}>
              {done ? <CheckCircle2 className="w-3 h-3" /> : errored ? <AlertCircle className="w-3 h-3" /> : running ? <Loader2 className="w-3 h-3 animate-spin" /> : idx + 1}
            </span>
            <span className={`text-[10px] truncate ${done ? 'text-white/70' : active ? 'text-white' : 'text-white/35'}`}>{p.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function PhaseCard({ phase, result, running, errored, errorMessage, onSaveEdits, footer }) {
  return (
    <div className={`rounded-xl border p-3.5 ${errored ? 'border-red-500/25 bg-red-500/5' : 'border-white/8 bg-white/[0.025]'}`} data-testid={`phase-card-${phase.id}`}>
      <div className="flex items-center gap-2 mb-2">
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-300" /> : errored ? <AlertCircle className="w-3.5 h-3.5 text-red-300" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}
        <div className="text-[12px] font-medium text-white/90">{phase.label}</div>
      </div>

      {errored ? (
        <div className="text-[11px] text-red-200/85 break-words mb-2">{errorMessage}</div>
      ) : running ? (
        <div className="text-[11px] text-white/45">Generating with the AI…</div>
      ) : result ? (
        <PhaseBody phaseId={phase.id} result={result} onSaveEdits={onSaveEdits} />
      ) : null}

      {footer && <div className="mt-3">{footer}</div>}
    </div>
  )
}

/* ── Phase-specific bodies ───────────────────────────────────────── */

function PhaseBody({ phaseId, result, onSaveEdits }) {
  if (phaseId === 'plan' && result.plan)         return <PlanBody plan={result.plan} onSave={onSaveEdits} />
  if (phaseId === 'copy' && result.copy)         return <CopyBody copy={result.copy} onSave={onSaveEdits} />
  if (phaseId === 'design_tokens' && result.tokens) return <TokensBody tokens={result.tokens} onSave={onSaveEdits} />
  if (phaseId === 'images' && result.thumbnails) return <ImagesBody result={result} />
  if (phaseId === 'compose')                     return <ComposeBody result={result} />
  return null
}

/* ── Phase 1: Plan ───────────────────────────────────────────────── */

function PlanBody({ plan, onSave }) {
  const [draft, setDraft] = useState({
    brandName: plan.brand?.name || '',
    tagline: plan.brand?.tagline || '',
    mood: plan.brand?.mood || '',
    audience: plan.brand?.audience || '',
  })
  const [editingField, setEditingField] = useState(null)

  const commit = (field) => {
    setEditingField(null)
    onSave({
      plan: {
        ...plan,
        brand: { ...plan.brand, name: draft.brandName, tagline: draft.tagline, mood: draft.mood, audience: draft.audience },
      },
    })
  }

  return (
    <div className="space-y-2">
      <EditableField label="Brand name" value={draft.brandName} editing={editingField === 'brandName'} onEdit={() => setEditingField('brandName')} onCancel={() => { setDraft({ ...draft, brandName: plan.brand?.name || '' }); setEditingField(null) }} onCommit={() => commit('brandName')} onChange={(v) => setDraft({ ...draft, brandName: v })} />
      <EditableField label="Tagline" value={draft.tagline} editing={editingField === 'tagline'} onEdit={() => setEditingField('tagline')} onCancel={() => { setDraft({ ...draft, tagline: plan.brand?.tagline || '' }); setEditingField(null) }} onCommit={() => commit('tagline')} onChange={(v) => setDraft({ ...draft, tagline: v })} />
      <EditableField label="Vibe / mood" value={draft.mood} editing={editingField === 'mood'} onEdit={() => setEditingField('mood')} onCancel={() => { setDraft({ ...draft, mood: plan.brand?.mood || '' }); setEditingField(null) }} onCommit={() => commit('mood')} onChange={(v) => setDraft({ ...draft, mood: v })} />
      <EditableField label="Audience" value={draft.audience} editing={editingField === 'audience'} onEdit={() => setEditingField('audience')} onCancel={() => { setDraft({ ...draft, audience: plan.brand?.audience || '' }); setEditingField(null) }} onCommit={() => commit('audience')} onChange={(v) => setDraft({ ...draft, audience: v })} />

      <div className="pt-1">
        <ReadOnlyRow label="Pages" value={(plan.sections || []).map(s => s.pageId || s.id || s.name).filter(Boolean).join(' · ') || `${plan.sections?.length || 0} sections`} />
        <ReadOnlyRow label="Images to generate" value={`${plan.imageManifest?.length || 0}`} />
      </div>
    </div>
  )
}

/* ── Phase 2: Copy ───────────────────────────────────────────────── */

function CopyBody({ copy, onSave }) {
  // `copy` shape: { hero: { headline, subheadline, ctaPrimary, ctaSecondary }, features: [...], etc }
  const [openSection, setOpenSection] = useState('hero')
  const [draft, setDraft] = useState(copy)
  const [editing, setEditing] = useState(null) // "section.field" e.g. "hero.headline"

  const updateField = (sectionKey, fieldKey, value) => {
    const section = draft[sectionKey] || {}
    const next = { ...draft, [sectionKey]: { ...section, [fieldKey]: value } }
    setDraft(next)
  }

  const commit = () => {
    setEditing(null)
    onSave({ copy: draft })
  }

  // Render top-level keys as collapsible sections
  const sectionKeys = Object.keys(draft || {}).filter((k) => k && typeof draft[k] === 'object' && !Array.isArray(draft[k]))

  return (
    <div className="space-y-1.5">
      {sectionKeys.map((sectionKey) => {
        const section = draft[sectionKey] || {}
        const isOpen = openSection === sectionKey
        const fieldKeys = Object.keys(section).filter((k) => typeof section[k] === 'string' && section[k].length > 0)
        return (
          <div key={sectionKey} className="rounded-lg bg-white/[0.02] border border-white/5 overflow-hidden" data-testid={`copy-section-${sectionKey}`}>
            <button onClick={() => setOpenSection(isOpen ? null : sectionKey)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.03] transition">
              <span className="text-[11px] font-medium text-white/85 capitalize">{prettyName(sectionKey)}</span>
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-white/40" /> : <ChevronRight className="w-3.5 h-3.5 text-white/40" />}
            </button>
            {isOpen && (
              <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-white/5">
                {fieldKeys.length === 0 ? (
                  <div className="text-[10px] text-white/35 italic">No copy in this section</div>
                ) : fieldKeys.map((fieldKey) => {
                  const editKey = `${sectionKey}.${fieldKey}`
                  return (
                    <EditableField
                      key={editKey}
                      label={prettyName(fieldKey)}
                      value={section[fieldKey]}
                      multiline={section[fieldKey].length > 60}
                      editing={editing === editKey}
                      onEdit={() => setEditing(editKey)}
                      onCancel={() => { setDraft(copy); setEditing(null) }}
                      onCommit={commit}
                      onChange={(v) => updateField(sectionKey, fieldKey, v)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Phase 3: Tokens (palette + fonts) ───────────────────────────── */

function TokensBody({ tokens, onSave }) {
  const palette = tokens.palette?.hex || {}
  const [draft, setDraft] = useState(palette)
  const [displayFont, setDisplayFont] = useState(tokens.typography?.displayFamily || '')
  const [bodyFont, setBodyFont] = useState(tokens.typography?.bodyFamily || '')
  const [imageryTreatment, setImageryTreatment] = useState(tokens.imageryTreatment || 'photographic_warm')

  const commit = (overrides = {}) => {
    onSave({
      tokens: {
        ...tokens,
        palette: { ...tokens.palette, hex: { ...draft, ...(overrides.palette || {}) } },
        typography: {
          ...tokens.typography,
          displayFamily: overrides.displayFont ?? displayFont,
          bodyFamily: overrides.bodyFont ?? bodyFont,
        },
        imageryTreatment: overrides.imageryTreatment ?? imageryTreatment,
      },
    })
  }

  const swatches = Object.entries(draft).slice(0, 8)
  const FONT_OPTS = ['Inter', 'Manrope', 'DM Sans', 'Plus Jakarta Sans', 'Playfair Display', 'Fraunces', 'Cormorant Garamond', 'Space Grotesk', 'JetBrains Mono', 'Bricolage Grotesque']
  const TREATMENT_OPTS = [
    { id: 'photographic_warm', label: 'Warm photographic' },
    { id: 'photographic_editorial', label: 'Editorial b&w' },
    { id: 'illustrated_playful', label: 'Playful illustration' },
    { id: 'minimal_product', label: 'Minimal product' },
    { id: 'technical_abstract', label: 'Technical abstract' },
  ]

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-medium text-white/55 uppercase tracking-wider mb-1.5">Color palette · click to change</div>
        <div className="flex flex-wrap gap-2">
          {swatches.map(([name, hex]) => (
            <label key={name} className="flex flex-col items-center gap-1 cursor-pointer group">
              <div className="relative">
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => {
                    const next = { ...draft, [name]: e.target.value }
                    setDraft(next)
                  }}
                  onBlur={() => commit()}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  data-testid={`palette-${name}`}
                />
                <div className="w-9 h-9 rounded-lg border border-white/12 group-hover:scale-105 transition-transform shadow-sm" style={{ backgroundColor: hex }} />
              </div>
              <div className="text-[9px] text-white/55">{prettyName(name)}</div>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FontPicker label="Headings" value={displayFont} options={FONT_OPTS} onChange={(v) => { setDisplayFont(v); commit({ displayFont: v }) }} testid="font-display" />
        <FontPicker label="Body text" value={bodyFont} options={FONT_OPTS} onChange={(v) => { setBodyFont(v); commit({ bodyFont: v }) }} testid="font-body" />
      </div>

      <div>
        <div className="text-[10px] font-medium text-white/55 uppercase tracking-wider mb-1.5">Imagery treatment</div>
        <select value={imageryTreatment} onChange={(e) => { setImageryTreatment(e.target.value); commit({ imageryTreatment: e.target.value }) }} className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white/85 focus:outline-none focus:border-white/25" data-testid="imagery-treatment">
          {TREATMENT_OPTS.map((t) => (<option key={t.id} value={t.id} className="bg-zinc-900">{t.label}</option>))}
        </select>
      </div>
    </div>
  )
}

function FontPicker({ label, value, options, onChange, testid }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-white/55 uppercase tracking-wider mb-1">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white/85 focus:outline-none focus:border-white/25" data-testid={testid}>
        {!options.includes(value) && value && <option value={value} className="bg-zinc-900">{value}</option>}
        {options.map((f) => <option key={f} value={f} className="bg-zinc-900">{f}</option>)}
      </select>
    </div>
  )
}

/* ── Phase 4: Images ─────────────────────────────────────────────── */

function ImagesBody({ result }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-white/55">
        Generated {result.generatedCount || 0} with Nano Banana
        {(result.openaiCount || 0) > 0 && ` · ${result.openaiCount} via OpenAI`}
        {(result.stockCount || 0) > 0 && ` · ${result.stockCount} stock fallback`}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {(result.thumbnails || []).slice(0, 12).map((t, i) => (
          <div key={i} className="relative group" data-testid={`image-thumb-${t.role}`}>
            <img src={t.preview} alt={t.role} className="w-full aspect-square object-cover rounded-md border border-white/10" />
            <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-sm text-[8px] text-white/90 text-center py-0.5 rounded-b-md opacity-0 group-hover:opacity-100 transition-opacity">{t.role}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Phase 5: Compose ────────────────────────────────────────────── */

function ComposeBody({ result }) {
  if (!result?.files) return <div className="text-[10px] text-white/55">Assembling pages…</div>
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-white/55">{result.fileCount} files written</div>
      <div className="text-[10px] text-white/45 font-mono space-y-0.5 max-h-32 overflow-auto">
        {(result.files || []).slice(0, 10).map((f, i) => (
          <div key={i} className="truncate">{f.path}</div>
        ))}
        {(result.files || []).length > 10 && <div className="text-white/35">…and {result.files.length - 10} more</div>}
      </div>
    </div>
  )
}

/* ── Editable atoms ──────────────────────────────────────────────── */

function EditableField({ label, value, editing, onEdit, onCancel, onCommit, onChange, multiline }) {
  if (editing) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] font-medium text-white/55">{label}</div>
        <div className="flex items-start gap-1">
          {multiline ? (
            <textarea autoFocus value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="flex-1 bg-white/5 border border-white/15 rounded-md px-2 py-1.5 text-[11px] text-white/95 focus:outline-none focus:border-white/30 resize-none" data-testid={`edit-input-${label}`} />
          ) : (
            <input autoFocus type="text" value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 bg-white/5 border border-white/15 rounded-md px-2 py-1 text-[11px] text-white/95 focus:outline-none focus:border-white/30" data-testid={`edit-input-${label}`} />
          )}
          <button onClick={onCommit} className="p-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition" data-testid={`edit-save-${label}`}><Check className="w-3 h-3" /></button>
          <button onClick={onCancel} className="p-1 rounded-md bg-white/5 hover:bg-white/10 text-white/60 transition" data-testid={`edit-cancel-${label}`}><X className="w-3 h-3" /></button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 group">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium text-white/45 uppercase tracking-wider">{label}</div>
        <div className="text-[11px] text-white/90 break-words mt-0.5">{value || <span className="text-white/30 italic">empty</span>}</div>
      </div>
      <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 p-1 rounded-md bg-white/5 hover:bg-white/10 text-white/55 transition flex-shrink-0" title="Edit" data-testid={`edit-pencil-${label}`}>
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  )
}

function ReadOnlyRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-2 text-[10px]">
      <span className="text-white/40 uppercase tracking-wider font-medium">{label}</span>
      <span className="text-white/75 break-words">{value}</span>
    </div>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function prettyName(key) {
  // Convert camelCase or snake_case to Title Case for display.
  // Examples: "headline" → "Headline", "ctaPrimary" → "Cta Primary",
  // "subheadline" → "Subheadline", "page_id" → "Page Id"
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * The /api/build/edit endpoint returns the FULL phase result object on
 * success. Different phases nest their data differently in the response
 * shape used by the start endpoints (e.g. `result.plan`, `result.copy`,
 * `result.tokens`). This helper normalizes so the local card state stays
 * in the same shape regardless of whether it came from a start or an edit.
 */
function mapServerEditToCardShape(phaseId, editedResult) {
  if (!editedResult) return {}
  if (phaseId === 'plan')          return { plan: editedResult.plan ?? editedResult }
  if (phaseId === 'copy')          return { copy: editedResult.copy ?? editedResult }
  if (phaseId === 'design_tokens') return { tokens: editedResult.tokens ?? editedResult }
  return editedResult
}
