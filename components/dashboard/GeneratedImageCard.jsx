'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { X, Maximize2, Download, Loader2, Sparkles, Move, Palette, Layers, User2, MoreVertical } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

export default function GeneratedImageCard({ image, compact, onOpenVariationStudio }) {
  const [enlarged, setEnlarged] = useState(false)
  const [imageData, setImageData] = useState(image?.imageData || null)
  const [loading, setLoading] = useState(false)

  if (!image) return null

  const { path, filename, prompt, mode, size, revisedPrompt, duration, projectId, variationType, sourceAssetPath, stateName } = image

  // Fetch image data from API if not provided inline
  useEffect(() => {
    if (imageData || !path || !projectId) return
    let cancelled = false
    setLoading(true)
    authFetch(`/api/projects/${projectId}/asset-content?path=${encodeURIComponent(path)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data?.content) setImageData(data.content)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path, projectId, imageData])

  const openStudio = (presetType) => {
    if (onOpenVariationStudio) {
      onOpenVariationStudio({ ...image, imageData }, presetType)
    }
  }

  const openStudioWithStyle = (targetStyleKey, targetStyleLabel) => {
    if (onOpenVariationStudio) {
      onOpenVariationStudio({ ...image, imageData }, 'style_variation', {
        styleLevel: 'replace',
        targetStyle: targetStyleKey,
      })
    }
  }

  return (
    <>
      <div
        className="mt-3 rounded-xl border border-border/50 overflow-hidden bg-muted/20"
        data-testid="generated-image-card"
      >
        {/* Image display */}
        {loading ? (
          <div className="flex items-center justify-center py-8 bg-zinc-900/30">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400 mr-2" />
            <span className="text-xs text-muted-foreground">Loading image...</span>
          </div>
        ) : imageData ? (
          <div
            className={`relative group cursor-pointer ${compact ? 'max-h-[200px]' : 'max-h-[400px]'} overflow-hidden`}
            onClick={() => setEnlarged(true)}
          >
            <img
              src={imageData}
              alt={prompt || filename}
              className="w-full object-contain bg-zinc-900/50"
              data-testid="generated-image"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 bg-zinc-900/30 text-xs text-muted-foreground">
            Image saved as {path}
          </div>
        )}

        {/* Metadata + actions bar */}
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[9px]">{mode || 'image'}</Badge>
          {variationType && <Badge variant="outline" className="text-[9px] text-violet-400 border-violet-500/20">{variationType.replace(/_/g, ' ')}</Badge>}
          {stateName && <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/20">{stateName}</Badge>}
          <span>{size || '1024x1024'}</span>
          {duration && <span>{(duration / 1000).toFixed(1)}s</span>}
          <span className="truncate flex-1 text-right">{filename}</span>

          {/* Variation actions dropdown */}
          {onOpenVariationStudio && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 ml-1" data-testid="image-actions-menu">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => openStudio('pose_variation')} data-testid="action-variations">
                  <Sparkles className="w-3.5 h-3.5 mr-2 text-indigo-400" /> Generate Variations
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openStudio('style_variation')} data-testid="action-use-reference">
                  <Palette className="w-3.5 h-3.5 mr-2 text-violet-400" /> Use as Reference
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openStudio('pose_variation')} data-testid="action-new-pose">
                  <Move className="w-3.5 h-3.5 mr-2 text-green-400" /> Same Style, New Pose
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openStudio('action_variation')} data-testid="action-new-action">
                  <User2 className="w-3.5 h-3.5 mr-2 text-blue-400" /> Same Character, New Action
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openStudio('sprite_states')} data-testid="action-sprite-states">
                  <Layers className="w-3.5 h-3.5 mr-2 text-amber-400" /> Create Sprite States
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openStudio('icon_variant')} data-testid="action-icon-variant">
                  <Layers className="w-3.5 h-3.5 mr-2 text-cyan-400" /> Create Icon Variant
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openStudioWithStyle('modern_cartoon', 'Modern Cartoon')} data-testid="action-style-cartoon">
                  <Palette className="w-3.5 h-3.5 mr-2 text-pink-400" /> Restyle → Modern Cartoon
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openStudioWithStyle('anime', 'Anime')} data-testid="action-style-anime">
                  <Palette className="w-3.5 h-3.5 mr-2 text-rose-400" /> Restyle → Anime
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openStudioWithStyle('detailed_illustration', 'Illustration')} data-testid="action-style-illustration">
                  <Palette className="w-3.5 h-3.5 mr-2 text-orange-400" /> Restyle → Illustration
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Relationship info */}
        {sourceAssetPath && (
          <div className="px-3 pb-2 text-[10px] text-muted-foreground/60">
            Variation of <span className="font-mono text-foreground/50">{sourceAssetPath.replace('_generated/', '')}</span>
          </div>
        )}
      </div>

      {/* Enlarged modal */}
      {enlarged && imageData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setEnlarged(false)}
          data-testid="image-enlarge-modal"
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setEnlarged(false)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={imageData}
              alt={prompt || filename}
              className="max-w-full max-h-[85vh] rounded-lg object-contain"
            />
            <div className="mt-2 flex items-center justify-between px-2">
              <div className="text-xs text-zinc-400">
                <span>{mode} · {size}</span>
                {revisedPrompt && <p className="mt-1 max-w-lg truncate">{revisedPrompt}</p>}
              </div>
              <div className="flex gap-2">
                {onOpenVariationStudio && (
                  <button
                    onClick={() => { setEnlarged(false); openStudio('pose_variation') }}
                    className="p-1.5 rounded bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 hover:text-indigo-300"
                    title="Open Variation Studio"
                    data-testid="enlarge-variation-btn"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = imageData
                    a.download = filename || 'generated.png'
                    a.click()
                  }}
                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
