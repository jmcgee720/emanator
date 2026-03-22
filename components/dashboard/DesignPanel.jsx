'use client'

import { useState, useEffect } from 'react'
import { Paintbrush, X, ChevronDown, Check, Sun, Moon, Monitor, Layout, Smartphone, Gamepad2, LayoutDashboard, Globe } from 'lucide-react'
import { getPresetList, getDefaultDesignPrefs, DESIGN_PRESETS } from '@/lib/ai/design-system'
import { authFetch } from '@/lib/auth-fetch'

const presetList = getPresetList()

const DENSITY_OPTIONS = [
  { id: 'compact', label: 'Compact' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'spacious', label: 'Spacious' },
]

const THEME_OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'auto', label: 'Auto', icon: Monitor },
]

const INTERFACE_OPTIONS = [
  { id: 'website', label: 'Website', icon: Globe },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'mobile', label: 'Mobile App', icon: Smartphone },
  { id: 'game', label: 'Game UI', icon: Gamepad2 },
]

export default function DesignPanel({ projectId, designPrefs, onUpdate, onClose }) {
  const [prefs, setPrefs] = useState(designPrefs || getDefaultDesignPrefs())
  const [saving, setSaving] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)

  const selectedPreset = DESIGN_PRESETS[prefs.preset] || DESIGN_PRESETS.modern_saas

  const updatePref = (key, value) => {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    savePrefs(next)
  }

  const savePrefs = async (p) => {
    setSaving(true)
    try {
      await authFetch(`/api/projects/${projectId}/design`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      })
      onUpdate(p)
    } catch (err) {
      console.error('Failed to save design prefs:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" data-testid="design-panel">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-[420px] h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Paintbrush className="w-5 h-5 text-violet-400" />
            <h2 className="text-base font-semibold text-zinc-100">Design Intelligence</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors" data-testid="design-panel-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">

          {/* Preset Selector */}
          <div data-testid="preset-selector">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">Style Preset</label>
            <button
              onClick={() => setPresetOpen(!presetOpen)}
              className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors"
            >
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200">{selectedPreset.name}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{selectedPreset.description}</div>
              </div>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${presetOpen ? 'rotate-180' : ''}`} />
            </button>

            {presetOpen && (
              <div className="mt-2 border border-zinc-800 rounded-xl bg-zinc-900 overflow-hidden max-h-64 overflow-y-auto">
                {presetList.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { updatePref('preset', p.id); setPresetOpen(false) }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800 transition-colors ${prefs.preset === p.id ? 'bg-zinc-800/60' : ''}`}
                    data-testid={`preset-option-${p.id}`}
                  >
                    <div className="text-left">
                      <div className="text-sm text-zinc-200">{p.name}</div>
                      <div className="text-xs text-zinc-500">{p.description}</div>
                    </div>
                    {prefs.preset === p.id && <Check className="w-4 h-4 text-violet-400 shrink-0 ml-2" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Theme */}
          <div data-testid="theme-selector">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">Theme</label>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => updatePref('theme', opt.id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${prefs.theme === opt.id ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'}`}
                  data-testid={`theme-${opt.id}`}
                >
                  <opt.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Interface Type */}
          <div data-testid="interface-selector">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">Interface Type</label>
            <div className="grid grid-cols-2 gap-2">
              {INTERFACE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => updatePref('interfaceType', opt.id)}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all ${prefs.interfaceType === opt.id ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'}`}
                  data-testid={`interface-${opt.id}`}
                >
                  <opt.icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Density */}
          <div data-testid="density-selector">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">Density</label>
            <div className="flex gap-2">
              {DENSITY_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => updatePref('density', opt.id)}
                  className={`flex-1 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all ${prefs.density === opt.id ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'}`}
                  data-testid={`density-${opt.id}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color Direction */}
          <div>
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">Color Direction</label>
            <input
              type="text"
              value={prefs.colorDirection || ''}
              onChange={(e) => updatePref('colorDirection', e.target.value)}
              placeholder="e.g. blue primary, warm neutrals"
              className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none transition-colors"
              data-testid="color-direction-input"
            />
          </div>

          {/* Custom Notes */}
          <div>
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">Custom Design Notes</label>
            <textarea
              value={prefs.customNotes || ''}
              onChange={(e) => updatePref('customNotes', e.target.value)}
              placeholder="e.g. prefer large rounded cards, minimal clutter, strong typography..."
              rows={3}
              className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none resize-none transition-colors"
              data-testid="custom-notes-input"
            />
          </div>

          {/* Active Preset Preview */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
            <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Active Style Summary</div>
            <div className="space-y-1.5 text-xs text-zinc-500">
              <div><span className="text-zinc-400">Radius:</span> {selectedPreset.radius.style}</div>
              <div><span className="text-zinc-400">Shadows:</span> {selectedPreset.shadows.style}</div>
              <div><span className="text-zinc-400">Density:</span> {prefs.density || selectedPreset.spacing.density}</div>
              <div><span className="text-zinc-400">Colors:</span> {selectedPreset.colors.philosophy.slice(0, 60)}...</div>
              <div><span className="text-zinc-400">Interaction:</span> {selectedPreset.interaction.style.slice(0, 60)}...</div>
            </div>
          </div>

          {saving && (
            <div className="text-xs text-violet-400 text-center">Saving preferences...</div>
          )}
        </div>
      </div>
    </div>
  )
}
