import React, { useState, useEffect, useRef } from 'react';
import { AuroraEngine } from '@/lib/auroraEngine';
import { X, RotateCcw, Palette } from 'lucide-react';

const AuroraCustomizer = ({ isOpen, onClose, projectId }) => {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  
  // Load saved preferences or use defaults
  const loadPreferences = () => {
    if (!projectId) return getDefaults();
    const saved = localStorage.getItem(`aurora-v2-${projectId}`);
    return saved ? JSON.parse(saved) : getDefaults();
  };

  const getDefaults = () => ({
    hueShift: 0,
    intensity: 1.0,
    speed: 1.0,
    sway: 1.0,
    gradientWave: 1.0,
    brightnessRipple: 1.0,
    twinklePulse: 1.0,
    colorBreathing: 1.0,
    verticalDrift: 1.0,
    // Gradient color stops (HSL)
    colorTop: { h: 275, s: 60, l: 50 },      // Purple
    colorMid: { h: 220, s: 60, l: 50 },      // Blue-purple
    colorBottom: { h: 172, s: 75, l: 52 },   // Teal
  });

  const [prefs, setPrefs] = useState(loadPreferences);

  // Initialize preview canvas
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const width = 600;
    const height = 400;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    engineRef.current = new AuroraEngine(canvas, {
      conversationState: 'idle',
      intensity: prefs.intensity,
      speed: prefs.speed,
      hueShift: prefs.hueShift,
      customColors: prefs.colorTop ? {
        top: prefs.colorTop,
        mid: prefs.colorMid,
        bottom: prefs.colorBottom,
      } : null,
    });

    engineRef.current.updateActivityLevel(0);
    engineRef.current.updateEffects({
      sway: { enabled: prefs.sway > 0, intensity: prefs.sway },
      gradientWave: { enabled: prefs.gradientWave > 0, intensity: prefs.gradientWave },
      brightnessRipple: { enabled: prefs.brightnessRipple > 0, intensity: prefs.brightnessRipple },
      twinklePulse: { enabled: prefs.twinklePulse > 0, intensity: prefs.twinklePulse },
      colorBreathing: { enabled: prefs.colorBreathing > 0, intensity: prefs.colorBreathing },
      verticalDrift: { enabled: prefs.verticalDrift > 0, intensity: prefs.verticalDrift },
    });

    engineRef.current.start();

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [isOpen]);

  // Update preview when prefs change
  useEffect(() => {
    if (!engineRef.current) return;
    
    engineRef.current.updateProps({
      intensity: prefs.intensity,
      speed: prefs.speed,
      hueShift: prefs.hueShift,
      customColors: prefs.colorTop ? {
        top: prefs.colorTop,
        mid: prefs.colorMid,
        bottom: prefs.colorBottom,
      } : null,
    });

    engineRef.current.updateEffects({
      sway: { enabled: prefs.sway > 0, intensity: prefs.sway },
      gradientWave: { enabled: prefs.gradientWave > 0, intensity: prefs.gradientWave },
      brightnessRipple: { enabled: prefs.brightnessRipple > 0, intensity: prefs.brightnessRipple },
      twinklePulse: { enabled: prefs.twinklePulse > 0, intensity: prefs.twinklePulse },
      colorBreathing: { enabled: prefs.colorBreathing > 0, intensity: prefs.colorBreathing },
      verticalDrift: { enabled: prefs.verticalDrift > 0, intensity: prefs.verticalDrift },
    });
  }, [prefs]);

  const handleChange = (key, value) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    if (projectId) {
      localStorage.setItem(`aurora-v2-${projectId}`, JSON.stringify(prefs));
    }
    // Trigger a custom event so AuroraBackground can pick up the change
    window.dispatchEvent(new CustomEvent('aurora-prefs-changed', { 
      detail: { projectId, prefs } 
    }));
    onClose();
  };

  const handleReset = () => {
    setPrefs(getDefaults());
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-[#0c0a2a] border border-purple-500/30 rounded-xl shadow-2xl w-[700px] max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20">
          <div className="flex items-center gap-3">
            <Palette className="w-5 h-5 text-purple-400" />
            <h2 className="text-xl font-semibold text-white">Personalize Aurora</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-purple-500/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Preview */}
        <div className="px-6 py-4 border-b border-purple-500/20">
          <div className="relative rounded-lg overflow-hidden border border-purple-500/20">
            <canvas 
              ref={canvasRef}
              className="w-full h-full"
            />
          </div>
        </div>

        {/* Controls */}
        <div className="px-6 py-4 max-h-[400px] overflow-y-auto space-y-4">
          {/* Color Gradient */}
          <div>
            <label className="block text-sm font-medium text-purple-300 mb-2">
              Color Gradient
            </label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={prefs.hueShift}
              onChange={e => handleChange('hueShift', parseFloat(e.target.value))}
              className="w-full h-2 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Purple</span>
              <span className="text-purple-400">{prefs.hueShift}°</span>
              <span>Teal</span>
            </div>
          </div>

          {/* Intensity */}
          <div>
            <label className="block text-sm font-medium text-purple-300 mb-2">
              Brightness
            </label>
            <input
              type="range"
              min="0.1"
              max="3.0"
              step="0.05"
              value={prefs.intensity}
              onChange={e => handleChange('intensity', parseFloat(e.target.value))}
              className="w-full h-2 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="text-xs text-gray-500 mt-1 text-center">
              {(prefs.intensity * 100).toFixed(0)}%
            </div>
          </div>

          {/* Speed */}
          <div>
            <label className="block text-sm font-medium text-purple-300 mb-2">
              Animation Speed
            </label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={prefs.speed}
              onChange={e => handleChange('speed', parseFloat(e.target.value))}
              className="w-full h-2 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="text-xs text-gray-500 mt-1 text-center">
              {prefs.speed.toFixed(1)}x
            </div>
          </div>

          {/* Color Customization */}
          <div className="pt-2 border-t border-purple-500/20">
            <h3 className="text-sm font-medium text-purple-300 mb-3">Custom Colors</h3>
            
            <div className="space-y-3">
              <ColorPicker
                label="Top Color (Purple)"
                color={prefs.colorTop}
                onChange={c => handleChange('colorTop', c)}
              />
              <ColorPicker
                label="Middle Color (Blue)"
                color={prefs.colorMid}
                onChange={c => handleChange('colorMid', c)}
              />
              <ColorPicker
                label="Bottom Color (Teal)"
                color={prefs.colorBottom}
                onChange={c => handleChange('colorBottom', c)}
              />
            </div>
          </div>

          {/* Effects */}
          <div className="pt-2 border-t border-purple-500/20">
            <h3 className="text-sm font-medium text-purple-300 mb-3">Effects</h3>
            
            <div className="space-y-3">
              <EffectSlider
                label="Sway"
                value={prefs.sway}
                onChange={v => handleChange('sway', v)}
                min={0}
                max={3}
              />
              <EffectSlider
                label="Gradient Wave"
                value={prefs.gradientWave}
                onChange={v => handleChange('gradientWave', v)}
                min={0}
                max={3}
              />
              <EffectSlider
                label="Brightness Ripple"
                value={prefs.brightnessRipple}
                onChange={v => handleChange('brightnessRipple', v)}
                min={0}
                max={2}
              />
              <EffectSlider
                label="Twinkle Pulse"
                value={prefs.twinklePulse}
                onChange={v => handleChange('twinklePulse', v)}
                min={0}
                max={2}
              />
              <EffectSlider
                label="Color Breathing"
                value={prefs.colorBreathing}
                onChange={v => handleChange('colorBreathing', v)}
                min={0}
                max={2}
              />
              <EffectSlider
                label="Vertical Drift"
                value={prefs.verticalDrift}
                onChange={v => handleChange('verticalDrift', v)}
                min={0}
                max={3}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-purple-500/20 bg-purple-950/20">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-purple-500/10 rounded-lg transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Default
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-purple-500/10 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const EffectSlider = ({ label, value, onChange, min = 0, max = 3 }) => (
  <div>
    <div className="flex justify-between items-center mb-1">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-xs text-purple-400">{value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step="0.01"
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
    />
  </div>
);

const ColorPicker = ({ label, color, onChange }) => {
  const previewStyle = {
    background: `hsl(${color.h}, ${color.s}%, ${color.l}%)`,
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-gray-400">{label}</span>
        <div className="w-8 h-4 rounded border border-purple-500/30" style={previewStyle} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-8">Hue</span>
          <input
            type="range"
            min="0"
            max="360"
            value={color.h}
            onChange={e => onChange({ ...color, h: parseInt(e.target.value) })}
            className="flex-1 h-1 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <span className="text-[10px] text-purple-400 w-8 text-right">{color.h}°</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-8">Sat</span>
          <input
            type="range"
            min="0"
            max="100"
            value={color.s}
            onChange={e => onChange({ ...color, s: parseInt(e.target.value) })}
            className="flex-1 h-1 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <span className="text-[10px] text-purple-400 w-8 text-right">{color.s}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-8">Light</span>
          <input
            type="range"
            min="0"
            max="100"
            value={color.l}
            onChange={e => onChange({ ...color, l: parseInt(e.target.value) })}
            className="flex-1 h-1 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <span className="text-[10px] text-purple-400 w-8 text-right">{color.l}%</span>
        </div>
      </div>
    </div>
  );
};

export default AuroraCustomizer;
