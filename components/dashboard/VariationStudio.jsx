'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  ImageIcon, Sparkles, Lock, Unlock, Check, X, Layers,
  Palette, Move, User2, ChevronDown, ChevronRight
} from 'lucide-react'

const VARIATION_TYPES = [
  { key: 'pose_variation', label: 'Pose Variation', icon: Move, desc: 'Same character, different pose' },
  { key: 'action_variation', label: 'Action/State', icon: Sparkles, desc: 'Different action or animation state' },
  { key: 'style_variation', label: 'Style Variation', icon: Palette, desc: 'Same subject, different art style' },
  { key: 'color_variation', label: 'Color Variation', icon: Palette, desc: 'Same design, different palette' },
  { key: 'icon_variant', label: 'Icon/UI Variant', icon: Layers, desc: 'Icon variations for different contexts' },
  { key: 'sprite_states', label: 'Sprite Sheet States', icon: Layers, desc: 'Generate multiple animation states' },
  { key: 'background_variation', label: 'Background Variation', icon: ImageIcon, desc: 'Scene/environment variant' },
]

const STATE_PRESETS = [
  'idle', 'walk', 'run', 'jump', 'fall', 'attack', 'hurt', 'celebrate', 'crouch', 'interact'
]

// ── Identity Locks (character, NOT style) ──
const IDENTITY_LOCKS = [
  { key: 'preserve_face', label: 'Preserve Face' },
  { key: 'preserve_outfit', label: 'Preserve Outfit' },
  { key: 'preserve_proportions', label: 'Preserve Proportions' },
  { key: 'preserve_silhouette', label: 'Preserve Silhouette' },
]

// ── Style Preservation Level ──
const STYLE_LEVELS = [
  { key: 'preserve', label: 'Keep Original Style', desc: 'Maintain exact same art style' },
  { key: 'moderate', label: 'Moderate Change', desc: 'Allow some style refinement' },
  { key: 'major', label: 'Major Change', desc: 'Significant style departure' },
  { key: 'replace', label: 'Replace Completely', desc: 'Reinterpret in a new style' },
]

// ── Target Style Presets ──
const TARGET_STYLES = [
  { key: 'modern_cartoon', label: 'Modern Cartoon', prompt: 'detailed modern illustrated cartoon style, clean lines, vibrant colors, professional animation quality' },
  { key: 'detailed_illustration', label: 'Detailed Illustration', prompt: 'detailed digital illustration, rich colors, polished rendering, professional concept art quality' },
  { key: 'comic_book', label: 'Comic Book', prompt: 'comic book art style, bold ink outlines, dynamic shading, cel-shaded colors' },
  { key: 'anime', label: 'Anime-Inspired', prompt: 'anime art style, clean cel-shading, expressive features, Japanese animation aesthetic' },
  { key: 'clean_mobile', label: 'Clean Mobile Game', prompt: 'clean mobile game art, flat design with subtle gradients, polished vector-like quality, app-store ready' },
  { key: 'polished_2d', label: 'Polished 2D Animation', prompt: 'polished 2D animation style, smooth lines, rich color palette, Disney/Pixar-influenced character design' },
  { key: 'mascot', label: 'Mascot Branding', prompt: 'professional mascot branding style, bold shapes, friendly approachable design, logo-ready quality' },
  { key: 'pixel_art', label: 'Pixel Art', prompt: 'pixel art style, retro 16-bit aesthetic, clean pixels, limited color palette' },
  { key: 'watercolor', label: 'Watercolor', prompt: 'watercolor painting style, soft edges, organic color blending, artistic hand-painted quality' },
  { key: 'custom', label: 'Custom Style...', prompt: '' },
]

const OUTPUT_SETTINGS = [
  { key: 'transparent_bg', label: 'Transparent Background' },
  { key: 'safe_margins', label: 'Safe Margins' },
  { key: 'no_bleed', label: 'No Bleed' },
  { key: 'readable_small', label: 'Readable at Small Sizes' },
  { key: 'icon_ready', label: 'Icon-Ready' },
  { key: 'game_ready', label: 'Game-Ready' },
]

