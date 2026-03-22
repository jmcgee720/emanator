'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { authFetch } from '@/lib/auth-fetch'
import {
  ImageIcon, Download, Sparkles, Filter, Layers, Upload, X, Maximize2,
  MoreVertical, Move, Palette, User2, Link2, Eye
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'base', label: 'Base' },
  { key: 'variation', label: 'Variations' },
  { key: 'sprite', label: 'Sprites' },
  { key: 'icon', label: 'Icons' },
  { key: 'background', label: 'Backgrounds' },
  { key: 'uploaded', label: 'Uploaded' },
]

export default function AssetsTab({ projectId, onOpenVariationStudio, refreshKey }) {
  const [assets, setAssets] = useState([])
  const [relationships, setRelationships] = useState({ relationships: [], characters: {} })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [enlarged, setEnlarged] = useState(null)
  const [imageCache, setImageCache] = useState({})

  useEffect(() => {
    if (!projectId) return
    loadAssets()
    loadRelationships()
  }, [projectId, refreshKey])

  const loadAssets = async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/projects/${projectId}/assets`)
      if (res.ok) {
        const data = await res.json()
        setAssets(Array.isArray(data) ? data : [])
      }
    } catch {}
    setLoading(false)
  }

  const loadRelationships = async () => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/asset-relationships`)
      if (res.ok) {
        const data = await res.json()
        setRelationships(data)
      }
    } catch {}
  }

  const getRelationship = (assetId) => {
    return relationships.relationships?.find(r => r.asset_id === assetId)
  }

  const getChildCount = (assetPath) => {
    return relationships.relationships?.filter(r => r.source_asset_path === assetPath).length || 0
  }

  const isVariation = (assetId) => {
    return !!getRelationship(assetId)
  }

  const isBase = (assetPath) => {
    return getChildCount(assetPath) > 0
  }

  const loadImageForAsset = async (asset) => {
    if (imageCache[asset.path]) return imageCache[asset.path]
    try {
      const res = await authFetch(`/api/projects/${projectId}/asset-content?path=${encodeURIComponent(asset.path)}`)
      if (res.ok) {
        const data = await res.json()
        if (data?.content) {
          setImageCache(prev => ({ ...prev, [asset.path]: data.content }))
          return data.content
        }
      }
    } catch {}
    return null
  }

  const filtered = assets.filter(a => {
    const rel = getRelationship(a.id)
    if (filter === 'all') return true
    if (filter === 'base') return !rel && a.type === 'generated'
    if (filter === 'variation') return !!rel
    if (filter === 'sprite') return a.category === 'sprite' || rel?.variation_type === 'sprite_states' || rel?.variation_type === 'action_variation'
    if (filter === 'icon') return a.category === 'icon' || rel?.variation_type === 'icon_variant'
    if (filter === 'background') return a.category === 'background' || rel?.variation_type === 'background_variation'
    if (filter === 'uploaded') return a.type === 'uploaded'
    return true
  })

  return (
    <div className="h-full flex flex-col" data-testid="assets-tab">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/25 overflow-x-auto" data-testid="asset-filters">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
              filter === tab.key
                ? 'bg-primary/15 text-primary border border-primary/25'
                : 'text-muted-foreground hover:bg-muted/30 border border-transparent'
            }`}
            data-testid={`filter-${tab.key}`}
          >
            {tab.label}
            {tab.key !== 'all' && (() => {
              const count = assets.filter(a => {
                const rel = getRelationship(a.id)
                if (tab.key === 'base') return !rel && a.type === 'generated'
                if (tab.key === 'variation') return !!rel
                if (tab.key === 'sprite') return a.category === 'sprite' || rel?.variation_type === 'sprite_states'
                if (tab.key === 'icon') return a.category === 'icon' || rel?.variation_type === 'icon_variant'
                if (tab.key === 'background') return a.category === 'background' || rel?.variation_type === 'background_variation'
                if (tab.key === 'uploaded') return a.type === 'uploaded'
                return false
              }).length
              return count > 0 ? <span className="ml-1 opacity-50">{count}</span> : null
            })()}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-8">
            <ImageIcon className="w-8 h-8 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">No assets found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {filter === 'all'
                ? 'Generate images using the chat to add assets.'
                : `No ${filter} assets yet.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3" data-testid="assets-grid">
            {filtered.map(asset => {
              const rel = getRelationship(asset.id)
              const childCount = getChildCount(asset.path)
              const isBaseAsset = childCount > 0 && !rel

              return (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  relationship={rel}
                  isBaseAsset={isBaseAsset}
                  childCount={childCount}
                  projectId={projectId}
                  imageCache={imageCache}
                  onLoadImage={loadImageForAsset}
                  onEnlarge={() => setEnlarged(asset)}
                  onOpenVariationStudio={onOpenVariationStudio}
                />
              )
            })}
          </div>
        )}
      </ScrollArea>

      {/* Enlarged modal */}
      {enlarged && (
        <EnlargeModal
          asset={enlarged}
          projectId={projectId}
          imageCache={imageCache}
          onLoadImage={loadImageForAsset}
          onClose={() => setEnlarged(null)}
          onOpenVariationStudio={onOpenVariationStudio}
        />
      )}
    </div>
  )
}

