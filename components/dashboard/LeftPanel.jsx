'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  MessageSquare,
  FolderPlus,
  Layers,
  Globe,
  Image,
  FileText,
  MoreVertical,
  Trash2,
  Upload,
  Loader2,
  Zap,
  User,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Brain,
  Settings,
  Shield,
  FlaskConical,
  Clock,
  GitFork,
  Pencil
} from 'lucide-react'
import { BUILDER_MODES, getChatType, CHAT_TYPES, SELF_EDIT_PREFIX, SELF_EDIT_TARGETS } from '@/lib/constants'
import MessageRenderer from './MessageRenderer'
import MessageActions from './MessageActions'
import ChatComposer from './ChatComposer'
import PlanCard from './PlanCard'
import BriefProgressCard from './BriefProgressCard'
import DiffReviewPanel from './DiffReviewPanel'
import GeneratedImageCard from './GeneratedImageCard'
import ImageGenerationProgress from './ImageGenerationProgress'
import { AttachmentChips } from './AttachmentPreview'
import SuggestionChips, { parseSuggestions } from './SuggestionChips'


const WHIMSICAL_MAP = {
  connecting: 'Warming up the engines...',
  classifying_intent: 'Reading your mind (almost)...',
  intent_classified: 'Got it! Plotting the game plan...',
  selecting_provider: 'Summoning the best brain for the job...',
  loading_context: 'Gathering all the ingredients...',
  scanning_files: 'Rummaging through your project files...',
  files_scanned: 'Found everything I need!',
  reading_files: 'Speed-reading your codebase...',
  direct_edit: 'Surgeon mode activated...',
  generating_images: 'Painting custom visuals for you...',
  images_ready: 'Artwork is ready!',
  finding_images: 'Scouting the perfect images...',
  config_mode: 'Tweaking the knobs...',
  applying_pending_diff: 'Stitching changes together...',
  verifying: 'Double-checking my work...',
  checking_completeness: 'Making sure nothing was missed...',
  continuation_discovered: 'Found more to do — on it!',
  executing_plan: 'Bringing the plan to life...',
  generating_image: 'Cooking up something visual...',
  provider_fallback: null, // keep original for fallback warnings
}
function whimsicalStatus(status) {
  if (!status) return 'Generating...'
  const fun = WHIMSICAL_MAP[status.stage]
  if (fun === null) return status.detail // explicit null = keep original
  return fun || status.detail || 'Generating...'
}

const modeIcons = {
  app: Layers,
  website: Globe,
  image: Image,
  document: FileText
}

