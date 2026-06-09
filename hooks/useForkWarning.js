import { useState, useCallback } from 'react'

/**
 * Fork Warning Hook
 * 
 * Manages fork warning state from SSE events.
 * Used by chat interfaces to display fork prompts when context limits are approached.
 * 
 * Usage:
 *   const { forkWarning, setForkWarning, clearForkWarning } = useForkWarning()
 *   
 *   // In SSE event handler:
 *   if (event === 'fork_suggested') {
 *     setForkWarning({ severity: 'warning', ...data })
 *   }
 *   if (event === 'fork_required') {
 *     setForkWarning({ severity: 'critical', ...data })
 *   }
 */
export function useForkWarning() {
  const [forkWarning, setForkWarningState] = useState(null)

  const setForkWarning = useCallback((data) => {
    setForkWarningState({
      severity: data.severity || 'warning',
      tokensUsed: data.tokensUsed,
      limit: data.limit,
      percentage: data.percentage,
      message: data.message,
      timestamp: Date.now(),
    })
  }, [])

  const clearForkWarning = useCallback(() => {
    setForkWarningState(null)
  }, [])

  return {
    forkWarning,
    setForkWarning,
    clearForkWarning,
  }
}
