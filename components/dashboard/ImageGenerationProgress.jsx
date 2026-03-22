'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, RefreshCw, ImageIcon, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STAGES = [
  { key: 'preparing', label: 'Preparing request', icon: Sparkles, baseProgress: 5 },
  { key: 'sending_to_model', label: 'Sending to image model', icon: Sparkles, baseProgress: 10 },
  { key: 'generating', label: 'Generating image', icon: ImageIcon, baseProgress: 20 },
  { key: 'processing', label: 'Processing result', icon: Sparkles, baseProgress: 90 },
  { key: 'saving', label: 'Saving asset', icon: Sparkles, baseProgress: 95 },
  { key: 'rendering', label: 'Rendering preview', icon: CheckCircle2, baseProgress: 100 },
]

function getStageIndex(stageKey) {
  return STAGES.findIndex(s => s.key === stageKey)
}

function getEstimatedDuration() {
  try {
    const history = JSON.parse(localStorage.getItem('mymergent_image_gen_durations') || '[]')
    if (history.length === 0) return 40000 // default 40s
    const avg = history.reduce((a, b) => a + b, 0) / history.length
    return Math.max(15000, Math.min(90000, avg))
  } catch {
    return 40000
  }
}

export function recordGenerationDuration(durationMs) {
  try {
    const history = JSON.parse(localStorage.getItem('mymergent_image_gen_durations') || '[]')
    history.push(durationMs)
    // Keep last 10
    if (history.length > 10) history.shift()
    localStorage.setItem('mymergent_image_gen_durations', JSON.stringify(history))
  } catch {}
}

export default function ImageGenerationProgress({ stage, progress: serverProgress, error, onRetry, mode }) {
  const [displayProgress, setDisplayProgress] = useState(serverProgress || 5)
  const startTimeRef = useRef(Date.now())
  const estimatedDuration = useRef(getEstimatedDuration())
  const intervalRef = useRef(null)

  const stageIdx = getStageIndex(stage)
  const currentStage = STAGES[stageIdx] || STAGES[0]
  const StageIcon = currentStage.icon

  // Simulated progress during "generating" stage (20% → 85%)
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    if (stage === 'generating') {
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current
        const est = estimatedDuration.current
        // Map elapsed time to 20–85% range using an ease-out curve
        const rawFraction = Math.min(elapsed / est, 1)
        const eased = 1 - Math.pow(1 - rawFraction, 2) // ease-out quad
        const simulated = 20 + eased * 65 // 20% → 85%
        setDisplayProgress(Math.min(85, Math.round(simulated)))
      }, 500)
    } else if (serverProgress != null) {
      setDisplayProgress(serverProgress)
    } else {
      setDisplayProgress(currentStage.baseProgress)
    }

    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [stage, serverProgress])

  // Reset start time on mount
  useEffect(() => {
    startTimeRef.current = Date.now()
    estimatedDuration.current = getEstimatedDuration()
  }, [])

  const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000)
  const estTotal = Math.round(estimatedDuration.current / 1000)
  const estRemaining = Math.max(0, estTotal - elapsed)

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-red-500/20 bg-red-950/20 p-4" data-testid="image-gen-error">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-300 mb-1">Image generation failed</p>
            <p className="text-xs text-red-400/80 break-words">{error}</p>
            {onRetry && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-7 text-xs gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10"
                onClick={onRetry}
                data-testid="image-gen-retry-btn"
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-indigo-500/20 bg-indigo-950/10 p-4" data-testid="image-gen-progress">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
          <StageIcon className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-200" data-testid="image-gen-stage-label">
            {mode ? `Generating ${mode}...` : 'Generating image...'}
          </p>
          <p className="text-[11px] text-indigo-400/70" data-testid="image-gen-stage-detail">
            Stage {stageIdx + 1}/{STAGES.length} — {currentStage.label}
          </p>
        </div>
        <span className="text-xs font-mono text-indigo-300/80 tabular-nums" data-testid="image-gen-percentage">
          {displayProgress}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 rounded-full bg-indigo-950/50 overflow-hidden mb-2" data-testid="image-gen-progress-bar">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-500 transition-all duration-500 ease-out"
          style={{ width: `${displayProgress}%` }}
        />
      </div>

      {/* Stage dots */}
      <div className="flex items-center justify-between mb-2">
        {STAGES.map((s, i) => (
          <div
            key={s.key}
            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
              i <= stageIdx ? 'bg-indigo-400' : 'bg-indigo-900/50'
            }`}
            title={s.label}
          />
        ))}
      </div>

      {/* Time estimate */}
      <div className="flex items-center justify-between text-[10px] text-indigo-400/60" data-testid="image-gen-time-estimate">
        <span>{elapsed}s elapsed</span>
        {stage === 'generating' && estRemaining > 0 && (
          <span>~{estRemaining}s remaining</span>
        )}
        {stage !== 'generating' && stage !== 'rendering' && (
          <span>~{estTotal}s estimated</span>
        )}
      </div>
    </div>
  )
}
