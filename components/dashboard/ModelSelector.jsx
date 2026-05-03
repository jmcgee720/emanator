'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Brain, ChevronDown, Zap, Check, CircleAlert, CircleDollarSign, ShieldAlert, WifiOff, Sparkles } from 'lucide-react'

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: Zap,
    models: [
      { id: 'gpt-5.2',     name: 'GPT-5.2',     badge: 'Latest',      badgeColor: 'text-sky-400 border-sky-400/30' },
      { id: 'gpt-5.1',     name: 'GPT-5.1',     badge: 'Recommended', badgeColor: 'text-emerald-400 border-emerald-400/30' },
      { id: 'gpt-4o',      name: 'GPT-4o',      badge: 'Proven',      badgeColor: 'text-blue-400 border-blue-400/30' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', badge: 'Fast',        badgeColor: 'text-green-400 border-green-400/30' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: Brain,
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', badge: 'Balanced', badgeColor: 'text-amber-400 border-amber-400/30' },
      { id: 'claude-opus-4-5-20251101',   name: 'Claude Opus 4.5',   badge: 'Powerful', badgeColor: 'text-purple-400 border-purple-400/30' },
      { id: 'claude-haiku-4-5-20251001',  name: 'Claude Haiku 4.5',  badge: 'Fast',     badgeColor: 'text-green-400 border-green-400/30' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google',
    icon: Sparkles,
    models: [
      { id: 'gemini-2.5-pro',         name: 'Gemini 2.5 Pro',      badge: 'Recommended', badgeColor: 'text-emerald-400 border-emerald-400/30' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash',      badge: 'Preview',     badgeColor: 'text-cyan-400 border-cyan-400/30' },
      { id: 'gemini-2.5-flash',       name: 'Gemini 2.5 Flash',    badge: 'Fast',        badgeColor: 'text-green-400 border-green-400/30' },
    ],
  },
]

const STATUS_CONFIG = {
  ready:         { label: 'Ready',         color: 'text-green-400 border-green-400/30', icon: Check },
  billing_issue: { label: 'Billing issue', color: 'text-amber-400 border-amber-400/30', icon: CircleDollarSign },
  auth_issue:    { label: 'Auth issue',    color: 'text-red-400 border-red-400/30',    icon: ShieldAlert },
  unavailable:   { label: 'Unavailable',   color: 'text-red-400 border-red-400/30',    icon: WifiOff },
  no_key:        { label: 'No key',        color: 'text-zinc-500 border-zinc-500/30',  icon: CircleAlert },
  unknown:       { label: 'Unknown',       color: 'text-zinc-500 border-zinc-500/30',  icon: CircleAlert },
}

const MODEL_COST_TIERS = {
  'gpt-5.2':                          { credits: 1.5, label: 'Premium' },
  'gpt-5.1':                          { credits: 1.25, label: 'High' },
  'gpt-4o':                           { credits: 1.0, label: 'High' },
  'gpt-4o-mini':                      { credits: 0.25, label: 'Standard' },
  'o3':                               { credits: 2.0, label: 'Premium' },
  'claude-sonnet-4-5-20250929':       { credits: 1.25, label: 'High' },
  'claude-opus-4-5-20251101':         { credits: 2.5, label: 'Premium' },
  'claude-haiku-4-5-20251001':        { credits: 0.3, label: 'Standard' },
  'gemini-2.5-pro':                   { credits: 1.0, label: 'High' },
  'gemini-3-flash-preview':           { credits: 0.5, label: 'Standard' },
  'gemini-2.5-flash':                 { credits: 0.25, label: 'Standard' },
}

const SMALL_MODELS_FOR_BUILD = new Set([
  'gpt-4o-mini',
  'claude-haiku-4-5-20251001',
  'gemini-2.5-flash',
])

const MODEL_NOTES = {
  'gpt-4o-mini': 'Best for quick edits — may struggle with initial app builds.',
  'claude-haiku-4-5-20251001': 'Best for quick edits — may struggle with initial app builds.',
  'gemini-2.5-flash': 'Best for quick edits — may struggle with initial app builds.',
}

// Silence unused-var lint while keeping the constant available for future
// runtime guards in the dashboard (initial-build check).
void SMALL_MODELS_FOR_BUILD

const COST_COLORS = {
  Standard: 'text-emerald-400/70',
  High:     'text-amber-400/70',
  Premium:  'text-rose-400/70',
}

export default function ModelSelector({ provider, model, onProviderChange, onModelChange, providerStatus }) {
  const currentProvider = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0]
  const currentModel = currentProvider.models.find(m => m.id === model) ||
    PROVIDERS.flatMap(p => p.models).find(m => m.id === model) ||
    currentProvider.models[0]

  const ProviderIcon = currentProvider.icon

  const handleSelect = (providerId, modelId) => {
    onProviderChange(providerId)
    onModelChange(modelId)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs em-btn-ghost"
          data-testid="model-selector"
        >
          <ProviderIcon className="w-3 h-3" />
          <span className="truncate max-w-[100px]">{currentModel.name}</span>
          {providerStatus?.[provider] && providerStatus[provider].status !== 'ready' && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72 border-[rgba(124,58,237,0.15)]">
        {PROVIDERS.map((prov, idx) => {
          const Icon = prov.icon
          const pStatus = providerStatus?.[prov.id]
          const statusKey = pStatus?.status || 'unknown'
          const sc = STATUS_CONFIG[statusKey] || STATUS_CONFIG.unknown
          const StatusIcon = sc.icon

          return (
            <div key={prov.id}>
              {idx > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5" />
                  {prov.name}
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] gap-1 px-1.5 py-0 font-normal ${sc.color}`}
                  data-testid={`provider-status-${prov.id}`}
                >
                  <StatusIcon className="w-2.5 h-2.5" />
                  {sc.label}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                {prov.models.map((m) => {
                  const isDisabled = statusKey !== 'ready' && statusKey !== 'unknown' && statusKey !== 'billing_issue'
                  const note = MODEL_NOTES[m.id]
                  return (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => handleSelect(prov.id, m.id)}
                      className={`cursor-pointer ${isDisabled ? 'opacity-50' : ''}`}
                      data-testid={`model-option-${m.id}`}
                    >
                      <div className="flex flex-col w-full gap-0.5">
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            {provider === prov.id && model === m.id && (
                              <Check className="w-3 h-3 text-primary" />
                            )}
                            <span className={provider === prov.id && model === m.id ? 'font-medium' : ''}>
                              {m.name}
                            </span>
                          </div>
                          <Badge variant="outline" className={`text-[10px] ${m.badgeColor}`}>
                            {m.badge}
                          </Badge>
                          {MODEL_COST_TIERS[m.id] && (
                            <span className={`text-[9px] font-normal ml-1 ${COST_COLORS[MODEL_COST_TIERS[m.id].label] || 'text-zinc-500'}`} data-testid={`model-cost-${m.id}`}>
                              {MODEL_COST_TIERS[m.id].credits} cr
                            </span>
                          )}
                        </div>
                        {note && (
                          <span className="text-[9px] text-amber-400/70 italic pl-5" data-testid={`model-note-${m.id}`}>
                            {note}
                          </span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuGroup>
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
