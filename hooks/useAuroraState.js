'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

// Activity states: idle → typing → planning → applying → error
// Each maps to a CSS class that modulates aurora appearance
const ACTIVITY_STATES = {
  idle: 'em-aurora--idle',
  typing: 'em-aurora--typing',
  planning: 'em-aurora--planning',
  applying: 'em-aurora--applying',
  error: 'em-aurora--error',
}

// Timers
const TYPING_DECAY = 2000
const ENERGY_FLOW_DURATION = 1800
const PLANNING_MIN = 500
const COMPLEXITY_DECAY = 4000

export function useAuroraState(pageVariant = 'dashboard') {
  const [intensity, setIntensity] = useState('medium')
  const [activity, setActivity] = useState('idle')
  const [isFlowing, setIsFlowing] = useState(false)
  const [isComplex, setIsComplex] = useState(false)
  const [rayBurst, setRayBurst] = useState(false)

  const typingTimer = useRef(null)
  const flowTimer = useRef(null)
  const complexTimer = useRef(null)
  const rayTimer = useRef(null)
  const rayInterval = useRef(null)

  // Part 1: Activity detection
  const onTyping = useCallback(() => {
    setActivity('typing')
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setActivity('idle'), TYPING_DECAY)
  }, [])

  const onPlanning = useCallback(() => {
    setActivity('planning')
    // Planning stays until explicitly ended
  }, [])

  const onApplying = useCallback(() => {
    setActivity('applying')
  }, [])

  const onError = useCallback(() => {
    setActivity('error')
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setActivity('idle'), 4000)
  }, [])

  const onComplete = useCallback(() => {
    setActivity('idle')
  }, [])

  // Part 2: Energy flow — directional surge on prompt submit
  const triggerEnergyFlow = useCallback(() => {
    setIsFlowing(true)
    setActivity('applying')

    if (flowTimer.current) clearTimeout(flowTimer.current)
    flowTimer.current = setTimeout(() => {
      setIsFlowing(false)
      setActivity('idle')
    }, ENERGY_FLOW_DURATION)
  }, [])

  // Part 4: Complexity response — more density for heavy work
  const triggerComplexity = useCallback(() => {
    setIsComplex(true)
    if (complexTimer.current) clearTimeout(complexTimer.current)
    complexTimer.current = setTimeout(() => setIsComplex(false), COMPLEXITY_DECAY)
  }, [])

  // Part 3: Intermittent ray shimmer — random bursts
  useEffect(() => {
    const fireRay = () => {
      setRayBurst(true)
      if (rayTimer.current) clearTimeout(rayTimer.current)
      rayTimer.current = setTimeout(() => setRayBurst(false), 900)
    }

    // Random interval: fire a ray every 6–14 seconds
    const scheduleNext = () => {
      const delay = 6000 + Math.random() * 8000
      rayInterval.current = setTimeout(() => {
        fireRay()
        scheduleNext()
      }, delay)
    }

    scheduleNext()

    return () => {
      if (rayTimer.current) clearTimeout(rayTimer.current)
      if (rayInterval.current) clearTimeout(rayInterval.current)
    }
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current)
      if (flowTimer.current) clearTimeout(flowTimer.current)
      if (complexTimer.current) clearTimeout(complexTimer.current)
    }
  }, [])

  // Build className
  const intensityClass = intensity !== 'medium' ? `em-aurora--intensity-${intensity}` : ''
  const activityClass = ACTIVITY_STATES[activity] || ''
  const flowClass = isFlowing ? 'em-aurora--energy-flow' : ''
  const complexClass = isComplex ? 'em-aurora--complex' : ''
  const rayClass = rayBurst ? 'em-aurora--ray-burst' : ''

  const auroraClassName = [
    'em-aurora',
    `em-aurora--${pageVariant}`,
    intensityClass,
    activityClass,
    flowClass,
    complexClass,
    rayClass,
  ].filter(Boolean).join(' ')

  return {
    intensity,
    setIntensity,
    activity,
    auroraClassName,
    // Activity triggers
    onTyping,
    onPlanning,
    onApplying,
    onError,
    onComplete,
    // Effects
    triggerEnergyFlow,
    triggerComplexity,
  }
}
