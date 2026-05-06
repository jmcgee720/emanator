import React, { useRef, useEffect, useCallback } from 'react';
import { AuroraEngine } from '@/lib/auroraEngine';

// ──────────────────────────────────────────────────────────────────────
// LOCKED AURORA BASELINE
// ──────────────────────────────────────────────────────────────────────
// These coordinates were locked at the user's request on 2026-05-06 by
// applying the slider deltas they showed in their "correct.png"
// screenshot onto the prior saved baseline:
//   BL:  x = 40 + 0    = 40,    y = 336 + (-130) = 206,    scale = 0.91 * 1.00 = 0.91
//   BR:  x = -207 + 40 = -167,  y = 325 + (-150) = 175,    scale = 1.00 * 1.12 = 1.12
//
// The toolbar UI, fetch-from-API logic, layout-version invalidation, and
// demo mode have all been removed — the layout is fully static. Saving
// no longer kills these values on a version bump because version-bump
// logic no longer exists.
// ──────────────────────────────────────────────────────────────────────

const LOCKED_LAYERS = {
  topColumns:        { visible: true, opacity: 1, x: 0, y: -188, scale: 0.83 },
  bottomLeftColumns: { visible: true, opacity: 1, x: 40, y: 206, scale: 0.91 },
  bottomRightColumns:{ visible: true, opacity: 1, x: -167, y: 175, scale: 1.12 },
};

const LOCKED_EFFECTS = {
  sway:             { enabled: true, intensity: 0.06 },
  gradientWave:     { enabled: true, intensity: 0 },
  brightnessRipple: { enabled: true, intensity: 0.84 },
  twinklePulse:     { enabled: true, intensity: 0.62 },
  colorBreathing:   { enabled: true, intensity: 0.49 },
  verticalDrift:    { enabled: true, intensity: 0.16 },
};

const AuroraBackground = ({
  conversationState = 'idle',
  intensity = 1.0,
  speed = 1,
  hueShift = 0,
  streakDensity = 1,
  glowStrength = 1,
}) => {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const handleResize = useCallback(() => {
    if (canvasRef.current && engineRef.current) {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvasRef.current.width = width * dpr;
      canvasRef.current.height = height * dpr;
      canvasRef.current.style.width = `${width}px`;
      canvasRef.current.style.height = `${height}px`;
      engineRef.current.resize(width * dpr, height * dpr);
    }
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvasRef.current.width = width * dpr;
    canvasRef.current.height = height * dpr;
    canvasRef.current.style.width = `${width}px`;
    canvasRef.current.style.height = `${height}px`;

    engineRef.current = new AuroraEngine(canvasRef.current, {
      conversationState,
      intensity,
      speed,
      hueShift,
      streakDensity,
      glowStrength,
    });
    // Activity is permanently locked at 0 — the aurora is calm and identical
    // on every page. No demo mode, no escalation.
    engineRef.current.updateActivityLevel(0);
    engineRef.current.updateLayerConfig(LOCKED_LAYERS);
    engineRef.current.updateEffects(LOCKED_EFFECTS);
    engineRef.current.start();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [handleResize]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateProps({
        conversationState,
        intensity,
        speed,
        hueShift,
        streakDensity,
        glowStrength,
      });
    }
  }, [conversationState, intensity, speed, hueShift, streakDensity, glowStrength]);

  return (
    <div
      data-testid="aurora-background"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="aurora-canvas"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default AuroraBackground;
