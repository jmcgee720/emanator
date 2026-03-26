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
  Clock
} from 'lucide-react'
import { BUILDER_MODES, getChatType, CHAT_TYPES, SELF_EDIT_PREFIX, SELF_EDIT_TARGETS } from '@/lib/constants'
import MessageRenderer from './MessageRenderer'
import MessageActions from './MessageActions'
import ChatComposer from './ChatComposer'
import PlanCard from './PlanCard'
import DiffReviewPanel from './DiffReviewPanel'
import GeneratedImageCard from './GeneratedImageCard'
import ImageGenerationProgress from './ImageGenerationProgress'
import { AttachmentChips } from './AttachmentPreview'

const modeIcons = {
  app: Layers,
  website: Globe,
  image: Image,
  document: FileText
}

function ChatRow({ chat, selectedChat, onSelectChat, onDeleteChat, isSelfEdit }) {
  const displayTitle = isSelfEdit ? chat.title.replace(SELF_EDIT_PREFIX, '') : chat.title
  const isActive = selectedChat?.id === chat.id
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
  onCreateSandbox
}) {
  const [sending, setSending] = useState(false)
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
    <div className="h-full flex flex-col bg-[hsl(var(--em-sidebar))] min-w-0 overflow-hidden em-aurora" data-testid="left-panel">
      {/* Compact Header — project + mode in one row */}
      <div className="flex items-center gap-1.5 h-11 px-3 border-b border-border/40 flex-shrink-0" data-testid="sidebar-header">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 flex-1 min-w-0 h-8 px-2 rounded-md hover:bg-muted/30 transition-colors text-left" data-testid="project-selector">
              {selectedProject?.settings?.is_sandbox ? (
                <FlaskConical className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              ) : (
                <ModeIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{selectedProject?.name || 'Select Project'}</span>
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
      {isOwner && false && selectedChat && getChatType(selectedChat) === CHAT_TYPES.SELF_EDIT && (
        <div className="px-3 py-1.5 bg-amber-500/8 border-b border-amber-500/15" data-testid="self-edit-mode-indicator">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] font-medium text-amber-400">Core System Mode</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[9px] text-amber-400/50">Target:</span>
            <select
              className="text-[10px] bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 text-amber-300 flex-1 outline-none focus:border-amber-400/40"
              value={selfEditTarget || ''}
              onChange={e => onSelfEditTargetChange?.(e.target.value || null)}
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

      {/* Messages Area — plain div, NOT Radix ScrollArea (its display:table wrapper inflates width) */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden"
        data-testid="messages-area"
      >
        <div className="p-3 space-y-4 w-full min-w-0">
          {messages.length === 0 ? (
            <div className="text-center py-20 relative z-10">
              <div className="w-11 h-11 mx-auto rounded-lg flex items-center justify-center mb-4 em-glow-cyan" style={{background: 'linear-gradient(135deg, hsl(190 100% 50% / 0.12), hsl(270 70% 55% / 0.08))'}}>
                <Zap className="w-5 h-5 text-[#00E5FF]" />
              </div>
              <p className="text-sm font-medium text-foreground/70 mb-1">Start a conversation</p>
              <p className="text-[11px] text-muted-foreground/50 max-w-[200px] mx-auto leading-relaxed">
                Describe what you want to build and I'll help you create it
              </p>
            </div>
          ) : (
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
                  className={`flex gap-3 w-full min-w-0 ${isUser ? 'flex-row-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center mt-0.5 ${
                    isUser ? 'bg-[hsl(190_100%_50%/0.1)] border border-[hsl(190_100%_50%/0.15)]' : isProviderError ? 'bg-amber-900/20 border border-amber-500/10' : 'bg-[hsl(270_70%_55%/0.08)] border border-[hsl(270_70%_55%/0.12)]'
                  }`}>
                    {isUser ? (
                      <User className="w-3 h-3 text-[#00E5FF]/70" />
                    ) : isProviderError ? (
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                    ) : (
                      <Zap className="w-3 h-3 text-[#7C3AED]/70" />
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
                          {errorProvider && errorProvider !== 'openai' && onRetryWithFallback && (
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
                          {errorProvider && errorProvider === 'openai' && onRetryWithFallback && (
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
                    {!isUser && messageIntent && messageIntent !== 'chat' && (
                      <div className="flex items-center gap-1.5 mb-1" data-testid={`intent-badge-${message.id}`}>
                        <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">
                          Intent: {messageIntent.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )}
                    <div className={`rounded-lg px-3.5 py-2.5 min-w-0 overflow-hidden ${
                      isUser
                        ? 'bg-[hsl(190_100%_50%/0.06)] border border-[hsl(190_100%_50%/0.12)] text-foreground max-w-[85%]'
                        : 'bg-muted/30 border border-border/25 w-full'
                    } ${isTemp ? 'opacity-50' : ''}`}>
                      {isUser ? (
                        <div>
                          <p className="text-sm whitespace-pre-wrap break-words overflow-hidden">{message.content}</p>
                          <AttachmentChips attachments={message.metadata?.attachments} />
                        </div>
                      ) : (
                        <>
                        <div className={`min-w-0 ${isCollapsed ? 'max-h-24 overflow-hidden relative' : ''}`}>
                          <MessageRenderer content={message.content} />
                          {isMessageStreaming && (
                            <span className="inline-block w-2 h-4 bg-primary/80 animate-pulse rounded-sm ml-0.5 align-text-bottom" data-testid="streaming-cursor" />
                          )}
                          {isCollapsed && (
                            <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[hsl(var(--muted)/0.3)] to-transparent" />
                          )}
                        </div>
                        {message.metadata?.proposedPlan && message.metadata?.planStatus !== 'cancelled' && (
                          <div className="mt-3" data-testid={`plan-card-wrapper-${message.id}`}>
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
                          <div className="mt-3" data-testid={`diff-review-wrapper-${message.id}`}>
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

          {/* Streaming / Image generation status indicator */}
          {isStreaming && imageGenProgress && imageGenProgress.stage !== 'error' && (
            <div className="flex gap-3" data-testid="image-gen-indicator">
              <div className="w-6 h-6 rounded-md bg-muted/50 border border-border/30 flex items-center justify-center mt-0.5">
                <Zap className="w-3 h-3 text-muted-foreground/50" />
              </div>
              <div className="flex-1 min-w-0">
                <ImageGenerationProgress
                  stage={imageGenProgress.stage}
                  progress={imageGenProgress.progress}
                  mode={imageGenProgress.mode}
                />
              </div>
            </div>
          )}
          {imageGenProgress?.stage === 'error' && (
            <div className="flex gap-3" data-testid="image-gen-error-indicator">
              <div className="w-6 h-6 rounded-md bg-red-900/15 border border-red-500/10 flex items-center justify-center mt-0.5">
                <AlertTriangle className="w-3 h-3 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <ImageGenerationProgress
                  stage="error"
                  error={imageGenProgress.error}
                  onRetry={onRetryImageGen}
                  mode={imageGenProgress.mode}
                />
              </div>
            </div>
          )}
          {isStreaming && streamingStatus && !imageGenProgress && (
            <div className="flex gap-3" data-testid="streaming-indicator">
              <div className={`w-6 h-6 rounded-md border flex items-center justify-center ${
                streamingStatus.stage === 'provider_fallback' ? 'bg-amber-950/20 border-amber-500/20' : 'bg-muted/50 border-border/30'
              }`}>
                {streamingStatus.stage === 'provider_fallback'
                  ? <Clock className="w-3 h-3 text-amber-400" />
                  : <Zap className="w-3 h-3 text-muted-foreground/50" />}
              </div>
              <div className={`rounded-lg px-3.5 py-2.5 ${
                streamingStatus.stage === 'provider_fallback' ? 'bg-amber-950/10 border border-amber-500/12' : 'bg-muted/30 border border-border/25'
              }`}>
                <div className="flex items-center gap-2">
                  <Loader2 className={`w-4 h-4 animate-spin ${streamingStatus.stage === 'provider_fallback' ? 'text-amber-400' : 'text-primary'}`} />
                  <span className={`text-sm ${streamingStatus.stage === 'provider_fallback' ? 'text-amber-200/90' : 'text-muted-foreground'}`}>{streamingStatus.detail || 'Generating...'}</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick actions bar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-t border-border/25" data-testid="quick-actions">
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2 text-muted-foreground/60 hover:text-foreground/70 hover:bg-muted/20" onClick={onOpenPromptLibrary} data-testid="open-prompt-library">
          <BookOpen className="w-3 h-3" /> Prompts
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2 text-muted-foreground/60 hover:text-foreground/70 hover:bg-muted/20" onClick={onOpenBuilderMemory} data-testid="open-builder-memory">
          <Brain className="w-3 h-3" /> Memory
        </Button>
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
      />
    </div>
  )
}