function ChatRow({ chat, selectedChat, onSelectChat, onDeleteChat, onForkChat, onRenameChat, isSelfEdit }) {
  const [forking, setForking] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const renameRef = useRef(null)
  const displayTitle = isSelfEdit ? chat.title.replace(SELF_EDIT_PREFIX, '') : chat.title
  const isActive = selectedChat?.id === chat.id

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus()
      renameRef.current.select()
    }
  }, [renaming])

  const submitRename = async () => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === chat.title) { setRenaming(false); return }
    setRenameSaving(true)
    try {
      await onRenameChat(chat.id, trimmed)
      setRenaming(false)
    } catch {
      // toast already shown by parent — keep input open
    } finally {
      setRenameSaving(false)
    }
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-1 px-2.5 py-1" data-testid={`chat-rename-${chat.id}`}>
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false); }}
          disabled={renameSaving}
          className="flex-1 text-[11.5px] bg-muted/40 border border-border/40 rounded px-1.5 py-0.5 outline-none focus:border-primary/40 disabled:opacity-50"
        />
        <button
          onClick={submitRename}
          disabled={renameSaving}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[rgba(0,229,255,0.12)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.25)] hover:bg-[rgba(0,229,255,0.20)] transition-all disabled:opacity-50"
          data-testid={`rename-save-${chat.id}`}
        >
          {renameSaving ? '...' : 'Save'}
        </button>
        <button
          onClick={() => setRenaming(false)}
          disabled={renameSaving}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground border border-[rgba(255,255,255,0.10)] hover:bg-muted/40 transition-all disabled:opacity-50"
          data-testid={`rename-cancel-${chat.id}`}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid={`chat-item-${chat.id}`}
      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md cursor-pointer transition-all duration-150 ${
        isActive
          ? isSelfEdit ? 'bg-amber-500/8 em-accent-edge-left' : 'bg-[hsl(190_100%_50%/0.06)] em-accent-edge-left'
          : 'hover:bg-muted/25 border-l-2 border-transparent'
      }`}
      onClick={() => onSelectChat(chat)}
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {isSelfEdit
          ? <Settings className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
          : <MessageSquare className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
        }
        <span className={`text-[11.5px] truncate ${isSelfEdit ? 'text-amber-200/70' : isActive ? 'text-foreground/90' : 'text-muted-foreground'}`}>{displayTitle}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 h-5 w-5 p-0 hover:bg-muted/60" onClick={(e) => e.stopPropagation()}>
            <MoreVertical className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setRenameValue(chat.title)
              setRenaming(true)
            }}
            data-testid={`rename-chat-${chat.id}`}
          >
            <Pencil className="w-4 h-4 mr-2" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async (e) => {
              e.stopPropagation()
              setForking(true)
              await onForkChat(chat.id)
              setForking(false)
            }}
            disabled={forking}
            data-testid={`fork-chat-${chat.id}`}
          >
            {forking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <GitFork className="w-4 h-4 mr-2" />}
            {forking ? 'Forking...' : 'Fork'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id) }} className="text-destructive">
            <Trash2 className="w-4 h-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default function LeftPanel({
  projects,
  selectedProject,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  chats,
  selectedChat,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onForkChat,
  onRenameChat,
  onCreateSelfEditChat,
  selfEditTarget,
  selfEditTargets,
  onSelfEditTargetChange,
  isOwner,
  isMonitored,
  messages,
  onSendMessage,
  builderMode,
  onBuilderModeChange,
  aiProvider,
  aiModel,
  onAiProviderChange,
  onAiModelChange,
  onImportProject,
  providerStatus,
  onRetryWithFallback,
  scope,
  onScopeChange,
  projectName,
  fileCount,
  loading,
  streamingMessageId,
  streamingStatus,
  pendingPlan,
  executingPlan,
  onExecutePlan,
  onCancelPlan,
  pendingDiffs,
  applyingDiffs,
  onApplyDiffs,
  onCancelDiffs,
  onUploadFiles,
  imageGenProgress,
  onRetryImageGen,
  onOpenVariationStudio,
  onOpenPromptLibrary,
  onOpenBuilderMemory,
  onSavePrompt,
  onCreateSandbox,
  visualMode,
  onVisualModeChange,
  buildMilestones,
  buildLog
}) {
  const [sending, setSending] = useState(false)
  const [forkingChat, setForkingChat] = useState(false)
  const [collapsedMessages, setCollapsedMessages] = useState({})
  const [convoCollapsed, setConvoCollapsed] = useState(() => {
    try { return localStorage.getItem('mymergent_convo_collapsed') === 'true' } catch { return false }
  })
    const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const userIsScrolledUpRef = useRef(false)

  // Track if user has scrolled up
  const handleScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userIsScrolledUpRef.current = distFromBottom > 100
  }

  // Intelligent auto-scroll: follow stream only if user is near bottom
  useEffect(() => {
    if (!userIsScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Always scroll to bottom when streaming starts
  useEffect(() => {
    if (streamingMessageId) {
      userIsScrolledUpRef.current = false
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [streamingMessageId])

  // Sending is derived from streaming state
  const isStreaming = !!streamingMessageId

  const handleSendMessage = async (content) => {
    if (!content.trim() || isStreaming) return
    setSending(true)
    try {
      await onSendMessage(content)
    } finally {
      setSending(false)
    }
  }

  const handleRegenerate = async (message) => {
    // Find the last user message before this assistant message
    const idx = messages.findIndex(m => m.id === message.id)
    if (idx > 0) {
      const prevUser = messages.slice(0, idx).reverse().find(m => m.role === 'user')
      if (prevUser) {
        await handleSendMessage(prevUser.content)
      }
    }
  }

  const handleEditPrompt = (message) => {
    // Pre-fill composer with the user's message for editing
    // This is a placeholder — would need a ref or callback to ChatComposer
  }

  const toggleCollapse = (messageId) => {
    setCollapsedMessages(prev => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  const ModeIcon = modeIcons[builderMode] || Layers

  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden" data-testid="left-panel">
      {/* Compact Header — project + mode in one row */}
      <div className="flex items-center gap-1.5 h-11 px-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(0, 229, 255, 0.06)' }} data-testid="sidebar-header">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 flex-1 min-w-0 h-8 px-2 rounded-lg hover:bg-[rgba(0,229,255,0.06)] transition-colors duration-200 text-left" data-testid="project-selector">
              {selectedProject?.settings?.is_sandbox ? (
                <FlaskConical className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              ) : (
                <ModeIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{selectedProject?.name || 'Select Project'}</span>
              {fileCount > 0 && (
                <span className="text-[9px] em-text-muted ml-1 flex-shrink-0" data-testid="file-count-badge">{fileCount} files</span>
              )}
              {selectedProject?.settings?.is_sandbox && (
                <Badge className="text-[8px] h-3.5 px-1 bg-amber-500/15 text-amber-400 border-amber-500/30 flex-shrink-0" data-testid="sandbox-badge">sandbox</Badge>
              )}
              <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0 ml-auto" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {/* Projects */}
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Projects</div>
            {projects.map((project) => {
              const isSandbox = project.settings?.is_sandbox
              return (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className={selectedProject?.id === project.id ? 'bg-muted' : ''}
                  data-testid={`project-item-${project.id}`}
                >
                  {isSandbox ? (
                    <FlaskConical className="w-3.5 h-3.5 mr-2 text-amber-400" />
                  ) : (
                    <Layers className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  )}
                  <span className="truncate">{project.name}</span>
                  {isSandbox && (
                    <Badge className="ml-auto text-[8px] h-3.5 px-1 bg-amber-500/15 text-amber-400 border-amber-500/30">sandbox</Badge>
                  )}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            {/* Sandbox */}
            {selectedProject && !selectedProject.settings?.is_sandbox && isOwner && (
              <>
                <DropdownMenuItem onClick={() => onCreateSandbox(selectedProject.id)} data-testid="create-sandbox-btn">
                  <FlaskConical className="w-3.5 h-3.5 mr-2 text-amber-400" />
                  Create Sandbox
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {/* Builder Mode */}
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Builder Mode</div>
            {BUILDER_MODES.map((mode) => {
              const Icon = modeIcons[mode.id] || Layers
              return (
                <DropdownMenuItem key={mode.id} onClick={() => onBuilderModeChange(mode.id)} className={builderMode === mode.id ? 'bg-muted' : ''}>
                  <Icon className="w-3.5 h-3.5 mr-2" />
                  {mode.name}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
          </DropdownMenuContent>
        </DropdownMenu>

      </div>


      {/* Self-edit target mode indicator + selector — only in Core System context */}
      {isOwner && selectedChat && getChatType(selectedChat) === CHAT_TYPES.SELF_EDIT && (
        <div className="px-3 py-1.5 bg-amber-500/8 border-b border-amber-500/15" data-testid="self-edit-mode-indicator">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] font-medium text-amber-400">Core System Mode</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[9px] text-amber-400/50">Target:</span>
            <select
              className="text-[10px] bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 text-amber-300 flex-1 outline-none focus:border-amber-400/40"
              value={selfEditTarget?.id || ''}
              onChange={e => {
                const targets = selfEditTargets || SELF_EDIT_TARGETS
                onSelfEditTargetChange?.(targets.find(t => t.id === e.target.value) || null)
              }}
              data-testid="self-edit-target-select"
            >
              <option value="">All Core System</option>
              {(selfEditTargets || SELF_EDIT_TARGETS).map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Project context label — shown for non-self-edit chats */}
      {selectedChat && getChatType(selectedChat) !== CHAT_TYPES.SELF_EDIT && projectName && (
        <div className="px-3 py-1 border-b border-[rgba(255,255,255,0.06)]" data-testid="project-context-label">
          <span className="text-[10px] em-text-muted">Project: </span>
          <span className="text-[10px] text-[var(--em-cyan)] font-medium">{projectName}</span>
          {builderMode && (
            <span className="text-[10px] em-text-muted"> · {builderMode.charAt(0).toUpperCase() + builderMode.slice(1)}</span>
          )}
        </div>
      )}

      {/* Wrong project warning — defense-in-depth, structurally near-impossible */}
      {selectedChat && selectedProject && selectedChat.project_id !== selectedProject.id && (
        <div className="px-3 py-1 bg-amber-500/8 border-b border-amber-500/15 flex items-center gap-1.5" data-testid="wrong-project-warning">
          <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
          <span className="text-[10px] text-amber-400">Chat belongs to a different project</span>
        </div>
      )}

      {/* Messages Area — plain div, NOT Radix ScrollArea (its display:table wrapper inflates width) */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden"
        data-testid="messages-area"
      >
        <div className="p-3 space-y-3 w-full min-w-0">
          {/* Persistent Build Log — phrases stay visible as a build timeline */}
          {buildLog?.length > 0 && (
            <div className="space-y-0.5 py-2" data-testid="build-log">
              {buildLog.map((entry, i) => {
                const isLast = i === buildLog.length - 1
                const isActive = isLast && isStreaming
                return (
                  <div key={i} className="flex items-center gap-2 px-2 py-0.5" style={{ opacity: isActive ? 1 : 0.6 }}>
                    {isActive
                      ? <Loader2 className="w-3 h-3 animate-spin text-[var(--em-cyan)] flex-shrink-0" />
                      : <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 flex-shrink-0" />
                    }
                    <span className={`text-[12px] ${isActive ? 'text-[var(--em-cyan)]' : 'text-muted-foreground/60'}`}>
                      {entry.phrase}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {messages.length > 0 && (
            messages.map((message) => {
              const isUser = message.role === 'user'
              const isCollapsed = collapsedMessages[message.id]
              const isTemp = String(message.id).startsWith('temp-')
              const isMessageStreaming = message.streaming === true
              const isProviderError = message.metadata?.providerError === true
              const errorType = message.metadata?.error_type
              const errorProvider = message.metadata?.provider
              const messageIntent = message.metadata?.intent

              return (
                <div
                  key={message.id}
                  data-testid={`message-${message.id}`}
                  className={`em-message-enter flex gap-2.5 w-full min-w-0 group/msg ${isUser ? 'flex-row-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-1 ${
                    isUser ? 'bg-[rgba(0,229,255,0.1)]' : isProviderError ? 'bg-amber-900/20' : `bg-[rgba(124,58,237,0.1)] ${isMessageStreaming ? 'em-streaming-breathe em-streaming-glow' : ''}`
                  }`}>
                    {isUser ? (
                      <User className="w-2.5 h-2.5 text-[#00E5FF]/70" />
                    ) : isProviderError ? (
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                    ) : (
                      <Zap className="w-2.5 h-2.5 text-[#7C3AED]/70" />
                    )}
                  </div>

                  {/* Message bubble */}
                  <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
                    {isProviderError ? (
                      <div className="rounded-lg border border-amber-500/12 bg-amber-950/10 px-3.5 py-2.5 max-w-full" data-testid="provider-error-card">
                        <div className="flex items-start gap-2 mb-2">
                          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-amber-200/90">{message.content}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-3 pl-6">
                          {errorType && (
                            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                              {errorType.replace('_', ' ')}
                            </Badge>
                          )}
                          {errorType === 'context_length' && onForkChat && selectedChat && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1.5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                              onClick={() => onForkChat(selectedChat.id)}
                              data-testid="continue-new-chat-btn"
                            >
                              <GitFork className="w-3 h-3" />
                              Continue in New Chat
                            </Button>
                          )}
                          {errorType !== 'context_length' && errorProvider && errorProvider !== 'openai' && onRetryWithFallback && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1.5 border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300"
                              onClick={() => onRetryWithFallback(message)}
                              data-testid="retry-with-openai-btn"
                            >
                              <Zap className="w-3 h-3" />
                              Retry with OpenAI
                            </Button>
                          )}
                          {errorType !== 'context_length' && errorProvider && errorProvider === 'openai' && onRetryWithFallback && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
                              onClick={() => onRetryWithFallback(message)}
                              data-testid="retry-with-anthropic-btn"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Retry with Anthropic
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                    <div className="w-full min-w-0">
                    <div className={`rounded-xl min-w-0 overflow-hidden ${
                      isUser
                        ? 'bg-[rgba(0,229,255,0.06)] border border-[rgba(0,229,255,0.10)] px-3.5 py-2.5 text-[var(--em-text-primary)] max-w-[85%]'
                        : 'w-full px-1 py-0.5'
                    } ${isTemp ? 'opacity-50' : ''}`}>
                      {isUser ? (
                        <div>
                          <p className="text-[13.5px] whitespace-pre-wrap break-words overflow-hidden leading-[1.6]">{message.content}</p>
                          <AttachmentChips attachments={message.metadata?.attachments} />
                        </div>
                      ) : (
                      <>
                        <div className={`min-w-0 ${isCollapsed ? 'max-h-24 overflow-hidden relative' : ''}`}>
                          {/* Inline Image Generation Progress - persist until generatedImage exists or error */}
                          {(() => {
                            const isImageGenMessage = message.metadata?.toolMode === 'image_gen'
                            const hasGeneratedImage = !!message.metadata?.generatedImage
                            // Prefer message-level persisted progress over transient global state
                            const msgProgress = message.metadata?.imageGenProgress
                            const effectiveProgress = msgProgress || (isMessageStreaming ? imageGenProgress : null)
                            const isActiveImageGen = effectiveProgress && effectiveProgress.stage !== 'error'
                            const showProgress = !hasGeneratedImage && isActiveImageGen && (isMessageStreaming || isImageGenMessage)
                            
                            if (showProgress) {
                              return (
                                <ImageGenerationProgress
                                  stage={effectiveProgress.stage}
                                  progress={effectiveProgress.progress}
                                  mode={effectiveProgress.mode || imageGenProgress?.mode}
                                />
                              )
                            }
                            return null
                          })()}
                          {/* Inline Image Generation Error */}
                          {(() => {
                            const hasGeneratedImage = !!message.metadata?.generatedImage
                            const isError = imageGenProgress?.stage === 'error'
                            const isThisMessage = message.id === streamingMessageId || message.metadata?.toolMode === 'image_gen'
                            
                            if (!hasGeneratedImage && isError && isThisMessage) {
                              return (
                                <ImageGenerationProgress
                                  stage="error"
                                  error={imageGenProgress.error}
                                  onRetry={onRetryImageGen}
                                  mode={imageGenProgress.mode}
                                />
                              )
                            }
                            return null
                          })()}
                          {/* Regular message content (hide if showing image progress/error) */}
                          {(() => {
                            const isImageGenMessage = message.metadata?.toolMode === 'image_gen'
                            const hasGeneratedImage = !!message.metadata?.generatedImage
                            const msgProgress = message.metadata?.imageGenProgress
                            const effectiveProgress = msgProgress || (isMessageStreaming ? imageGenProgress : null)
                            const isActiveImageGen = effectiveProgress && effectiveProgress.stage !== 'error'
                            const showProgress = !hasGeneratedImage && isActiveImageGen && (isMessageStreaming || isImageGenMessage)
                            const isError = imageGenProgress?.stage === 'error'
                            const isThisMessage = message.id === streamingMessageId || isImageGenMessage
                            const showError = !hasGeneratedImage && isError && isThisMessage
                            
                            if (showProgress || showError) {
                              return null
                            }
                            return (
                              <>
                                {(() => {
                                  const { cleanContent, suggestions } = parseSuggestions(message.content)
                                  return (
                                    <>
                                      <MessageRenderer
                                        content={cleanContent}
                                        hideCodeBlocks={!!(message.metadata?.generatedFiles?.length || message.metadata?.diffFiles?.length || message.metadata?.directEditMode)}
                                      />
                                      {isMessageStreaming && (
                                        <span className="em-streaming-cursor" data-testid="streaming-cursor" />
                                      )}
                                      {!isMessageStreaming && suggestions.length > 0 && (
                                        <SuggestionChips
                                          suggestions={suggestions}
                                          onSend={(text) => onSendMessage?.(text)}
                                          disabled={!!streamingMessageId}
                                        />
                                      )}
                                    </>
                                  )
                                })()}
                              </>
                            )
                          })()}
                          {isCollapsed && (
                            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
                          )}
                        </div>
                        {message.metadata?.briefProgress && (
                          <div className="mt-2" data-testid={`brief-progress-wrapper-${message.id}`}>
                            <BriefProgressCard progress={message.metadata.briefProgress} />
                          </div>
                        )}
                        {message.metadata?.proposedPlan && message.metadata?.planStatus !== 'cancelled' && (
                          <div className="mt-2" data-testid={`plan-card-wrapper-${message.id}`}>
                            <PlanCard
                              plan={message.metadata.proposedPlan}
                              status={message.metadata.planStatus || 'proposed'}
                              executing={executingPlan && message.metadata.planStatus === 'executing'}
                              onExecute={() => onExecutePlan?.(message.id, message.metadata.proposedPlan)}
                              onRevise={() => {
                                const composerInput = document.querySelector('[data-testid="chat-input"]')
                                if (composerInput) {
                                  composerInput.focus()
                                  composerInput.value = 'Revise the plan: '
                                  composerInput.dispatchEvent(new Event('input', { bubbles: true }))
                                }
                              }}
                              onCancel={() => onCancelPlan?.(message.id)}
                            />
                          </div>
                        )}
                        {message.metadata?.diffFiles?.length > 0 && (
                          <div className="mt-2" data-testid={`diff-review-wrapper-${message.id}`}>
                            {isMonitored ? (
                              <div className="text-[10px] text-red-400/60 px-2 py-1.5 rounded-md bg-red-500/5 border border-red-500/10">
                                Diff apply/discard restricted for monitored accounts
                              </div>
                            ) : (
                              <DiffReviewPanel
                                diffs={message.metadata.diffFiles}
                                status={message.metadata.diffStatus || 'pending'}
                                applying={applyingDiffs}
                                onApply={(approved) => onApplyDiffs?.(approved)}
                                onCancel={() => onCancelDiffs?.(message.id)}
                              />
                            )}
                          </div>
                        )}
                        {message.metadata?.generatedImage && (
                          <GeneratedImageCard
                            image={message.metadata.generatedImage}
                            onOpenVariationStudio={(img, presetType) => onOpenVariationStudio?.(img, presetType)}
                            data-testid={`generated-image-wrapper-${message.id}`}
                          />
                        )}
                        </>
                      )}
                    </div>
                    </div>
                    )}

                    {/* Actions */}
                    {!isTemp && !isProviderError && !isMessageStreaming && (
                      <MessageActions
                        message={message}
                        onRegenerate={!isUser ? handleRegenerate : undefined}
                        onEditPrompt={isUser ? handleEditPrompt : undefined}
                        collapsed={isCollapsed}
                        onToggleCollapse={() => toggleCollapse(message.id)}
                        onSavePrompt={onSavePrompt}
                      />
                    )}
                  </div>
                </div>
              )
            })
          )}

          {/* Milestones log below messages — shown when messages exist */}
          {buildMilestones?.length > 0 && messages.length > 0 && !isStreaming && (
            <div className="space-y-1 py-2 px-1" data-testid="build-milestones-inline">
              <div className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">Build log</div>
              {buildMilestones.slice(-5).map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-emerald-400/60 flex-shrink-0" />
                  <span className="text-[11px] text-muted-foreground/50">{m.label}</span>
                </div>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick actions bar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5" style={{ borderTop: '1px solid rgba(0, 229, 255, 0.06)' }} data-testid="quick-actions">
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2 em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.06)] rounded-lg transition-colors duration-200" onClick={onOpenPromptLibrary} data-testid="open-prompt-library">
          <BookOpen className="w-3 h-3" /> Prompts
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2 em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.06)] rounded-lg transition-colors duration-200" onClick={onOpenBuilderMemory} data-testid="open-builder-memory">
          <Brain className="w-3 h-3" /> Memory
        </Button>
        {selectedChat && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] gap-1 px-2 em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.06)] rounded-lg transition-colors duration-200 ml-auto"
            onClick={async () => {
              setForkingChat(true)
              await onForkChat(selectedChat.id)
              setForkingChat(false)
            }}
            disabled={forkingChat}
            data-testid="fork-chat-btn"
          >
            {forkingChat ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitFork className="w-3 h-3" />}
            {forkingChat ? 'Forking...' : 'Fork'}
          </Button>
        )}
      </div>

      {/* Composer */}
      <ChatComposer
        onSend={handleSendMessage}
        disabled={!selectedChat}
        sending={isStreaming || sending}
        builderMode={builderMode}
        aiProvider={aiProvider}
        aiModel={aiModel}
        onAiProviderChange={onAiProviderChange}
        onAiModelChange={onAiModelChange}
        providerStatus={providerStatus}
        scope={scope}
        onScopeChange={onScopeChange}
        onUploadFiles={onUploadFiles}
        visualMode={visualMode}
        onVisualModeChange={onVisualModeChange}
      />
    </div>
  )
}
