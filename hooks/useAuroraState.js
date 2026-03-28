'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

const BOOST_DURATION = 1200
const ACTIVE_TIMEOUT = 3000

export function useAuroraState(pageVariant = 'dashboard') {
  const [intensity, setIntensity] = useState('medium')
  const [stateMode, setStateMode] = useState('idle')
  const [isBoosted, setIsBoosted] = useState(false)

  const boostTimer = useRef(null)
  const activeTimer = useRef(null)

  const triggerBoost = useCallback(() => {
    setIsBoosted(true)
    if (boostTimer.current) clearTimeout(boostTimer.current)
    boostTimer.current = setTimeout(() => setIsBoosted(false), BOOST_DURATION)

    setStateMode('active')
    if (activeTimer.current) clearTimeout(activeTimer.current)
    activeTimer.current = setTimeout(() => setStateMode('idle'), ACTIVE_TIMEOUT)
  }, [])

  const setFocusMode = useCallback(() => setStateMode('focus'), [])
  const setIdleMode = useCallback(() => setStateMode('idle'), [])

  useEffect(() => {
    return () => {
      if (boostTimer.current) clearTimeout(boostTimer.current)
      if (activeTimer.current) clearTimeout(activeTimer.current)
    }
  }, [])

  const intensityClass = intensity !== 'medium' ? `em-aurora--intensity-${intensity}` : ''
  const stateClass = stateMode === 'active' ? 'em-aurora--active' : stateMode === 'focus' ? 'em-aurora--focused' : ''
  const boostClass = isBoosted ? 'em-aurora--boost' : ''

  const auroraClassName = [
    'em-aurora',
    `em-aurora--${pageVariant}`,
    intensityClass,
    stateClass,
    boostClass,
  ].filter(Boolean).join(' ')

  return {
    intensity,
    setIntensity,
    stateMode,
    setFocusMode,
    setIdleMode,
    triggerBoost,
    auroraClassName,
  }
}
