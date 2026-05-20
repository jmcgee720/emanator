'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Users,
  UserPlus,
  Trash2,
  Shield,
  ShieldCheck,
  User,
  Loader2,
  Mail,
  Activity,
  Settings,
  FileText,
  GitBranch,
  XCircle,
  CheckCircle,
  Clock,
  UserCog,
  Eye,
  MessageSquare,
  Tag,
  Plus,
  Copy,
  Gift,
  X
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getUserRole, hasPermission } from '@/lib/constants'

const ACTION_LABELS = {
  plan: 'Plan Execution',
  apply: 'Diff Apply',
  discard: 'Diff Discard',
  self_edit_chat: 'Self-Edit Chat Created',
  role_change: 'Role Change',
  file_create: 'File Created',
  file_update: 'File Updated',
  file_delete: 'File Deleted',
  monitored_prompt: 'Monitored Prompt',
}

const ACTION_ICONS = {
  plan: GitBranch,
  apply: CheckCircle,
  discard: XCircle,
  self_edit_chat: Settings,
  role_change: UserCog,
  file_create: FileText,
  file_update: FileText,
  file_delete: Trash2,
  monitored_prompt: MessageSquare,
}

const ACTION_COLORS = {
  plan: 'text-blue-400',
  apply: 'text-emerald-400',
  discard: 'text-red-400',
  self_edit_chat: 'text-amber-400',
  role_change: 'text-violet-400',
  file_create: 'text-green-400',
  file_update: 'text-cyan-400',
  file_delete: 'text-red-400',
  monitored_prompt: 'text-rose-400',
}