function AssetCard({ asset, relationship, isBaseAsset, childCount, projectId, imageCache, onLoadImage, onEnlarge, onOpenVariationStudio }) {
  const [imgSrc, setImgSrc] = useState(imageCache[asset.path] || null)
  const [loadingImg, setLoadingImg] = useState(false)

  useEffect(() => {
    if (imgSrc || loadingImg) return
    setLoadingImg(true)
    onLoadImage(asset).then(data => {
      if (data) setImgSrc(data)
      setLoadingImg(false)
    })
  }, [asset.path])

  // Update from cache
  useEffect(() => {
    if (imageCache[asset.path] && !imgSrc) setImgSrc(imageCache[asset.path])
  }, [imageCache[asset.path]])

  return (
    <div
      className="group rounded-lg border border-border/25 bg-muted/20 overflow-hidden hover:border-primary/25 transition-colors"
      data-testid={`asset-card-${asset.id}`}
    >
      {/* Thumbnail */}
      <div className="aspect-square relative bg-muted/30 cursor-pointer" onClick={onEnlarge}>
        {loadingImg ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
          </div>
        ) : imgSrc ? (
          <img src={imgSrc} alt={asset.filename} className="w-full h-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-70 transition-opacity" />
        </div>

        {/* Badges overlay */}
        <div className="absolute top-1 left-1 flex flex-wrap gap-0.5">
          {isBaseAsset && (
            <Badge className="text-[8px] px-1 py-0 bg-primary/60 text-primary-foreground border-0">Base</Badge>
          )}
          {relationship && (
            <Badge className="text-[8px] px-1 py-0 bg-violet-600/80 text-white border-0">
              {relationship.variation_type?.replace(/_/g, ' ').slice(0, 12)}
            </Badge>
          )}
          {relationship?.state_name && (
            <Badge className="text-[8px] px-1 py-0 bg-emerald-600/80 text-white border-0">
              {relationship.state_name}
            </Badge>
          )}
        </div>

        {childCount > 0 && (
          <div className="absolute top-1 right-1">
            <Badge className="text-[8px] px-1 py-0 bg-muted/60 text-muted-foreground border border-border/40">
              <Link2 className="w-2.5 h-2.5 mr-0.5" />{childCount}
            </Badge>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-2 py-1.5 flex items-center gap-1">
        <p className="text-[10px] text-foreground/70 truncate flex-1">{asset.filename}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`asset-menu-${asset.id}`}>
              <MoreVertical className="w-3 h-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onOpenVariationStudio?.({
              id: asset.id, path: asset.path, filename: asset.filename,
              prompt: '', mode: asset.category || 'image', projectId,
            }, 'pose_variation')} data-testid={`asset-open-studio-${asset.id}`}>
              <Sparkles className="w-3.5 h-3.5 mr-2 text-primary" /> Open in Variation Studio
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenVariationStudio?.({
              id: asset.id, path: asset.path, filename: asset.filename,
              prompt: '', mode: asset.category || 'image', projectId,
            }, 'style_variation')} data-testid={`asset-use-reference-${asset.id}`}>
              <Palette className="w-3.5 h-3.5 mr-2 text-violet-400" /> Use as Reference
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpenVariationStudio?.({
              id: asset.id, path: asset.path, filename: asset.filename,
              prompt: '', mode: 'sprite', projectId,
            }, 'sprite_states')} data-testid={`asset-sprite-states-${asset.id}`}>
              <Layers className="w-3.5 h-3.5 mr-2 text-amber-400" /> Create Sprite States
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenVariationStudio?.({
              id: asset.id, path: asset.path, filename: asset.filename,
              prompt: '', mode: 'icon', projectId,
            }, 'icon_variant')} data-testid={`asset-icon-variant-${asset.id}`}>
              <Layers className="w-3.5 h-3.5 mr-2 text-cyan-400" /> Create Icon Variant
            </DropdownMenuItem>
            {imgSrc && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => {
                  const a = document.createElement('a')
                  a.href = imgSrc
                  a.download = asset.filename || 'asset.png'
                  a.click()
                }}>
                  <Download className="w-3.5 h-3.5 mr-2" /> Download
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function EnlargeModal({ asset, projectId, imageCache, onLoadImage, onClose, onOpenVariationStudio }) {
  const [imgSrc, setImgSrc] = useState(imageCache[asset.path] || null)

  useEffect(() => {
    if (!imgSrc) {
      onLoadImage(asset).then(data => { if (data) setImgSrc(data) })
    }
  }, [asset.path])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose} data-testid="asset-enlarge-modal">
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-card border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground z-10"
        >
          <X className="w-4 h-4" />
        </button>
        {imgSrc ? (
          <img src={imgSrc} alt={asset.filename} className="max-w-full max-h-[85vh] rounded-lg object-contain" />
        ) : (
          <div className="w-64 h-64 rounded-lg bg-muted/30 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
          </div>
        )}
        <div className="mt-2 flex items-center justify-between px-2">
          <p className="text-xs text-muted-foreground truncate max-w-xs">{asset.filename}</p>
          <div className="flex gap-2">
            {onOpenVariationStudio && (
              <button
                onClick={() => {
                  onClose()
                  onOpenVariationStudio?.({ id: asset.id, path: asset.path, filename: asset.filename, prompt: '', mode: asset.category || 'image', projectId }, 'pose_variation')
                }}
                className="p-1.5 rounded bg-primary/15 hover:bg-primary/25 text-primary"
                title="Open Variation Studio"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            )}
            {imgSrc && (
              <button
                onClick={() => {
                  const a = document.createElement('a')
                  a.href = imgSrc
                  a.download = asset.filename || 'asset.png'
                  a.click()
                }}
                className="p-1.5 rounded bg-muted/40 hover:bg-muted/60 text-muted-foreground"
                title="Download"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
