'use client'

import { useState } from 'react'
import { MessageSquare, Plus, FileText, Clock, Layers, ArrowLeft, ChevronRight, FolderOpen, GitBranch, Zap, Hash, Calendar, Code2, Activity, Trash2 } from 'lucide-react'

function formatRelativeTime(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ProjectHub({
  project,
  chats,
  files,
  onSelectChat,
  onCreateChat,
  onBack,
  onDeleteProject,
  onOpenImport,
  creditsBalance,
}) {
  const [hoveredChat, setHoveredChat] = useState(null)

  const chatCount = chats?.length || 0
  const fileCount = files?.length || 0
  const lastUpdated = project?.updated_at || project?.created_at
  const framework = project?.framework || project?.type || 'project'
  const latestChat = chats?.[0] || null

  const handleOpenLatestChat = () => {
    if (latestChat) {
      onSelectChat(latestChat)
    } else {
      onCreateChat()
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative z-5" data-testid="project-hub">
      {/* ── Top Navigation Bar ── */}
      <div className="h-12 flex items-center gap-3 px-4 em-glass-topbar shrink-0" data-testid="hub-topbar">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] text-sm em-text-secondary hover:bg-[rgba(255,255,255,0.07)] hover:text-[var(--em-text-primary)] hover:border-[rgba(255,255,255,0.20)] transition-all duration-200"
          data-testid="hub-back-btn"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Projects
        </button>
        <div className="w-px h-6 bg-[rgba(255,255,255,0.10)]" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium em-text-primary truncate" data-testid="hub-project-name">{project?.name}</span>
          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[rgba(0,229,255,0.08)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.15)] shrink-0">
            {framework}
          </span>
        </div>
      </div>

      {/* ── 3-Panel Layout ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ═══ LEFT PANEL — Chat Navigation ═══ */}
        <div className="w-[260px] shrink-0 border-r border-[rgba(255,255,255,0.08)] flex flex-col overflow-hidden" data-testid="hub-left-panel">
          {/* Section Header */}
          <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider em-text-muted">Conversations</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[rgba(255,255,255,0.06)] em-text-muted">{chatCount}</span>
            </div>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto py-1">
            {chatCount === 0 ? (
              <div className="px-4 py-8 text-center">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 em-text-muted opacity-40" />
                <p className="text-xs em-text-muted">No conversations yet</p>
                <p className="text-[10px] em-text-muted opacity-60 mt-1">Create one to get started</p>
              </div>
            ) : (
              chats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat)}
                  onMouseEnter={() => setHoveredChat(chat.id)}
                  onMouseLeave={() => setHoveredChat(null)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[rgba(255,255,255,0.05)] transition-all duration-150 group"
                  data-testid={`hub-chat-item-${chat.id}`}
                >
                  <div className="w-6 h-6 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center shrink-0 group-hover:border-[rgba(0,229,255,0.20)] group-hover:bg-[rgba(0,229,255,0.06)] transition-all">
                    <MessageSquare className="w-3 h-3 em-text-muted group-hover:text-[var(--em-cyan)] transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium em-text-primary truncate">{chat.title || 'Untitled'}</div>
                    <div className="text-[10px] em-text-muted mt-0.5">{formatRelativeTime(chat.updated_at || chat.created_at)}</div>
                  </div>
                  <ChevronRight className={`w-3 h-3 em-text-muted transition-all duration-150 ${hoveredChat === chat.id ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'}`} />
                </button>
              ))
            )}
          </div>

          {/* New Chat Button */}
          <div className="px-2 py-2 border-t border-[rgba(255,255,255,0.06)]">
            <button
              onClick={onCreateChat}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-[rgba(0,229,255,0.15)] bg-[rgba(0,229,255,0.06)] text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.12)] hover:border-[rgba(0,229,255,0.30)] transition-all duration-200"
              data-testid="hub-new-chat-btn"
            >
              <Plus className="w-3.5 h-3.5" />
              New Chat
            </button>
          </div>
        </div>

        {/* ═══ CENTER PANEL — Project Overview ═══ */}
        <div className="flex-1 overflow-y-auto" data-testid="hub-center-panel">
          <div className="max-w-2xl mx-auto px-8 py-8">
            {/* Project Title */}
            <div className="mb-8">
              <h1 className="text-2xl font-semibold em-text-primary tracking-tight mb-2" data-testid="hub-title">
                {project?.name}
              </h1>
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[rgba(0,229,255,0.08)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.12)]">
                  {framework}
                </span>
                {project?.settings?.is_sandbox && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Sandbox
                  </span>
                )}
                <span className="text-[11px] em-text-muted">
                  Created {formatRelativeTime(project?.created_at)}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mb-8">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider em-text-muted mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-3" data-testid="hub-quick-actions">
                <button
                  onClick={handleOpenLatestChat}
                  className="group flex items-center gap-3 p-4 rounded-xl em-glass hover:border-[rgba(0,229,255,0.25)] hover:shadow-[0_0_20px_rgba(0,229,255,0.06)] transition-all duration-200"
                  data-testid="hub-action-open-chat"
                >
                  <div className="w-9 h-9 rounded-lg bg-[rgba(0,229,255,0.08)] border border-[rgba(0,229,255,0.15)] flex items-center justify-center shrink-0 group-hover:border-[rgba(0,229,255,0.30)] transition-all">
                    <MessageSquare className="w-4 h-4 text-[var(--em-cyan)]" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-medium em-text-primary">Open Latest Chat</div>
                    <div className="text-[10px] em-text-muted mt-0.5">
                      {latestChat ? latestChat.title || 'Continue conversation' : 'Start building'}
                    </div>
                  </div>
                </button>

                <button
                  onClick={onCreateChat}
                  className="group flex items-center gap-3 p-4 rounded-xl em-glass hover:border-[rgba(255,255,255,0.22)] transition-all duration-200"
                  data-testid="hub-action-new-chat"
                >
                  <div className="w-9 h-9 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] flex items-center justify-center shrink-0 group-hover:border-[rgba(255,255,255,0.22)] transition-all">
                    <Plus className="w-4 h-4 em-text-secondary" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-medium em-text-primary">New Chat</div>
                    <div className="text-[10px] em-text-muted mt-0.5">Start a new conversation</div>
                  </div>
                </button>

                <button
                  onClick={onOpenImport}
                  className="group flex items-center gap-3 p-4 rounded-xl em-glass hover:border-[rgba(255,255,255,0.22)] transition-all duration-200"
                  data-testid="hub-action-import"
                >
                  <div className="w-9 h-9 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] flex items-center justify-center shrink-0 group-hover:border-[rgba(255,255,255,0.22)] transition-all">
                    <FolderOpen className="w-4 h-4 em-text-secondary" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-medium em-text-primary">Import Files</div>
                    <div className="text-[10px] em-text-muted mt-0.5">Upload project files</div>
                  </div>
                </button>

                <button
                  disabled
                  className="group flex items-center gap-3 p-4 rounded-xl em-glass opacity-50 cursor-not-allowed"
                  data-testid="hub-action-pull"
                >
                  <div className="w-9 h-9 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] flex items-center justify-center shrink-0">
                    <GitBranch className="w-4 h-4 em-text-secondary" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-medium em-text-primary">Pull Latest</div>
                    <div className="text-[10px] em-text-muted mt-0.5">Sync from repository</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Recent Conversations */}
            {chatCount > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider em-text-muted mb-3">Recent Activity</h3>
                <div className="space-y-1" data-testid="hub-recent-activity">
                  {chats.slice(0, 5).map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => onSelectChat(chat)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-all duration-150 group"
                      data-testid={`hub-activity-${chat.id}`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-[rgba(0,229,255,0.40)] shrink-0" />
                      <div className="flex-1 min-w-0 text-left">
                        <span className="text-xs em-text-primary truncate block">{chat.title || 'Untitled'}</span>
                      </div>
                      <span className="text-[10px] em-text-muted shrink-0">{formatRelativeTime(chat.updated_at || chat.created_at)}</span>
                      <ChevronRight className="w-3 h-3 em-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ RIGHT PANEL — Project Details ═══ */}
        <div className="w-[240px] shrink-0 border-l border-[rgba(255,255,255,0.08)] flex flex-col overflow-hidden" data-testid="hub-right-panel">
          {/* Section Header */}
          <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.06)]">
            <span className="text-[10px] font-semibold uppercase tracking-wider em-text-muted">Details</span>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            {/* Stats Grid */}
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center">
                  <FileText className="w-3.5 h-3.5 em-text-muted" />
                </div>
                <div>
                  <div className="text-xs font-medium em-text-primary">{fileCount}</div>
                  <div className="text-[9px] em-text-muted">Files</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center">
                  <MessageSquare className="w-3.5 h-3.5 em-text-muted" />
                </div>
                <div>
                  <div className="text-xs font-medium em-text-primary">{chatCount}</div>
                  <div className="text-[9px] em-text-muted">Conversations</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5 em-text-muted" />
                </div>
                <div>
                  <div className="text-xs font-medium em-text-primary">{formatRelativeTime(lastUpdated)}</div>
                  <div className="text-[9px] em-text-muted">Last Updated</div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-[rgba(255,255,255,0.06)] mb-4" />

            {/* Metadata */}
            <div className="space-y-2.5 mb-5">
              <h4 className="text-[9px] font-semibold uppercase tracking-wider em-text-muted">Metadata</h4>

              <div className="flex items-center justify-between">
                <span className="text-[10px] em-text-muted flex items-center gap-1.5"><Code2 className="w-3 h-3" /> Framework</span>
                <span className="text-[10px] font-medium em-text-primary">{framework}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] em-text-muted flex items-center gap-1.5"><Hash className="w-3 h-3" /> Type</span>
                <span className="text-[10px] font-medium em-text-primary">{project?.type || 'app'}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] em-text-muted flex items-center gap-1.5"><Calendar className="w-3 h-3" /> Created</span>
                <span className="text-[10px] font-medium em-text-primary">
                  {project?.created_at ? new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </span>
              </div>

              {project?.repo_url && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] em-text-muted flex items-center gap-1.5"><GitBranch className="w-3 h-3" /> Repo</span>
                  <span className="text-[10px] font-medium em-text-primary truncate max-w-[120px]">{project.repo_url}</span>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="h-px bg-[rgba(255,255,255,0.06)] mb-4" />

            {/* Credits */}
            {creditsBalance !== null && (
              <div className="mb-5">
                <h4 className="text-[9px] font-semibold uppercase tracking-wider em-text-muted mb-2">Credits</h4>
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-[var(--em-cyan)]" />
                  <span className="text-sm font-semibold em-gradient-text">{creditsBalance?.toFixed?.(2) ?? '—'}</span>
                  <span className="text-[9px] em-text-muted">available</span>
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="h-px bg-[rgba(255,255,255,0.06)] mb-4" />

            {/* Utility / Future space */}
            <div>
              <h4 className="text-[9px] font-semibold uppercase tracking-wider em-text-muted mb-2">Actions</h4>
              <button
                onClick={onDeleteProject}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium text-red-400/70 hover:text-red-400 hover:bg-[rgba(255,60,60,0.08)] transition-all duration-200"
                data-testid="hub-delete-project-btn"
              >
                <Trash2 className="w-3 h-3" />
                Delete Project
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
