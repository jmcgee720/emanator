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
import { Search, Paintbrush, Settings, LogOut, Users, Shield, AlertTriangle, Plus, Zap, Upload, Sun, BarChart3, Activity, Sparkles, Palette } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import CollaboratorsModal from './CollaboratorsModal'
import AdminPanel from './AdminPanel'
import { getUserRole, hasPermission } from '@/lib/constants'

function AuroralyLogo({ className }) {
  return (
    <img
      src="/auroraly-logo.png"
      alt="Auroraly"
      className={className}
      draggable={false}
    />
  )
}

export default function TopBar({ 
  user, 
  dbUser, 
  selectedProject, 
  onSignOut, 
  onOpenAdmin, 
  onOpenSearch,
  onOpenDesign,
  onOpenCredits,
  onOpenImport,
  onOpenGrowth,
  onOpenAuroraCustomizer,
  isOwner,
  isMonitored,
  auroraIntensity = 'medium',
  onAuroraIntensityChange,
  creditsBalance,
}) {
  const initials = user?.email?.slice(0, 2).toUpperCase() || 'U'
  const effectiveRole = getUserRole(dbUser)
  const canViewAdmin = hasPermission(effectiveRole, 'view_admin')
  const [collabOpen, setCollabOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const role = dbUser?.role || 'member'
  const roleBadgeClass = role === 'owner' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' :
    role === 'admin' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
    role === 'child_monitored' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
    'text-muted-foreground bg-muted/30 border-border/30'

  return (
    <div className="h-12 em-glass-topbar flex items-center justify-between px-5" data-testid="top-bar">
      {/* Brand */}
      <div className="flex items-center">
        <AuroralyLogo className="h-7 w-auto object-contain" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {isMonitored && (
          <div className="flex items-center gap-1 mr-2 px-2 py-0.5 rounded-md bg-red-500/8 border border-red-500/15" data-testid="monitored-indicator">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[9px] text-red-400 font-medium">Monitored</span>
          </div>
        )}

        {/* Credits display */}
        <div className="flex items-center gap-1.5 mr-1" data-testid="credits-display" style={{ filter: 'drop-shadow(0 0 6px rgba(0,229,255,0.25))' }}>
          <Zap className="w-3.5 h-3.5 text-[var(--em-cyan)]" />
          <span className="text-sm font-bold em-gradient-text">
            {creditsBalance === 'unlimited' ? 'UNLIMITED' : creditsBalance !== null && creditsBalance !== undefined ? Number(creditsBalance).toFixed(2) : '—'}
          </span>
        </div>

        {/* Buy Credits button */}
        <button
          onClick={onOpenCredits}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--em-cyan)] text-[#0C1018] hover:brightness-110 transition-all duration-200"
          data-testid="buy-credits-btn"
        >
          Buy Credits
        </button>

        {/* Import Project button */}
        <button
          onClick={onOpenImport}
          className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-[rgba(255,255,255,0.12)] text-[var(--em-text-secondary)] hover:bg-[rgba(255,255,255,0.07)] hover:text-[var(--em-text-primary)] hover:border-[rgba(255,255,255,0.20)] transition-all duration-200"
          data-testid="import-project-btn"
        >
          <span className="flex items-center gap-1.5">
            <Upload className="w-3 h-3" />
            Import
          </span>
        </button>

        {/* Growth Engine button */}
        <button
          onClick={onOpenGrowth}
          className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-[rgba(255,255,255,0.12)] text-[var(--em-text-secondary)] hover:bg-[rgba(255,255,255,0.07)] hover:text-[var(--em-text-primary)] hover:border-[rgba(255,255,255,0.20)] transition-all duration-200"
          data-testid="growth-btn"
        >
          <span className="flex items-center gap-1.5">
            <BarChart3 className="w-3 h-3" />
            Growth
          </span>
        </button>

        <div className="w-px h-4 bg-[rgba(255,255,255,0.10)] mx-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(255,255,255,0.07)] rounded-lg transition-colors duration-200"
              data-testid="aurora-intensity-btn"
              title="Aurora Intensity"
            >
              <Sun className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36" align="end" forceMount>
            <div className="px-2 py-1.5">
              <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Aurora Intensity</p>
              <div className="flex gap-1">
                {['low', 'medium', 'high'].map((level) => (
                  <button
                    key={level}
                    onClick={() => onAuroraIntensityChange?.(level)}
                    className={`flex-1 py-1 rounded-md text-[10px] font-medium capitalize transition-all duration-150 ${
                      auroraIntensity === level
                        ? 'bg-[var(--em-cyan)] text-[#0C1018]'
                        : 'text-muted-foreground hover:text-[var(--em-text-primary)] hover:bg-[rgba(255,255,255,0.06)]'
                    }`}
                    data-testid={`aurora-intensity-${level}`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSearch}
          className="h-7 w-7 em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(255,255,255,0.07)] rounded-lg transition-colors duration-200"
          data-testid="search-btn"
        >
          <Search className="w-3.5 h-3.5" />
        </Button>

        {canViewAdmin && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAdminOpen(true)}
            className="h-7 w-7 em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(255,255,255,0.07)] rounded-lg transition-colors duration-200"
            title="User Management"
            data-testid="admin-btn"
          >
            <Users className="w-3.5 h-3.5" />
          </Button>
        )}

        {selectedProject && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenDesign}
            className="h-7 w-7 em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(255,255,255,0.07)] rounded-lg transition-colors duration-200"
            title={isMonitored ? 'Restricted for monitored accounts' : 'Design Intelligence'}
            disabled={isMonitored}
            data-testid="design-btn"
          >
            <Paintbrush className="w-3.5 h-3.5" />
          </Button>
        )}

        <div className="w-px h-4 bg-[rgba(255,255,255,0.10)] mx-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-7 w-7 rounded-full p-0" data-testid="user-menu-btn">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-[var(--em-surface)] text-[var(--em-text-secondary)] text-[9px] font-semibold border border-[rgba(255,255,255,0.10)]">
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
            <DropdownMenuItem asChild data-testid="analytics-menu-item">
              <Link href="/analytics" className="cursor-pointer">
                <Activity className="mr-2 h-4 w-4" />
                Build analytics
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild data-testid="pricing-menu-item">
              <Link href="/pricing" className="cursor-pointer">
                <Sparkles className="mr-2 h-4 w-4" />
                Buy credits
              </Link>
            </DropdownMenuItem>
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
      {adminOpen && (
        <AdminPanel
          user={user}
          dbUser={dbUser}
          onClose={() => setAdminOpen(false)}
        />
      )}
      <CollaboratorsModal
        open={collabOpen}
        onClose={() => setCollabOpen(false)}
        projectId={selectedProject?.id}
        projectName={selectedProject?.name}
      />
    </div>
  )
}
