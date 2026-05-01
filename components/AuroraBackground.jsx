import React, { useRef, useEffect, useCallback, useState } from 'react';
import { AuroraEngine } from '@/lib/auroraEngine';
import { Eye, EyeOff, Layers, ChevronDown, ChevronUp } from 'lucide-react';

const API_URL = '';

const defaultLayers = {
  topColumns: { visible: true, opacity: 1, x: 0, y: 0, scale: 1, saved: { opacity: 1, x: 0, y: -188, scale: 0.83 } },
  bottomLeftColumns: { visible: true, opacity: 1, x: 0, y: 0, scale: 1, saved: { opacity: 1, x: 0, y: 136, scale: 0.91 } },
  bottomRightColumns: { visible: true, opacity: 1, x: 0, y: 0, scale: 1, saved: { opacity: 1, x: -87, y: 125, scale: 1 } },
};

const defaultEffects = {
  sway: { enabled: true, intensity: 0.06 },
  gradientWave: { enabled: true, intensity: 0 },
  brightnessRipple: { enabled: true, intensity: 0.84 },
  twinklePulse: { enabled: true, intensity: 0.62 },
  colorBreathing: { enabled: true, intensity: 0.49 },
  verticalDrift: { enabled: true, intensity: 0.16 },
};

function restoreLayersFromStored(parsed) {
  const restored = {};
  for (const [id, def] of Object.entries(defaultLayers)) {
    const s = parsed[id];
    restored[id] = s
      ? { ...def, visible: s.visible, saved: s.saved }
      : def;
  }
  return restored;
}