const REFERENCE_ROLES = [
  { key: 'style', label: 'Style Reference' },
  { key: 'character', label: 'Character Reference' },
  { key: 'pose', label: 'Pose Reference' },
  { key: 'color', label: 'Color Reference' },
]

function Section({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-muted/30 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

export default function VariationStudio({ open, onClose, sourceImage, presetType, styleOverrides, assets, projectId, onGenerate }) {
  const [variationType, setVariationType] = useState('pose_variation')
  const [selectedStates, setSelectedStates] = useState(['idle'])
  const [customPrompt, setCustomPrompt] = useState('')
  const [identityLocks, setIdentityLocks] = useState(['preserve_face', 'preserve_outfit'])
  const [styleLevel, setStyleLevel] = useState('preserve')
  const [targetStyle, setTargetStyle] = useState(null)
  const [customStyleText, setCustomStyleText] = useState('')
  const [outputSettings, setOutputSettings] = useState(['transparent_bg', 'safe_margins', 'no_bleed'])
  const [references, setReferences] = useState([])
  const [characterName, setCharacterName] = useState('')
  const [showAssetPicker, setShowAssetPicker] = useState(false)

  // Reset all transient state when dialog opens (handles repeated opens with same sourceImage)
  const openCountRef = useRef(0)
  useEffect(() => {
    if (!open) return
    openCountRef.current += 1
    if (openCountRef.current > 1) {
      // Re-opening: clear user-modified transient state
      setCustomPrompt('')
      setCustomStyleText('')
      setShowAssetPicker(false)
    }
    // Always re-derive references from sourceImage on open
    if (sourceImage) {
      setReferences([{ ...sourceImage, role: 'character' }])
      setCharacterName(sourceImage.characterName || '')
    } else {
      setReferences([])
      setCharacterName('')
    }
  }, [open])

  // Apply preset type and style overrides when opening
  useEffect(() => {
    if (open && presetType) setVariationType(presetType)
    if (open && styleOverrides) {
      if (styleOverrides.styleLevel) setStyleLevel(styleOverrides.styleLevel)
      if (styleOverrides.targetStyle) setTargetStyle(styleOverrides.targetStyle)
    }
  }, [open, presetType, styleOverrides])

  const toggleLock = (key) => setIdentityLocks(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  const toggleOutput = (key) => setOutputSettings(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  const toggleState = (state) => setSelectedStates(prev => prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state])

  const addReference = (asset, role = 'style') => {
    setReferences(prev => {
      if (prev.some(r => r.path === asset.path && r.role === role)) return prev
      return [...prev, { ...asset, role }]
    })
    setShowAssetPicker(false)
  }

  const removeReference = (idx) => setReferences(prev => prev.filter((_, i) => i !== idx))
  const updateReferenceRole = (idx, role) => setReferences(prev => prev.map((r, i) => i === idx ? { ...r, role } : r))

  const handleGenerate = () => {
    if (!sourceImage && references.length === 0 && !customPrompt.trim()) return

    // Build params and CLOSE IMMEDIATELY — generation runs in chat flow
    const resolvedTargetStyle = targetStyle === 'custom'
      ? customStyleText
      : TARGET_STYLES.find(s => s.key === targetStyle)?.prompt || null

    const params = {
      variationType,
      sourceImage: sourceImage ? { id: sourceImage.id, path: sourceImage.path, prompt: sourceImage.prompt, mode: sourceImage.mode } : null,
      references: references.map(r => ({ id: r.id, path: r.path, prompt: r.prompt, mode: r.mode, role: r.role })),
      locks: identityLocks,
      styleLevel,
      targetStyle: resolvedTargetStyle,
      outputSettings,
      characterName: characterName || undefined,
      customPrompt,
      states: variationType === 'sprite_states' ? selectedStates : undefined,
    }
    onClose()
    // Fire-and-forget — Dashboard handles progress in chat
    onGenerate(params)
  }

  const selectedType = VARIATION_TYPES.find(t => t.key === variationType)
  const availableAssets = (assets || []).filter(a => a.path?.startsWith('_generated/') || a.file_type === 'image')

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0 bg-zinc-900 border-zinc-700" data-testid="variation-studio">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-zinc-700/50">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Variation Studio
          </DialogTitle>
          {sourceImage && (
            <p className="text-xs text-muted-foreground mt-1">
              Source: <span className="text-foreground/80 font-mono">{sourceImage.filename || sourceImage.path}</span>
            </p>
          )}
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-140px)]">
          <div className="p-5 space-y-4">

            {/* Variation Type */}
            <Section title="Variation Type">
              <div className="grid grid-cols-2 gap-1.5">
                {VARIATION_TYPES.map(type => {
                  const Icon = type.icon
                  const active = variationType === type.key
                  return (
                    <button key={type.key} onClick={() => setVariationType(type.key)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-left text-xs transition-colors ${active ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40' : 'text-muted-foreground hover:bg-muted/30 border border-transparent'}`}
                      data-testid={`variation-type-${type.key}`}>
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                      <div><p className="font-medium">{type.label}</p><p className="text-[10px] opacity-60">{type.desc}</p></div>
                    </button>
                  )
                })}
              </div>
            </Section>

            {/* State presets */}
            {(variationType === 'sprite_states' || variationType === 'action_variation') && (
              <Section title="Action/State Presets">
                <div className="flex flex-wrap gap-1.5">
                  {STATE_PRESETS.map(state => (
                    <button key={state} onClick={() => toggleState(state)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${selectedStates.includes(state) ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30' : 'text-muted-foreground hover:bg-muted/30 border border-border/30'}`}
                      data-testid={`state-preset-${state}`}>
                      {state}
                    </button>
                  ))}
                </div>
                {variationType === 'sprite_states' && selectedStates.length > 1 && (
                  <p className="text-[10px] text-amber-400/70 mt-2">{selectedStates.length} states — each generated separately</p>
                )}
              </Section>
            )}

            {/* Character Name */}
            {(variationType === 'pose_variation' || variationType === 'action_variation' || variationType === 'sprite_states') && (
              <Section title="Character Identity" defaultOpen={false}>
                <input type="text" value={characterName} onChange={(e) => setCharacterName(e.target.value)}
                  placeholder="Character name (e.g., Hero, Princess)" data-testid="character-name-input"
                  className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50" />
              </Section>
            )}

            {/* Identity Locks (character preservation) */}
            <Section title="Identity Preservation">
              <div className="grid grid-cols-2 gap-1.5">
                {IDENTITY_LOCKS.map(lock => {
                  const active = identityLocks.includes(lock.key)
                  return (
                    <button key={lock.key} onClick={() => toggleLock(lock.key)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${active ? 'bg-amber-600/15 text-amber-300 border border-amber-500/30' : 'text-muted-foreground hover:bg-muted/30 border border-border/30'}`}
                      data-testid={`lock-${lock.key}`}>
                      {active ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3 opacity-40" />}
                      {lock.label}
                    </button>
                  )
                })}
              </div>
            </Section>

            {/* Style Control — separate from identity */}
            <Section title="Style Control">
              <p className="text-[10px] text-muted-foreground mb-2">How much should the rendering style change from the original?</p>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {STYLE_LEVELS.map(level => {
                  const active = styleLevel === level.key
                  return (
                    <button key={level.key} onClick={() => setStyleLevel(level.key)}
                      className={`px-2.5 py-1.5 rounded-md text-[11px] text-left transition-colors ${active ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40' : 'text-muted-foreground hover:bg-muted/30 border border-border/30'}`}
                      data-testid={`style-level-${level.key}`}>
                      <p className="font-medium">{level.label}</p>
                      <p className="text-[9px] opacity-60">{level.desc}</p>
                    </button>
                  )
                })}
              </div>

              {/* Target Style — shown when style is being changed */}
              {(styleLevel === 'moderate' || styleLevel === 'major' || styleLevel === 'replace') && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1.5">Target Style</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {TARGET_STYLES.map(style => {
                      const active = targetStyle === style.key
                      return (
                        <button key={style.key} onClick={() => setTargetStyle(style.key)}
                          className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${active ? 'bg-violet-600/30 text-violet-200 border border-violet-500/40' : 'text-muted-foreground hover:bg-muted/30 border border-border/30'}`}
                          data-testid={`target-style-${style.key}`}>
                          {style.label}
                        </button>
                      )
                    })}
                  </div>
                  {targetStyle === 'custom' && (
                    <input type="text" value={customStyleText} onChange={(e) => setCustomStyleText(e.target.value)}
                      placeholder="Describe the target style (e.g., detailed modern illustrated cartoon)"
                      className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                      data-testid="custom-style-input" />
                  )}
                </div>
              )}
            </Section>

            {/* Output Settings */}
            <Section title="Output Settings">
              <div className="grid grid-cols-2 gap-1.5">
                {OUTPUT_SETTINGS.map(setting => {
                  const active = outputSettings.includes(setting.key)
                  return (
                    <button key={setting.key} onClick={() => toggleOutput(setting.key)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${active ? 'bg-cyan-600/15 text-cyan-300 border border-cyan-500/30' : 'text-muted-foreground hover:bg-muted/30 border border-border/30'}`}
                      data-testid={`output-${setting.key}`}>
                      {active ? <Check className="w-3 h-3" /> : <span className="w-3 h-3" />}
                      {setting.label}
                    </button>
                  )
                })}
              </div>
            </Section>

            {/* Reference Images */}
            <Section title="Reference Images" defaultOpen={references.length > 0}>
              {references.length > 0 && (
                <div className="space-y-2 mb-3">
                  {references.map((ref, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50" data-testid={`reference-${idx}`}>
                      <div className="w-10 h-10 rounded bg-zinc-700 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-4 h-4 text-zinc-500" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-foreground/80 truncate">{ref.filename || ref.path}</p>
                        <Select value={ref.role} onValueChange={(v) => updateReferenceRole(idx, v)}>
                          <SelectTrigger className="h-6 mt-0.5 text-[10px] border-zinc-700 bg-zinc-800 w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {REFERENCE_ROLES.map(role => (<SelectItem key={role.key} value={role.key} className="text-xs">{role.label}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <button onClick={() => removeReference(idx)} className="p-1 text-zinc-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5 border-zinc-700"
                onClick={() => setShowAssetPicker(!showAssetPicker)} data-testid="add-reference-btn">
                <ImageIcon className="w-3 h-3" /> From Assets
              </Button>
              {showAssetPicker && (
                <div className="mt-2 border border-zinc-700 rounded-lg bg-zinc-800/80 max-h-48 overflow-auto" data-testid="asset-picker">
                  {availableAssets.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3">No image assets available</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5 p-2">
                      {availableAssets.map(asset => (
                        <button key={asset.id} onClick={() => addReference(asset, 'style')}
                          className="p-1.5 rounded bg-zinc-900/50 border border-zinc-700/50 hover:border-indigo-500/40 text-left transition-colors">
                          <div className="aspect-square bg-zinc-800 rounded flex items-center justify-center mb-1"><Sparkles className="w-4 h-4 text-indigo-400/30" /></div>
                          <p className="text-[9px] text-foreground/70 truncate">{asset.filename}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="p-2 border-t border-zinc-700">
                    <Button size="sm" variant="ghost" className="text-xs h-6 w-full" onClick={() => setShowAssetPicker(false)}>Close</Button>
                  </div>
                </div>
              )}
            </Section>

            {/* Custom Instructions */}
            <Section title="Custom Instructions" defaultOpen={false}>
              <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Add any additional instructions..." rows={3} data-testid="custom-prompt-input"
                className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none" />
            </Section>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-700/50 flex items-center justify-between" data-testid="variation-studio-footer">
          <div className="text-[11px] text-muted-foreground">
            {selectedType && (
              <span className="flex items-center gap-1.5">
                <selectedType.icon className="w-3 h-3" /> {selectedType.label}
                {styleLevel !== 'preserve' && targetStyle && targetStyle !== 'custom' && (
                  <Badge variant="outline" className="text-[9px] ml-1 text-violet-400 border-violet-500/20">
                    {TARGET_STYLES.find(s => s.key === targetStyle)?.label}
                  </Badge>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} className="text-xs h-8" data-testid="variation-cancel-btn">Cancel</Button>
            <Button size="sm" onClick={handleGenerate} className="text-xs h-8 gap-1.5 bg-indigo-600 hover:bg-indigo-500" data-testid="variation-generate-btn">
              <Sparkles className="w-3 h-3" /> Generate Variation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
