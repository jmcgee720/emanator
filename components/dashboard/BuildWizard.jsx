/**
 * BuildWizard — step-by-step coordinator for the 5-phase build pipeline.
 *
 * Replaces the monolithic streaming build call with 5 discrete HTTP calls
 * gated by Proceed buttons, so no single call exceeds Vercel's 300s limit
 * and the user sees each phase's output before continuing.
 *
 * Mounted by Dashboard.jsx when a Creative Brief is submitted on a fresh
 * project. On completion, notifies parent so the preview refreshes.
 */
import { useState, useCallback } from 'react'
import { Sparkles, CheckCircle2, AlertCircle, Loader2, ArrowRight, RefreshCw } from 'lucide-react'

const PHASES = [
  { id: 'plan',          label: 'Plan structure',       endpoint: '/api/build/plan' },
  { id: 'copy',          label: 'Write copy',           endpoint: '/api/build/copy' },
  { id: 'design_tokens', label: 'Choose palette + fonts', endpoint: '/api/build/tokens' },
  { id: 'images',        label: 'Generate imagery',     endpoint: '/api/build/images' },
  { id: 'compose',       label: 'Compose pages',        endpoint: '/api/build/compose' },
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
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data
}

export default function BuildWizard({ projectId, chatId, message, attachments, provider, model, onComplete, onCancel }) {
  const [runId, setRunId] = useState(null)
  const [currentPhase, setCurrentPhase] = useState(0) // index into PHASES
  const [status, setStatus] = useState('idle') // idle | running | ready | error | complete
  const [phaseResults, setPhaseResults] = useState({})
  const [error, setError] = useState(null)

  const runPhase = useCallback(async (phaseIdx, currentRunId) => {
    const phase = PHASES[phaseIdx]
    setStatus('running')
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

  const handleStart = () => runPhase(0, null)

  const handleProceed = () => {
    const next = currentPhase + 1
    setCurrentPhase(next)
    runPhase(next, runId)
  }

  const handleRetry = () => runPhase(currentPhase, runId)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4" data-testid="build-wizard">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="w-4 h-4" /> Building your site step by step
          </div>
          <div className="text-xs text-white/50 mt-1">
            Five phases. Each completes in under a minute. Click Proceed to continue.
          </div>
        </div>
        {onCancel && status !== 'complete' && (
          <button
            onClick={onCancel}
            className="text-xs text-white/40 hover:text-white/70 transition"
            data-testid="build-wizard-cancel"
          >
            Cancel
          </button>
        )}
      </div>

      <ol className="space-y-2">
        {PHASES.map((phase, idx) => {
          const done = idx < currentPhase || (idx === currentPhase && phaseResults[phase.id] && status !== 'error')
          const active = idx === currentPhase
          const errored = active && status === 'error'
          return (
            <li key={phase.id} className="flex items-center gap-3 text-sm" data-testid={`build-phase-${phase.id}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium ${done ? 'bg-emerald-500/20 text-emerald-300' : active ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-white/40'}`}>
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : errored ? <AlertCircle className="w-3.5 h-3.5" /> : active && status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : idx + 1}
              </span>
              <span className={`${done ? 'text-white/90' : active ? 'text-white' : 'text-white/50'}`}>{phase.label}</span>
            </li>
          )
        })}
      </ol>

      {status === 'idle' && currentPhase === 0 && (
        <button
          onClick={handleStart}
          className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium px-5 py-2.5 transition"
          data-testid="build-wizard-start"
        >
          <Sparkles className="w-4 h-4" /> Start building
        </button>
      )}

      {status === 'ready' && currentPhase < PHASES.length - 1 && (
        <div className="space-y-3">
          <PhasePreview phaseId={PHASES[currentPhase].id} result={phaseResults[PHASES[currentPhase].id]} />
          <button
            onClick={handleProceed}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium px-5 py-2.5 transition"
            data-testid="build-wizard-proceed"
          >
            Proceed to {PHASES[currentPhase + 1].label} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" data-testid="build-wizard-error">
            <div className="flex items-center gap-2 font-medium"><AlertCircle className="w-4 h-4" /> Phase "{error?.phase}" failed</div>
            <div className="mt-1 text-xs text-red-200/80 break-words">{error?.message}</div>
          </div>
          <button
            onClick={handleRetry}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm font-medium px-5 py-2.5 transition"
            data-testid="build-wizard-retry"
          >
            <RefreshCw className="w-4 h-4" /> Retry this step
          </button>
        </div>
      )}

      {status === 'complete' && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200" data-testid="build-wizard-complete">
          <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="w-4 h-4" /> Build complete</div>
          <div className="mt-1 text-xs text-emerald-200/80">
            {phaseResults.compose?.fileCount || 0} files written. Preview refreshing...
          </div>
        </div>
      )}
    </div>
  )
}

function PhasePreview({ phaseId, result }) {
  if (!result) return null
  if (phaseId === 'plan' && result.plan) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-xs text-white/80 space-y-1">
        <div><span className="text-white/50">Archetype:</span> {result.plan.archetype}</div>
        <div><span className="text-white/50">Brand:</span> {result.plan.brand?.name} — {result.plan.brand?.tagline}</div>
        <div><span className="text-white/50">Mood:</span> {result.plan.brand?.mood}</div>
        <div><span className="text-white/50">Sections:</span> {result.plan.sections?.length || 0}</div>
        <div><span className="text-white/50">Images to generate:</span> {result.plan.imageManifest?.length || 0}</div>
        <div><span className="text-white/50">Files:</span> {result.plan.files?.length || 0}</div>
      </div>
    )
  }
  if (phaseId === 'copy' && result.copy) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-xs text-white/80 space-y-1">
        <div><span className="text-white/50">Sections with copy:</span> {result.sections?.join(', ')}</div>
        {result.copy?.hero?.headline && (
          <div className="italic text-white/90 pt-1">"{result.copy.hero.headline}"</div>
        )}
      </div>
    )
  }
  if (phaseId === 'design_tokens' && result.tokens) {
    const hex = result.tokens.palette?.hex || {}
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 space-y-2">
        <div className="flex gap-2">
          {Object.entries(hex).slice(0, 6).map(([name, value]) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-md border border-white/10" style={{ backgroundColor: value }} />
              <div className="text-[9px] text-white/50">{name}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-white/70">
          Display: <span className="text-white/90">{result.tokens.typography?.displayFamily}</span>
        </div>
        <div className="text-xs text-white/70">
          Body: <span className="text-white/90">{result.tokens.typography?.bodyFamily}</span>
        </div>
      </div>
    )
  }
  if (phaseId === 'images' && result.thumbnails) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 space-y-2">
        <div className="text-xs text-white/70">
          Generated {result.generatedCount} · Stock fallback {result.stockCount}
        </div>
        <div className="grid grid-cols-6 gap-1">
          {result.thumbnails.slice(0, 12).map((t, i) => (
            <img
              key={i}
              src={t.preview}
              alt={t.role}
              className="w-full aspect-square object-cover rounded-md border border-white/10"
              data-testid={`image-thumb-${t.role}`}
            />
          ))}
        </div>
      </div>
    )
  }
  return null
}