const AuroraBackground = ({
  conversationState = 'idle',
  intensity = 1.0,
  speed = 1,
  hueShift = 0,
  streakDensity = 1,
  glowStrength = 1,
  activityLevel = 0,
}) => {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoLevel, setDemoLevel] = useState(0);
  const demoRef = useRef(null);

  // Shift+L toggles toolbar, Shift+D toggles demo mode
  useEffect(() => {
    const handleKey = (e) => {
      if (e.shiftKey && e.key === 'L') setToolbarVisible(v => !v);
      if (e.shiftKey && e.key === 'D') setDemoMode(v => !v);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Demo mode: simulate rising and falling activity
  useEffect(() => {
    if (!demoMode) {
      if (demoRef.current) cancelAnimationFrame(demoRef.current);
      setDemoLevel(0);
      return;
    }
    let start = performance.now();
    const tick = (now) => {
      const elapsed = (now - start) / 1000;
      // 30-second cycle: 0→1 over 20s (work session), 1→0 over 10s (idle)
      const cycle = elapsed % 30;
      const level = cycle < 20
        ? Math.pow(cycle / 20, 1.8) // ease-in rise
        : 1 - Math.pow((cycle - 20) / 10, 0.6); // gentle decay
      setDemoLevel(level);
      demoRef.current = requestAnimationFrame(tick);
    };
    demoRef.current = requestAnimationFrame(tick);
    return () => { if (demoRef.current) cancelAnimationFrame(demoRef.current); };
  }, [demoMode]);

  // Push activity level to engine — FORCED to 0 so aurora stays calm and doesn't escalate with usage.
  // Demo mode still works via Shift+D for testing.
  useEffect(() => {
    if (engineRef.current) {
      const level = demoMode ? demoLevel : 0;
      engineRef.current.updateActivityLevel(level);
    }
  }, [activityLevel, demoLevel, demoMode]);

  const [layers, setLayers] = useState(defaultLayers);
  const [effects, setEffects] = useState(defaultEffects);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Fetch persisted config from backend on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/aurora/config`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        if (cancelled) return;
        if (data.layers) {
          setLayers(restoreLayersFromStored(data.layers));
        }
        if (data.effects) {
          setEffects(data.effects);
        }
      } catch {
        // Fallback: try localStorage
        try {
          const stored = localStorage.getItem('aurora_layers');
          if (stored && !cancelled) {
            setLayers(restoreLayersFromStored(JSON.parse(stored)));
          }
        } catch {}
        try {
          const storedFx = localStorage.getItem('aurora_effects_v2') || localStorage.getItem('aurora_effects');
          if (storedFx && !cancelled) setEffects(JSON.parse(storedFx));
        } catch {}
      } finally {
        if (!cancelled) setConfigLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Combine saved base + live slider adjustments
  const getEffective = useCallback((layer) => ({
    visible: layer.visible,
    opacity: Math.min(1, Math.max(0, layer.saved.opacity * layer.opacity)),
    x: layer.saved.x + layer.x,
    y: layer.saved.y + layer.y,
    scale: layer.saved.scale * layer.scale,
  }), []);

  const updateLayer = useCallback((id, key, value) => {
    setLayers(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }, []);

  const toggleVisibility = useCallback((id) => {
    setLayers(prev => ({ ...prev, [id]: { ...prev[id], visible: !prev[id].visible } }));
  }, []);

  const handleSave = useCallback(() => {
    setLayers(prev => {
      const next = {};
      for (const [id, layer] of Object.entries(prev)) {
        const eff = {
          opacity: Math.min(1, Math.max(0, layer.saved.opacity * layer.opacity)),
          x: layer.saved.x + layer.x,
          y: layer.saved.y + layer.y,
          scale: layer.saved.scale * layer.scale,
        };
        next[id] = {
          ...layer,
          opacity: 1, x: 0, y: 0, scale: 1,
          saved: eff,
        };
      }
      // Persist to localStorage as local cache
      try { localStorage.setItem('aurora_layers', JSON.stringify(next)); } catch {}

      // Persist to backend (MongoDB) — the permanent save
      setSaveStatus('saving');
      fetch(`${API_URL}/api/aurora/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: next, effects }),
      })
        .then(r => r.ok ? setSaveStatus('saved') : setSaveStatus('error'))
        .catch(() => setSaveStatus('error'))
        .finally(() => setTimeout(() => setSaveStatus(null), 2000));

      return next;
    });
  }, [effects]);

  const toggleEffect = useCallback((id) => {
    setEffects(prev => {
      const next = { ...prev, [id]: { ...prev[id], enabled: !prev[id].enabled } };
      try {
        localStorage.setItem('aurora_effects', JSON.stringify(next));
        localStorage.setItem('aurora_effects_v2', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const updateEffectIntensity = useCallback((id, val) => {
    setEffects(prev => {
      const next = { ...prev, [id]: { ...prev[id], intensity: val } };
      try {
        localStorage.setItem('aurora_effects', JSON.stringify(next));
        localStorage.setItem('aurora_effects_v2', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

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
      glowStrength
    });
    engineRef.current.updateActivityLevel(activityLevel);
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
        glowStrength
      });
    }
  }, [conversationState, intensity, speed, hueShift, streakDensity, glowStrength]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateLayerConfig({
        topColumns: getEffective(layers.topColumns),
        bottomLeftColumns: getEffective(layers.bottomLeftColumns),
        bottomRightColumns: getEffective(layers.bottomRightColumns),
      });
    }
  }, [layers.topColumns, layers.bottomLeftColumns, layers.bottomRightColumns, getEffective]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateEffects(effects);
    }
  }, [effects]);

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
        overflow: 'hidden'
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="aurora-canvas"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {/* Wire mesh layers removed — columns-only mode */}
      {/* Layer Management Toolbar — hidden by default, Shift+L to toggle */}
      {toolbarVisible && <div
        data-testid="layer-toolbar"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          pointerEvents: 'auto',
          zIndex: 10,
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
        }}
      >
        <button
          data-testid="toolbar-toggle"
          onClick={() => setToolbarOpen(!toolbarOpen)}
          style={{
            position: 'absolute',
            bottom: toolbarOpen ? undefined : 0,
            top: toolbarOpen ? -32 : undefined,
            right: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            background: 'rgba(15, 12, 40, 0.88)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(140, 100, 220, 0.25)',
            borderBottom: toolbarOpen ? 'none' : '1px solid rgba(140, 100, 220, 0.25)',
            borderRadius: toolbarOpen ? '6px 6px 0 0' : '6px',
            color: 'rgba(200, 180, 255, 0.9)',
            fontSize: 11,
            cursor: 'pointer',
            letterSpacing: '0.5px',
          }}
        >
          <Layers size={13} />
          Layers
          {toolbarOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        {toolbarOpen && (
          <button
            data-testid="save-layers-btn"
            onClick={(e) => { e.stopPropagation(); handleSave(); }}
            style={{
              position: 'absolute',
              top: toolbarOpen ? -32 : 0,
              right: 130,
              padding: '6px 18px',
              background: 'rgba(90, 209, 195, 0.18)',
              border: '1px solid rgba(90, 209, 195, 0.4)',
              borderBottom: 'none',
              borderRadius: '6px 6px 0 0',
              color: 'rgba(90, 209, 195, 0.9)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.5px',
              cursor: 'pointer',
              textTransform: 'uppercase',
              backdropFilter: 'blur(12px)',
              pointerEvents: 'auto',
            }}
          >
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Error!' : 'Save'}
          </button>
        )}
        {toolbarOpen && (
          <div
            data-testid="toolbar-panel"
            style={{
              background: 'rgba(10, 8, 30, 0.94)',
              backdropFilter: 'blur(16px)',
              borderTop: '1px solid rgba(140, 100, 220, 0.2)',
              padding: '10px 20px 12px',
              display: 'flex',
              gap: 30,
            }}
          >
            {/* Left: Layer controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 9, color: 'rgba(140,120,200,0.5)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>Layers</div>
            {[
              { id: 'topColumns', name: 'Top Cols', color: '#9f6cff' },
              { id: 'bottomLeftColumns', name: 'BL Cols', color: '#728dca' },
              { id: 'bottomRightColumns', name: 'BR Cols', color: '#5ad1c3' },
            ].map(def => {
              const layer = layers[def.id];
              return (
                <div
                  key={def.id}
                  data-testid={`layer-row-${def.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 26,
                    opacity: layer.visible ? 1 : 0.4,
                  }}
                >
                  <button
                    data-testid={`layer-visibility-${def.id}`}
                    onClick={() => toggleVisibility(def.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: layer.visible ? def.color : 'rgba(100,100,120,0.5)',
                      padding: 2,
                      display: 'flex',
                    }}
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <span
                    style={{
                      width: 72,
                      fontSize: 10,
                      color: def.color,
                      letterSpacing: '0.3px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                    }}
                  >
                    {def.name}
                  </span>
                  <span style={{ fontSize: 9, color: 'rgba(160,140,200,0.6)', width: 10 }}>A</span>
                  <input
                    data-testid={`layer-opacity-${def.id}`}
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    value={layer.opacity}
                    onChange={e => updateLayer(def.id, 'opacity', +e.target.value)}
                    style={{ width: 70, accentColor: def.color }}
                  />
                  <span style={{ fontSize: 9, color: 'rgba(180,160,220,0.7)', width: 28, textAlign: 'right' }}>
                    {layer.opacity.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 9, color: 'rgba(160,140,200,0.6)', width: 10 }}>X</span>
                  <input
                    data-testid={`layer-x-${def.id}`}
                    type="range"
                    min="-200"
                    max="200"
                    step="1"
                    value={layer.x}
                    onChange={e => updateLayer(def.id, 'x', +e.target.value)}
                    style={{ width: 60, accentColor: def.color }}
                  />
                  <span style={{ fontSize: 9, color: 'rgba(180,160,220,0.7)', width: 24, textAlign: 'right' }}>
                    {layer.x}
                  </span>
                  <span style={{ fontSize: 9, color: 'rgba(160,140,200,0.6)', width: 10 }}>Y</span>
                  <input
                    data-testid={`layer-y-${def.id}`}
                    type="range"
                    min="-200"
                    max="200"
                    step="1"
                    value={layer.y}
                    onChange={e => updateLayer(def.id, 'y', +e.target.value)}
                    style={{ width: 60, accentColor: def.color }}
                  />
                  <span style={{ fontSize: 9, color: 'rgba(180,160,220,0.7)', width: 24, textAlign: 'right' }}>
                    {layer.y}
                  </span>
                  <span style={{ fontSize: 9, color: 'rgba(160,140,200,0.6)', width: 10 }}>S</span>
                  <input
                    data-testid={`layer-scale-${def.id}`}
                    type="range"
                    min="0.1"
                    max="3"
                    step="0.01"
                    value={layer.scale}
                    onChange={e => updateLayer(def.id, 'scale', +e.target.value)}
                    style={{ width: 60, accentColor: def.color }}
                  />
                  <span style={{ fontSize: 9, color: 'rgba(180,160,220,0.7)', width: 32, textAlign: 'right' }}>
                    {layer.scale.toFixed(2)}
                  </span>
                </div>
              );
            })}
            </div>
            {/* Right: Effects controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '1px solid rgba(140,100,220,0.15)', paddingLeft: 24 }}>
              <div style={{ fontSize: 9, color: 'rgba(140,120,200,0.5)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>Effects</div>
              {[
                { id: 'sway', name: 'Sway', color: '#a87cff' },
                { id: 'gradientWave', name: 'Grad Wave', color: '#8e8cff' },
                { id: 'brightnessRipple', name: 'Ripple', color: '#6ca0ff' },
                { id: 'twinklePulse', name: 'Twinkle', color: '#5cc8d4' },
                { id: 'colorBreathing', name: 'Breathe', color: '#7c6cda' },
                { id: 'verticalDrift', name: 'V.Drift', color: '#5aafb3' },
              ].map(def => {
                const eff = effects[def.id];
                return (
                  <div
                    key={def.id}
                    data-testid={`effect-row-${def.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      height: 26,
                      opacity: eff.enabled ? 1 : 0.4,
                    }}
                  >
                    <button
                      data-testid={`effect-toggle-${def.id}`}
                      onClick={() => toggleEffect(def.id)}
                      style={{
                        background: eff.enabled ? `${def.color}30` : 'none',
                        border: `1px solid ${eff.enabled ? def.color : 'rgba(100,100,120,0.3)'}`,
                        borderRadius: 3,
                        width: 16,
                        height: 16,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                      }}
                    >
                      {eff.enabled && <div style={{ width: 8, height: 8, borderRadius: 2, background: def.color }} />}
                    </button>
                    <span style={{ width: 64, fontSize: 10, color: def.color, letterSpacing: '0.3px', fontWeight: 600, textTransform: 'uppercase' }}>
                      {def.name}
                    </span>
                    <input
                      data-testid={`effect-intensity-${def.id}`}
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={eff.intensity}
                      onChange={e => updateEffectIntensity(def.id, +e.target.value)}
                      style={{ width: 80, accentColor: def.color }}
                    />
                    <span style={{ fontSize: 9, color: 'rgba(180,160,220,0.7)', width: 28, textAlign: 'right' }}>
                      {eff.intensity.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Activity section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderLeft: '1px solid rgba(140,100,220,0.15)', paddingLeft: 24, minWidth: 160 }}>
              <div style={{ fontSize: 9, color: 'rgba(140,120,200,0.5)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>Activity</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  data-testid="demo-mode-toggle"
                  onClick={() => setDemoMode(v => !v)}
                  style={{
                    background: demoMode ? 'rgba(90,209,195,0.2)' : 'rgba(40,30,60,0.5)',
                    border: `1px solid ${demoMode ? 'rgba(90,209,195,0.5)' : 'rgba(100,100,120,0.3)'}`,
                    borderRadius: 4,
                    padding: '4px 10px',
                    color: demoMode ? 'rgba(90,209,195,0.95)' : 'rgba(160,140,200,0.6)',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                  }}
                >
                  {demoMode ? 'Demo On' : 'Demo Off'}
                </button>
                <span style={{ fontSize: 9, color: 'rgba(160,140,200,0.6)' }}>Shift+D</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 9, color: 'rgba(140,120,200,0.5)', width: 40 }}>Level</span>
                <div style={{
                  flex: 1,
                  height: 6,
                  background: 'rgba(40,30,60,0.6)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}>
                  <div
                    data-testid="activity-level-bar"
                    style={{
                      width: `${(demoMode ? demoLevel : activityLevel) * 100}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, rgba(140,100,220,0.6), rgba(90,209,195,0.9))`,
                      borderRadius: 3,
                      transition: 'width 0.1s ease-out',
                    }}
                  />
                </div>
                <span style={{ fontSize: 9, color: 'rgba(180,160,220,0.7)', width: 28, textAlign: 'right' }}>
                  {((demoMode ? demoLevel : activityLevel) * 100).toFixed(0)}%
                </span>
              </div>
              <div style={{ fontSize: 8, color: 'rgba(140,120,200,0.35)', marginTop: 2, lineHeight: '1.3' }}>
                Idle = calm, Active = energized
              </div>
            </div>
          </div>
        )}
      </div>}
    </div>
  );
};

export default AuroraBackground;
