'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Layers, Cpu, FolderSearch, ChevronDown } from 'lucide-react'

const SCOPES = [
  {
    id: 'project',
    name: 'Project',
    description: 'Current project files & canvas',
    icon: Layers,
    color: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  },
  {
    id: 'platform',
    name: 'Platform',
    description: 'Auroraly architecture & internals',
    icon: Cpu,
    color: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  },
  {
    id: 'workspace',
    name: 'Workspace',
    description: 'Search across all projects',
    icon: FolderSearch,
    color: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
  },
]

export default function ScopeSelector({ scope, onScopeChange }) {
  const current = SCOPES.find(s => s.id === scope) || SCOPES[0]
  const Icon = current.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs border-border/60 bg-muted/40 hover:bg-muted"
          data-testid="scope-selector"
        >
          <Icon className="w-3 h-3" />
          <span>{current.name}</span>
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        {SCOPES.map((s) => {
          const ScopeIcon = s.icon
          const isActive = scope === s.id
          return (
            <DropdownMenuItem
              key={s.id}
              onClick={() => onScopeChange(s.id)}
              className="cursor-pointer flex items-start gap-3 py-2"
              data-testid={`scope-option-${s.id}`}
            >
              <ScopeIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${isActive ? 'font-medium text-foreground' : ''}`}>
                    {s.name}
                  </span>
                  {isActive && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-primary border-primary/30">
                      active
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
