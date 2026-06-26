import React, { useRef, useEffect, useCallback, useState } from 'react';
import { AuroraEngine } from '@/lib/auroraEngine';

// ──────────────────────────────────────────────────────────────────────
// LOCKED AURORA BASELINE
// ──────────────────────────────────────────────────────────────────────
// These coordinates were locked on 2026-05-06 after the user saved the
// position they wanted via the toolbar on auroraly.co. The exact values
// were read straight from MongoDB via GET /api/aurora/config:
//   topColumns        : x=0,    y=-188, scale=0.83
//   bottomLeftColumns : x=40,   y=186,  scale=0.91
//   bottomRightColumns: x=-207, y=165,  scale=1.00
//
// They are stored here as FRACTIONS of a 1920×1080 reference viewport so
// the same relative composition holds on narrow / wide / portrait windows.
// At render time the engine still wants pixel offsets, so we multiply by
// the current viewport dims and re-push to the engine on every resize.
//
// Engine math reminder (lib/auroraEngine.js around line 1030):
//   ctx.translate(-W/2 + layer.x, -H/2 + layer.y)
// so layer.x/y are absolute pixels — that's why pre-fix static values
// drifted on narrow windows.
// ──────────────────────────────────────────────────────────────────────

const REF_W = 1920;
const REF_H = 1080;

const LOCKED_LAYERS_FRAC = {
  topColumns: {
    visible: true, opacity: 1, scale: 0.83,
    xFrac:    0 / REF_W,   // 0
    yFrac: -188 / REF_H,   // ≈ -0.1741
  },
  bottomLeftColumns: {
    visible: true, opacity: 1, scale: 0.91,
    xFrac:  40 / REF_W,    // ≈  0.0208
    yFrac: 186 / REF_H,    // ≈  0.1722
  },
  bottomRightColumns: {
    visible: true, opacity: 1, scale: 1.00,
    xFrac: -207 / REF_W,   // ≈ -0.1078
    yFrac:  165 / REF_H,   // ≈  0.1528
  },
};

const LOCKED_EFFECTS = {
  sway:             { enabled: true, intensity: 0.06 },
  gradientWave:     { enabled: true, intensity: 0 },
  brightnessRipple: { enabled: true, intensity: 0.84 },
  twinklePulse:     { enabled: true, intensity: 0.62 },
  colorBreathing:   { enabled: true, intensity: 0.49 },
  verticalDrift:    { enabled: true, intensity: 0.16 },
};

// Resolve viewport-fraction offsets → pixel offsets the engine expects.
function resolveLayers(w, h) {
  const out = {};
  for (const [id, def] of Object.entries(LOCKED_LAYERS_FRAC)) {
    out[id] = {
      visible: def.visible,
      opacity: def.opacity,
      scale: def.scale,
      x: def.xFrac * w,
      y: def.yFrac * h,
    };
  }
  return out;
}

