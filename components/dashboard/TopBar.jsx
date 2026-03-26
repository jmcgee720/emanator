'use client'

import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Search, BookOpen, Paintbrush, Settings, LogOut, Users, Shield, AlertTriangle } from 'lucide-react'
import { getUserRole, hasPermission } from '@/lib/constants'

function EmanatorLogo({ className }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className}>
      <defs>
        <linearGradient id="em-logo-grad" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#00E5FF" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#E040FB" />
        </linearGradient>
      </defs>
      <path d="M16 4C16 4 20 10 20 16C20 22 16 28 16 28C16 28 12 22 12 16C12 10 16 4 16 4Z" fill="url(#em-logo-grad)" opacity="0.9"/>
      <path d="M6.8 22C6.8 22 13.6 20 17.6 14.8C21.6 9.6 22 2.4 22 2.4C22 2.4 15.2 4.4 11.2 9.6C7.2 14.8 6.8 22 6.8 22Z" fill="url(#em-logo-grad)" opacity="0.7"/>
      <path d="M25.2 22C25.2 22 18.4 20 14.4 14.8C10.4 9.6 10 2.4 10 2.4C10 2.4 16.8 4.4 20.8 9.6C24.8 14.8 25.2 22 25.2 22Z" fill="url(#em-logo-grad)" opacity="0.7"/>
    </svg>
  )
}

export default function TopBar({ 
  user, 
  dbUser, 
  selectedProject, 
  onSignOut, 
  onOpenAdmin, 
  onOpenSearch,
  onOpenCanvas,
  onOpenDesign,
  isOwner,
  isMonitored
}) {
  const initials = user?.email?.slice(0, 2).toUpperCase() || 'U'
  const canViewAdmin = hasPermission(getUserRole(dbUser), 'view_admin')
  const role = dbUser?.role || 'member'
  const roleBadgeClass = role === 'owner' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' :
    role === 'admin' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
    role === 'child_monitored' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
    'text-muted-foreground bg-muted/30 border-border/30'

  return (
    <div className="h-12 bg-[hsl(var(--em-sidebar))] backdrop-blur-md flex items-center justify-between px-5 em-accent-edge-bottom" data-testid="top-bar">
      {/* Brand + breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <EmanatorLogo className="w-6 h-6" />
          <span className="font-bold text-[13px] tracking-[0.08em] uppercase em-gradient-text select-none" data-testid="brand-name">Emanator</span>
        </div>
        
        {selectedProject && (
          <>
            <span className="text-muted-foreground/25 text-xs select-none">/</span>
            <span className="text-xs text-muted-foreground/60 font-medium truncate max-w-[180px]">{selectedProject.name}</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5">
        {isMonitored && (
          <div className="flex items-center gap-1 mr-2 px-2 py-0.5 rounded-md bg-red-500/8 border border-red-500/15" data-testid="monitored-indicator">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[9px] text-red-400 font-medium">Monitored</span>
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSearch}
          className="h-7 w-7 text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/40 rounded-md"
          data-testid="search-btn"
        >
          <Search className="w-3.5 h-3.5" />
        </Button>

        {selectedProject && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenCanvas}
            className="h-7 w-7 text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/40 rounded-md"
            title={isMonitored ? 'Restricted for monitored accounts' : 'Project Knowledge Canvas'}
            disabled={isMonitored}
            data-testid="canvas-btn"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </Button>
        )}

        {selectedProject && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenDesign}
            className="h-7 w-7 text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/40 rounded-md"
            title={isMonitored ? 'Restricted for monitored accounts' : 'Design Intelligence'}
            disabled={isMonitored}
            data-testid="design-btn"
          >
            <Paintbrush className="w-3.5 h-3.5" />
          </Button>
        )}

        <div className="w-px h-4 bg-border/40 mx-1.5" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-7 w-7 rounded-full p-0" data-testid="user-menu-btn">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-muted/60 text-muted-foreground/70 text-[9px] font-semibold border border-border/40">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48" align="end" forceMount>
            <div className="flex flex-col space-y-0.5 px-3 py-2">
              <p className="text-xs font-medium leading-none">{user?.email}</p>
              <span className={`inline-flex items-center gap-1 text-[10px] leading-none mt-1 px-1.5 py-0.5 rounded-sm border w-fit ${roleBadgeClass}`} data-testid="role-badge">
                {role === 'owner' && <Shield className="w-2.5 h-2.5" />}
                {role === 'child_monitored' ? 'Monitored' : role}
              </span>
            </div>
            <DropdownMenuSeparator />
            {canViewAdmin && (
              <DropdownMenuItem onClick={onOpenAdmin} data-testid="admin-menu-item">
                <Users className="mr-2 h-4 w-4" />
                User Management
                {isOwner && <span className="ml-auto text-[9px] text-cyan-400/60">owner</span>}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut} className="text-destructive" data-testid="signout-btn">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
