'use client'

import { useState } from 'react'
import { MessageSquare, Plus, FileText, Clock, ArrowLeft, ChevronRight, Hash, Calendar, Code2, Activity, Trash2, Pencil, GitBranch, Upload, Image, File, X } from 'lucide-react'

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

function getFileIcon(fileType) {
  if (fileType === 'image') return <Image className="w-3 h-3 text-purple-400" />
  if (fileType === 'document') return <FileText className="w-3 h-3 text-amber-400" />
  return <File className="w-3 h-3 em-text-muted" />
}

export default function ProjectHub({
  project,
  chats,
  files,
  mediaBinFiles,
  onSelectChat,
  onCreateChat,
  onBack,
  onDeleteProject,
  onUploadMediaBin,
  onSyncRepo,
  onRenameChat,
  onRenameProject,
}) {
  const [hoveredChat, setHoveredChat] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingProject, setRenamingProject] = useState(false)
  const [projectRenameValue, setProjectRenameValue] = useState('')

  const submitRename = async (chatId) => {
    const trimmed = renameValue.trim()
    if (trimmed && onRenameChat) {
      await onRenameChat(chatId, trimmed)
    }
    setRenamingId(null)
  }

  const submitProjectRename = () => {
    const trimmed = projectRenameValue.trim()
    if (trimmed && trimmed !== project?.name && onRenameProject) {
      onRenameProject(trimmed)
    }
    setRenamingProject(false)
  }

  const chatCount = chats?.length || 0
  const fileCount = files?.length || 0
  const mediaBinCount = mediaBinFiles?.length || 0
  const lastUpdated = project?.updated_at || project?.created_at
  const framework = project?.settings?.framework || project?.framework || project?.type || 'project'
  const latestChat = chats?.[0] || null
  const isGithubProject = project?.settings?.import_source === 'github'
  const repoUrl = project?.settings?.repo_url || null
  const commitSha = project?.settings?.last_commit_sha || null
  const branch = project?.settings?.branch || 'main'

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
            {framework === 'node' ? 'Node.js' : framework}
          </span>
        </div>
      </div>

      {/* ── 3-Panel Layout ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT PANEL — Chat Navigation */}
        <div className="w-[260px] shrink-0 border-r border-[rgba(255,255,255,0.08)] flex flex-col overflow-hidden" data-testid="hub-left-panel">
          <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider em-text-muted">Conversations</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[rgba(255,255,255,0.06)] em-text-muted">{chatCount}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {chatCount === 0 ? (
              <div className="px-4 py-8 text-center">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 em-text-muted opacity-40" />
                <p className="text-xs em-text-muted">No conversations yet</p>
                <p className="text-[10px] em-text-muted opacity-60 mt-1">Create one to get started</p>
              </div>
            ) : (
              chats.map((chat) => (
                renamingId === chat.id ? (
                  <div key={chat.id} className="flex items-center gap-2 px-3 py-2">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitRename(chat.id); if (e.key === 'Escape') setRenamingId(null); }}
                      onBlur={() => submitRename(chat.id)}
                      className="flex-1 text-xs bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.15)] rounded px-2 py-1 outline-none focus:border-[rgba(0,229,255,0.30)] em-text-primary"
                      data-testid={`hub-rename-input-${chat.id}`}
                    />
                  </div>
                ) : (
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
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenameValue(chat.title || ''); setRenamingId(chat.id); }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 transition-opacity"
                    title="Rename"
                    data-testid={`hub-rename-btn-${chat.id}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <ChevronRight className={`w-3 h-3 em-text-muted transition-all duration-150 ${hoveredChat === chat.id ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'}`} />
                </button>
                )
              ))
            )}
          </div>

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

        {/* CENTER PANEL — Project Overview */}
        <div className="flex-1 overflow-y-auto" data-testid="hub-center-panel">
          <div className="max-w-2xl mx-auto px-8 py-8">
            {/* Project Title — inline rename */}
            <div className="mb-6">
              {renamingProject ? (
                <input
                  autoFocus
                  value={projectRenameValue}
                  onChange={(e) => setProjectRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitProjectRename(); if (e.key === 'Escape') setRenamingProject(false); }}
                  onBlur={submitProjectRename}
                  className="text-2xl font-semibold em-text-primary tracking-tight mb-1.5 bg-transparent border-b border-[rgba(0,229,255,0.30)] outline-none w-full"
                  data-testid="hub-rename-project-input"
                />
              ) : (
                <div className="flex items-center gap-2 group mb-1.5">
                  <h1 className="text-2xl font-semibold em-text-primary tracking-tight" data-testid="hub-title">
                    {project?.name}
                  </h1>
                  <button
                    onClick={() => { setProjectRenameValue(project?.name || ''); setRenamingProject(true); }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-1 transition-opacity"
                    title="Rename project"
                    data-testid="hub-rename-project-btn"
                  >
                    <Pencil className="w-3.5 h-3.5 em-text-muted" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[rgba(0,229,255,0.08)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.12)]">
                  {framework === 'node' ? 'Node.js' : framework}
                </span>
                {project?.settings?.is_sandbox && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Sandbox
                  </span>
                )}
                <span className="text-[10px] em-text-muted opacity-70">
                  Created {formatRelativeTime(project?.created_at)}
                </span>
              </div>
            </div>

            {/* Quick Actions — New Chat + Upload to Media Bin */}
            <div className="mb-8">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider em-text-muted mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-3" data-testid="hub-quick-actions">
                <button
                  onClick={onCreateChat}
                  className="group flex items-center gap-3 p-4 rounded-xl em-glass hover:border-[rgba(0,229,255,0.25)] hover:shadow-[0_4px_24px_rgba(0,229,255,0.08)] hover:-translate-y-px transition-all duration-200"
                  data-testid="hub-action-new-chat"
                >
                  <div className="w-8 h-8 rounded-lg bg-[rgba(0,229,255,0.08)] border border-[rgba(0,229,255,0.15)] flex items-center justify-center shrink-0 group-hover:border-[rgba(0,229,255,0.30)] transition-all">
                    <Plus className="w-3.5 h-3.5 text-[var(--em-cyan)]" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-medium em-text-primary">New Chat</div>
                    <div className="text-[10px] em-text-muted mt-0.5">Start a new conversation</div>
                  </div>
                </button>

                <button
                  onClick={onUploadMediaBin}
                  className="group flex items-center gap-3 p-4 rounded-xl em-glass hover:border-[rgba(0,229,255,0.25)] hover:shadow-[0_4px_24px_rgba(0,229,255,0.08)] hover:-translate-y-px transition-all duration-200"
                  data-testid="hub-action-upload-media"
                >
                  <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] flex items-center justify-center shrink-0 group-hover:border-[rgba(0,229,255,0.20)] group-hover:bg-[rgba(0,229,255,0.06)] transition-all">
                    <Upload className="w-3.5 h-3.5 em-text-secondary group-hover:text-[var(--em-cyan)] transition-colors" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-medium em-text-primary">Upload to Media Bin</div>
                    <div className="text-[10px] em-text-muted mt-0.5">Add reference files for AI context</div>
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
                    renamingId === chat.id ? (
                      <div key={chat.id} className="flex items-center gap-2 px-3 py-2">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') submitRename(chat.id); if (e.key === 'Escape') setRenamingId(null); }}
                          onBlur={() => submitRename(chat.id)}
                          className="flex-1 text-xs bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.15)] rounded px-2 py-1 outline-none focus:border-[rgba(0,229,255,0.30)] em-text-primary"
                        />
                      </div>
                    ) : (
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
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenameValue(chat.title || ''); setRenamingId(chat.id); }}
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 transition-opacity"
                        title="Rename"
                        data-testid={`hub-activity-rename-${chat.id}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] em-text-muted shrink-0">{formatRelativeTime(chat.updated_at || chat.created_at)}</span>
                      <ChevronRight className="w-3 h-3 em-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL — Project Details */}
        <div className="w-[240px] shrink-0 border-l border-[rgba(255,255,255,0.08)] flex flex-col overflow-hidden" data-testid="hub-right-panel">
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

            <div className="h-px bg-[rgba(255,255,255,0.06)] mb-4" />

            {/* Media Bin */}
            <div className="mb-5" data-testid="hub-media-bin">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[9px] font-semibold uppercase tracking-wider em-text-muted">Media Bin</h4>
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[rgba(255,255,255,0.06)] em-text-muted">{mediaBinCount}</span>
                  <button
                    onClick={onUploadMediaBin}
                    className="p-0.5 em-text-muted hover:text-[var(--em-cyan)] transition-colors"
                    title="Upload files"
                    data-testid="hub-media-bin-upload-btn"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {mediaBinCount === 0 ? (
                <div className="py-3 text-center">
                  <Upload className="w-4 h-4 mx-auto mb-1.5 em-text-muted opacity-40" />
                  <p className="text-[10px] em-text-muted opacity-70">No reference files</p>
                  <button
                    onClick={onUploadMediaBin}
                    className="text-[10px] text-[var(--em-cyan)] hover:underline mt-1"
                    data-testid="hub-media-bin-empty-upload"
                  >
                    Upload files
                  </button>
                </div>
              ) : (
                <div className="space-y-1 max-h-[160px] overflow-y-auto">
                  {mediaBinFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[rgba(255,255,255,0.04)] transition-colors group">
                      {getFileIcon(f.file_type)}
                      <span className="text-[10px] em-text-primary truncate flex-1">{f.filename}</span>
                      <span className="text-[9px] em-text-muted shrink-0">{f.file_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="h-px bg-[rgba(255,255,255,0.06)] mb-4" />

            {/* Metadata */}
            <div className="space-y-2.5 mb-5">
              <h4 className="text-[9px] font-semibold uppercase tracking-wider em-text-muted">Metadata</h4>

              <div className="flex items-center justify-between">
                <span className="text-[10px] em-text-muted flex items-center gap-1.5"><Code2 className="w-3 h-3" /> Framework</span>
                <span className="text-[10px] font-medium em-text-primary">{framework === 'node' ? 'Node.js' : framework}</span>
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

              {repoUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] em-text-muted flex items-center gap-1.5"><GitBranch className="w-3 h-3" /> Source</span>
                  <span className="text-[10px] font-medium text-purple-400 truncate max-w-[120px]">{repoUrl}</span>
                </div>
              )}

              {commitSha && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] em-text-muted flex items-center gap-1.5"><Hash className="w-3 h-3" /> Commit</span>
                  <span className="text-[10px] font-mono font-medium em-text-primary">{commitSha.slice(0, 8)}</span>
                </div>
              )}

              {isGithubProject && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] em-text-muted flex items-center gap-1.5"><Activity className="w-3 h-3" /> Branch</span>
                  <span className="text-[10px] font-medium em-text-primary">{branch}</span>
                </div>
              )}
            </div>

            <div className="h-px bg-[rgba(255,255,255,0.06)] mb-4" />

            {/* Actions */}
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