const AuroraBackground = ({
  conversationState = 'idle',
  intensity = 1.0,
  speed = 1,
  hueShift = 0,
  streakDensity = 1,
  glowStrength = 1,
  projectId = null, // NEW: optional project ID to load custom prefs
}) => {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth  : REF_W,
    h: typeof window !== 'undefined' ? window.innerHeight : REF_H,
  }));

  // Load project-specific preferences
  const [customPrefs, setCustomPrefs] = useState(() => {
    if (!projectId || typeof window === 'undefined') return null;
    const saved = localStorage.getItem(`aurora-v2-${projectId}`);
    return saved ? JSON.parse(saved) : null;
  });

  const handleResize = useCallback(() => {
    if (!canvasRef.current || !engineRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const width  = window.innerWidth;
    const height = window.innerHeight;
    canvasRef.current.width  = width  * dpr;
    canvasRef.current.height = height * dpr;
    canvasRef.current.style.width  = `${width}px`;
    canvasRef.current.style.height = `${height}px`;
    engineRef.current.resize(width * dpr, height * dpr);
    setViewport({ w: width, h: height });
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    const width  = window.innerWidth;
    const height = window.innerHeight;
    canvasRef.current.width  = width  * dpr;
    canvasRef.current.height = height * dpr;
    canvasRef.current.style.width  = `${width}px`;
    canvasRef.current.style.height = `${height}px`;

    // Apply custom prefs if available, otherwise use props
    const finalIntensity = customPrefs?.intensity ?? intensity;
    const finalSpeed = customPrefs?.speed ?? speed;
    const finalHueShift = customPrefs?.hueShift ?? hueShift;
    const finalCustomColors = customPrefs?.colorTop ? {
      top: customPrefs.colorTop,
      mid: customPrefs.colorMid,
      bottom: customPrefs.colorBottom,
    } : null;

    engineRef.current = new AuroraEngine(canvasRef.current, {
      conversationState,
      intensity: finalIntensity,
      speed: finalSpeed,
      hueShift: finalHueShift,
      streakDensity,
      glowStrength,
      customColors: finalCustomColors,
    });
    // Activity is permanently locked at 0 — calm and identical on every page.
    engineRef.current.updateActivityLevel(0);
    engineRef.current.updateLayerConfig(resolveLayers(width, height));
    
    // Apply custom effects if available
    const finalEffects = customPrefs ? {
      sway: { enabled: customPrefs.sway > 0, intensity: customPrefs.sway },
      gradientWave: { enabled: customPrefs.gradientWave > 0, intensity: customPrefs.gradientWave },
      brightnessRipple: { enabled: customPrefs.brightnessRipple > 0, intensity: customPrefs.brightnessRipple },
      twinklePulse: { enabled: customPrefs.twinklePulse > 0, intensity: customPrefs.twinklePulse },
      colorBreathing: { enabled: customPrefs.colorBreathing > 0, intensity: customPrefs.colorBreathing },
      verticalDrift: { enabled: customPrefs.verticalDrift > 0, intensity: customPrefs.verticalDrift },
    } : LOCKED_EFFECTS;
    
    engineRef.current.updateEffects(finalEffects);
    engineRef.current.start();
    setViewport({ w: width, h: height });
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [handleResize]);

  // Re-push the resolved layer pixel offsets whenever the viewport changes,
  // so the aurora stays grouped in the same RELATIVE spot on every screen.
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateLayerConfig(resolveLayers(viewport.w, viewport.h));
    }
  }, [viewport.w, viewport.h]);

  // Listen for preference changes from the customizer
  useEffect(() => {
    const handlePrefsChanged = (e) => {
      if (e.detail.projectId === projectId) {
        setCustomPrefs(e.detail.prefs);
      }
    };
    
    window.addEventListener('aurora-prefs-changed', handlePrefsChanged);
    return () => window.removeEventListener('aurora-prefs-changed', handlePrefsChanged);
  }, [projectId]);

  useEffect(() => {
    if (engineRef.current) {
      const finalIntensity = customPrefs?.intensity ?? intensity;
      const finalSpeed = customPrefs?.speed ?? speed;
      const finalHueShift = customPrefs?.hueShift ?? hueShift;
      const finalCustomColors = customPrefs?.colorTop ? {
        top: customPrefs.colorTop,
        mid: customPrefs.colorMid,
        bottom: customPrefs.colorBottom,
      } : null;

      engineRef.current.updateProps({
        conversationState,
        intensity: finalIntensity,
        speed: finalSpeed,
        hueShift: finalHueShift,
        streakDensity,
        glowStrength,
        customColors: finalCustomColors,
      });

      // Update effects if custom prefs exist
      if (customPrefs) {
        engineRef.current.updateEffects({
          sway: { enabled: customPrefs.sway > 0, intensity: customPrefs.sway },
          gradientWave: { enabled: customPrefs.gradientWave > 0, intensity: customPrefs.gradientWave },
          brightnessRipple: { enabled: customPrefs.brightnessRipple > 0, intensity: customPrefs.brightnessRipple },
          twinklePulse: { enabled: customPrefs.twinklePulse > 0, intensity: customPrefs.twinklePulse },
          colorBreathing: { enabled: customPrefs.colorBreathing > 0, intensity: customPrefs.colorBreathing },
          verticalDrift: { enabled: customPrefs.verticalDrift > 0, intensity: customPrefs.verticalDrift },
        });
      }
    }
  }, [conversationState, intensity, speed, hueShift, streakDensity, glowStrength, customPrefs]);

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