const ROLE_STYLES = {
  owner: { icon: Shield, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  admin: { icon: ShieldCheck, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  member: { icon: User, color: 'text-primary', bg: 'bg-primary/10' },
  child_monitored: { icon: Eye, color: 'text-rose-400', bg: 'bg-rose-500/10' },
  system: { icon: Settings, color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
}

function RoleBadge({ role }) {
  const style = ROLE_STYLES[role] || ROLE_STYLES.member
  const Icon = style.icon
  const label = role === 'child_monitored' ? 'monitored' : role
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${style.bg} ${style.color}`}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  )
}

function relativeTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString()
}

export default function AdminPanel({ user, dbUser, onClose }) {
  // Admin panel with user management and promo codes [v2]
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [activity, setActivity] = useState([])
  const [monitored, setMonitored] = useState([])
  const [promoCodes, setPromoCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState('member')
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [promoDescription, setPromoDescription] = useState('')
  const { toast } = useToast()

  const effectiveRole = getUserRole(dbUser)
  const canManage = hasPermission(effectiveRole, 'manage_users')
  const canViewMonitored = hasPermission(effectiveRole, 'view_monitored')

  useEffect(() => { loadUsers() }, [])
  useEffect(() => {
    if (tab === 'activity') loadActivity()
    if (tab === 'monitored') loadMonitored()
    if (tab === 'promo') loadPromoCodes()
  }, [tab])

  const loadUsers = async () => {
    try {
      const r = await authFetch('/api/admin/users')
      const d = await r.json()
      setUsers(Array.isArray(d) ? d : [])
    } catch { } finally { setLoading(false) }
  }

  const loadActivity = async () => {
    try {
      const r = await authFetch('/api/admin/activity')
      const d = await r.json()
      setActivity(Array.isArray(d) ? d : [])
    } catch { }
  }

  const loadMonitored = async () => {
    try {
      const r = await authFetch('/api/admin/monitored')
      if (r.ok) {
        const d = await r.json()
        setMonitored(Array.isArray(d) ? d : [])
      }
    } catch { }
  }

  const loadPromoCodes = async () => {
    try {
      const r = await authFetch('/api/admin/promo-codes')
      const d = await r.json()
      setPromoCodes(Array.isArray(d) ? d : [])
    } catch { }
  }

  const addUser = async () => {
    if (!newEmail.trim()) return
    setAdding(true)
    try {
      const r = await authFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, role: newRole })
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      const newUser = await r.json()
      setUsers([...users, newUser])
      setNewEmail('')
      toast({ title: 'User Added', description: `${newEmail} added as ${newRole}` })
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' })
    } finally { setAdding(false) }
  }

  const updateUserRole = async (userId, role) => {
    try {
      await authFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      })
      setUsers(users.map(u => u.id === userId ? { ...u, role } : u))
      toast({ title: 'Role Updated' })
    } catch {
      toast({ title: 'Error', description: 'Failed to update role', variant: 'destructive' })
    }
  }

  const removeUser = async (userId) => {
    try {
      await authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      setUsers(users.filter(u => u.id !== userId))
      toast({ title: 'User Removed' })
    } catch {
      toast({ title: 'Error', description: 'Failed to remove user', variant: 'destructive' })
    }
  }

  const generatePromoCode = async () => {
    if (!promoDescription.trim()) return
    setGenerating(true)
    try {
      const r = await authFetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'unlimited', max_uses: 1, description: promoDescription })
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      const newCode = await r.json()
      setPromoCodes([newCode, ...promoCodes])
      setPromoDescription('')
      toast({ title: 'Promo Code Generated', description: newCode.code })
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' })
    } finally { setGenerating(false) }
  }

  const copyPromoCode = (code) => {
    navigator.clipboard.writeText(code)
    toast({ title: 'Copied!', description: `Code ${code} copied to clipboard` })
  }

  const monitoredCount = users.filter(u => u.role === 'child_monitored').length

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!mounted) return null

  return createPortal(
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-8" 
      style={{ zIndex: 9999 }}
      onClick={onClose} 
      data-testid="admin-panel-overlay"
    >
      <div 
        className="w-full max-w-5xl flex flex-col bg-[#0D0D2B] rounded-2xl border border-[rgba(255,255,255,0.15)] shadow-[0_16px_70px_rgba(0,0,0,0.30)]" 
        style={{ maxHeight: '85vh', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}
        onClick={(e) => e.stopPropagation()} 
        data-testid="admin-panel"
      >
        {/* Header */}
        <div className="h-12 border-b border-border/50 flex items-center px-4 gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold">User Management</span>
          </div>
          <div className="flex-1" />
          <RoleBadge role={effectiveRole} />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} data-testid="admin-close-btn">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/50 px-4 gap-1 flex-shrink-0" data-testid="admin-tabs">
          <button
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === 'users' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('users')}
            data-testid="admin-tab-users"
          >
            <Users className="w-3.5 h-3.5" />
            Users ({users.length})
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === 'activity' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('activity')}
            data-testid="admin-tab-activity"
          >
            <Activity className="w-3.5 h-3.5" />
            Activity
          </button>
          {canViewMonitored && (
            <button
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === 'monitored' ? 'border-rose-400 text-rose-400' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab('monitored')}
              data-testid="admin-tab-monitored"
            >
              <Eye className="w-3.5 h-3.5" />
              Monitored {monitoredCount > 0 && `(${monitoredCount})`}
            </button>
          )}
          {canManage && (
            <button
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === 'promo' ? 'border-amber-400 text-amber-400' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab('promo')}
              data-testid="admin-tab-promo"
            >
              <Gift className="w-3.5 h-3.5" />
              Promo Codes
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {tab === 'users' ? (
            <div className="h-full flex flex-col">
              {/* Add user form — owner only */}
              {canManage && (
                <div className="p-4 border-b border-border" data-testid="add-user-form">
                  <div className="flex gap-2 items-center">
                    <Input
                      type="email"
                      placeholder="user@example.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="flex-1 h-8 text-sm"
                      data-testid="add-user-email"
                    />
                    <Select value={newRole} onValueChange={setNewRole}>
                      <SelectTrigger className="w-28 h-8 text-xs" data-testid="add-user-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="child_monitored">Monitored</SelectItem>
                        <SelectItem value="owner">Owner</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8" onClick={addUser} disabled={adding || !newEmail.trim()} data-testid="add-user-btn">
                      {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
              )}

              {/* Users list */}
              <ScrollArea className="flex-1" data-testid="users-list">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {users.map((u) => {
                      const style = ROLE_STYLES[u.role] || ROLE_STYLES.member
                      const Icon = style.icon
                      return (
                        <div
                          key={u.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors group ${
                            u.role === 'child_monitored' ? 'border border-rose-500/20' : ''
                          }`}
                          data-testid={`user-row-${u.id}`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${style.bg}`}>
                            <Icon className={`w-4 h-4 ${style.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{u.email}</span>
                              {u.email === user?.email && (
                                <Badge variant="secondary" className="text-[9px] h-4 px-1">you</Badge>
                              )}
                              {u.role === 'child_monitored' && (
                                <Badge className="text-[9px] h-4 px-1 bg-rose-500/15 text-rose-400 border-rose-500/30" data-testid={`monitored-badge-${u.id}`}>
                                  monitored
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                Joined {u.created_at ? relativeTime(u.created_at) : '—'}
                              </span>
                              <span className="inline-flex items-center gap-1" data-testid={`last-seen-${u.id}`}>
                                <Mail className="w-2.5 h-2.5" />
                                Last seen {u.last_seen ? relativeTime(u.last_seen) : 'never'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {canManage && u.email !== user?.email ? (
                              <>
                                <Select value={u.role} onValueChange={(r) => updateUserRole(u.id, r)}>
                                  <SelectTrigger className="w-28 h-7 text-[11px]" data-testid={`role-select-${u.id}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="member">Member</SelectItem>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="child_monitored">Monitored</SelectItem>
                                    <SelectItem value="owner">Owner</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="icon" variant="ghost"
                                  className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100"
                                  onClick={() => removeUser(u.id)}
                                  data-testid={`delete-user-${u.id}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </>
                            ) : (
                              <RoleBadge role={u.role} />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          ) : tab === 'activity' ? (
            /* Activity Log */
            <ScrollArea className="h-full" data-testid="activity-log">
              {activity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" data-testid="activity-empty">
                  <Activity className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">No activity recorded yet</p>
                  <p className="text-xs opacity-50 mt-1">Actions will appear here as you build</p>
                </div>
              ) : (
                <div className="p-2 space-y-px">
                  {activity.map((evt) => {
                    const Icon = ACTION_ICONS[evt.action_type] || Activity
                    const color = ACTION_COLORS[evt.action_type] || 'text-muted-foreground'
                    const label = ACTION_LABELS[evt.action_type] || evt.action_type
                    return (
                      <div
                        key={evt.id}
                        className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/20 transition-colors"
                        data-testid={`activity-row-${evt.id}`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 ${color}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium">{label}</span>
                            {evt.rejected && (
                              <Badge variant="destructive" className="text-[9px] h-3.5 px-1">rejected</Badge>
                            )}
                          </div>
                          {evt.target && (
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{evt.target}</p>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground/60">{relativeTime(evt.timestamp)}</span>
                            <span className="text-[10px] text-muted-foreground/40">by</span>
                            <span className="text-[10px] text-muted-foreground/60">{evt.actor}</span>
                            <RoleBadge role={evt.role} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          ) : tab === 'monitored' ? (
            /* Monitored Activity */
            <ScrollArea className="h-full" data-testid="monitored-log">
              {monitored.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" data-testid="monitored-empty">
                  <Eye className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">No monitored activity yet</p>
                  <p className="text-xs opacity-50 mt-1">Prompts from monitored accounts will appear here</p>
                </div>
              ) : (
                <div className="p-2 space-y-px">
                  {monitored.map((evt) => {
                    const Icon = ACTION_ICONS[evt.action_type] || MessageSquare
                    const color = ACTION_COLORS[evt.action_type] || 'text-rose-400'
                    const label = ACTION_LABELS[evt.action_type] || evt.action_type
                    return (
                      <div
                        key={evt.id}
                        className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg hover:bg-muted/20 transition-colors border-l-2 border-rose-500/30"
                        data-testid={`monitored-row-${evt.id}`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 ${color}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium">{label}</span>
                            <RoleBadge role="child_monitored" />
                          </div>
                          {evt.prompt && (
                            <p className="text-[11px] text-foreground/80 mt-1 whitespace-pre-wrap break-words leading-relaxed">
                              {evt.prompt}
                            </p>
                          )}
                          {evt.target && (
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{evt.target}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground/60">{relativeTime(evt.timestamp)}</span>
                            <span className="text-[10px] text-muted-foreground/40">by</span>
                            <span className="text-[10px] text-muted-foreground/60">{evt.actor}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          ) : tab === 'promo' ? (
            /* Promo Codes */
            <div className="h-full flex flex-col">
              {/* Generate promo code form */}
              {canManage && (
                <div className="p-4 border-b border-border" data-testid="generate-promo-form">
                  <div className="flex gap-2 items-center">
                    <Input
                      type="text"
                      placeholder="Description (e.g., 'For John')"
                      value={promoDescription}
                      onChange={(e) => setPromoDescription(e.target.value)}
                      className="flex-1 h-8 text-sm"
                      data-testid="promo-description"
                    />
                    <Button size="sm" className="h-8" onClick={generatePromoCode} disabled={generating || !promoDescription.trim()} data-testid="generate-promo-btn">
                      {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Generate Code'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Promo codes list */}
              <ScrollArea className="flex-1" data-testid="promo-list">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : promoCodes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Gift className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-sm">No promo codes yet</p>
                    <p className="text-xs opacity-50 mt-1">Generate codes for friends and family</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {promoCodes.map((code) => {
                      const isUsed = code.status === 'used'
                      return (
                        <div
                          key={code.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors group ${
                            isUsed ? 'opacity-60' : ''
                          }`}
                          data-testid={`promo-row-${code.id}`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            isUsed ? 'bg-zinc-500/10' : 'bg-amber-500/10'
                          }`}>
                            <Gift className={`w-4 h-4 ${isUsed ? 'text-zinc-400' : 'text-amber-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-mono font-semibold">{code.code}</code>
                              {isUsed && (
                                <Badge variant="secondary" className="text-[9px] h-4 px-1">used</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                              <span>{code.description || 'Unlimited credits'}</span>
                              {isUsed && code.redeemed_at && (
                                <span>Redeemed {relativeTime(code.redeemed_at)}</span>
                              )}
                              {isUsed && code.redeemed_by_email && (
                                <span>by {code.redeemed_by_email}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {!isUsed && (
                              <Button
                                size="icon" variant="ghost"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                onClick={() => copyPromoCode(code.code)}
                                data-testid={`copy-promo-${code.id}`}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
