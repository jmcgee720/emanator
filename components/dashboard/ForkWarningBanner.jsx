'use client'

import { AlertTriangle, Info } from 'lucide-react'
import ForkButton from './ForkButton'

/**
 * Fork Warning Banner
 * 
 * Displays when conversation is approaching or has exceeded context limits.
 * Shows different severity levels based on token usage.
 */
export default function ForkWarningBanner({ 
  severity = 'warning', // 'info' | 'warning' | 'critical'
  tokensUsed,
  limit,
  percentage,
  message,
  chatId,
  projectId,
  onForked,
}) {
  const isCritical = severity === 'critical' || percentage >= 75
  const isWarning = severity === 'warning' || (percentage >= 65 && percentage < 75)
  
  if (!isWarning && !isCritical) return null

  const bgClass = isCritical 
    ? 'bg-red-500/10 border-red-500/30' 
    : 'bg-amber-500/10 border-amber-500/30'
  
  const textClass = isCritical 
    ? 'text-red-400' 
    : 'text-amber-400'
  
  const Icon = isCritical ? AlertTriangle : Info

  return (
    <div 
      className={`border rounded-lg p-4 mb-4 ${bgClass}`}
      data-testid="fork-warning-banner"
      data-severity={severity}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${textClass}`} />
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold text-sm mb-1 ${textClass}`}>
            {isCritical ? 'Conversation Too Long' : 'Approaching Context Limit'}
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            {message || `This conversation is using ${tokensUsed?.toLocaleString() || '?'} / ${limit?.toLocaleString() || '?'} tokens (${percentage?.toFixed(0) || '?'}%).`}
            {isCritical && ' Please fork to continue.'}
          </p>
          <div className="flex items-center gap-3">
            <ForkButton
              chatId={chatId}
              projectId={projectId}
              onForked={onForked}
              variant={isCritical ? 'default' : 'outline'}
              size="sm"
            >
              {isCritical ? 'Fork Now' : 'Fork Conversation'}
            </ForkButton>
            {tokensUsed && limit && (
              <div className="flex-1 max-w-xs">
                <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      isCritical ? 'bg-red-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${Math.min(percentage || 0, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {percentage?.toFixed(1)}% of context used
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
