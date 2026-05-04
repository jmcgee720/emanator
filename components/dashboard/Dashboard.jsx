'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useToast } from '@/hooks/use-toast'
import TopBar from './TopBar'
import LeftPanel from './LeftPanel'
import RightPanel from './RightPanel'
import ProjectHub from './ProjectHub'
import GrowthPanel from './GrowthPanel'
import AdminPanel from './AdminPanel'
import SearchPanel from './SearchPanel'
import CanvasPanel from './CanvasPanel'
import InlineBrief from './InlineBrief'
import BuildWizard from './BuildWizard'
import ProjectGrid from './ProjectGrid'
import DesignPanel from './DesignPanel'
import VariationStudio from './VariationStudio'
import PromptLibrary from './PromptLibrary'
import { SavePromptDialog } from './PromptLibrary'
import BuilderMemory from './BuilderMemory'
import NewProjectModal from './NewProjectModal'
import { useDashboardProject } from './useDashboardProject'
import { useDashboardStream } from './useDashboardStream'
import { useSandboxOps } from './useSandboxOps'
import { useMediaBin } from './useMediaBin'
import { getDefaultDesignPrefs } from '@/lib/ai/design-system'
import { selfEditTitle, getChatType, CHAT_TYPES, SELF_EDIT_TARGETS } from '@/lib/constants'
import { Monitor, Smartphone, FileText, Mic, ChevronDown, ArrowUp, Upload, FolderArchive, GitBranch, X, CreditCard, Zap, Trash2, AlertTriangle, LayoutGrid, Plus, Sparkles, Camera } from 'lucide-react'
import { useAuroraState } from '@/hooks/useAuroraState'
import AuroraBackground from '@/components/AuroraBackground'

const EMANATOR_HEADLINES = [
  "What wants to be built through you today?",
  "Follow the signal.",
  "Turn motion into form.",
  "The next version of this starts now.",
  "Shape the unseen into the inevitable.",
  "Your instinct knows the architecture.",
  "Begin where clarity meets courage.",
  "What would you build if nothing could fail?",
  "Trust the direction. Start building.",
  "Make the invisible visible.",
  "This is where intention becomes structure.",
  "The best code starts as a feeling.",
  "Something is ready to take form.",
  "Build like no one is watching.",
  "The signal is clear. Follow it.",
  "One prompt away from something real.",
  "Let the work reveal itself.",
  "Start with what moves you.",
  "Every great product began as a whisper.",
  "The blueprint is already inside you.",
  "Build what is asking to exist.",
  "Give shape to something real.",
  "Create what the world needs next.",
  "From thought to thing.",
]

// JSON headers for POST/PUT requests (cookies handle auth automatically)
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export default function Dashboard({ user, dbUser, onSignOut }) {
  const isOwner = dbUser?.role === 'owner'
  const isMonitored = dbUser?.role === 'child_monitored'

  const [projects, setProjects] = useState([])
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectType, setNewProjectType] = useState('app')
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [selectedProject, setSelectedProject] = useState(null)
  const [openProjectTabs, setOpenProjectTabs] = useState([])

  const [chats, setChats] = useState([])
  const [selectedChat, setSelectedChat] = useState(null)
  const [messages, setMessages] = useState([])
  const [files, setFiles] = useState([])
  const [livePreviewData, setLivePreviewData] = useState(null)
  const [generatedImageMap, setGeneratedImageMap] = useState([])
  const [runtimeTestScript, setRuntimeTestScript] = useState(null)
  const previewQueueRef = useRef([])
  const previewDrainTimerRef = useRef(null)
  const [projectFileIndex, setProjectFileIndex] = useState({})
  const [canvas, setCanvas] = useState(null)
  const [livePromoteState, setLivePromoteState] = useState({ snapshotId: null, lastApply: null })

  const [showAdmin, setShowAdmin] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showCanvas, setShowCanvas] = useState(false)
  const [showDesign, setShowDesign] = useState(false)
  const [showGrowth, setShowGrowth] = useState(false)

  const [designPrefs, setDesignPrefs] = useState(getDefaultDesignPrefs())
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('preview')
  const [builderMode, setBuilderMode] = useState('app')
  const [aiProvider, setAiProvider] = useState('anthropic')
  const [aiModel, setAiModel] = useState('claude-sonnet-4-5-20250929')
  const [providerStatus, setProviderStatus] = useState({})
  const [scope, setScope] = useState('project')
  const [visualMode, setVisualMode] = useState('stock')
  const [selfEditTarget, setSelfEditTarget] = useState(null)

  const [variationStudio, setVariationStudio] = useState({ open: false, sourceImage: null })
  const [projectAssets, setProjectAssets] = useState([])
  const [assetsRefreshKey, setAssetsRefreshKey] = useState(0)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [showBuilderMemory, setShowBuilderMemory] = useState(false)
  const [savePromptData, setSavePromptData] = useState(null)
  const [showCreditsModal, setShowCreditsModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [projectMode, setProjectMode] = useState('fullstack')
  const [promptInput, setPromptInput] = useState('')
  const [heroSubmitting, setHeroSubmitting] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const voiceRecognitionRef = useRef(null)
  const [messagesReadyTick, setMessagesReadyTick] = useState(0)
  // ── Delete / Cleanup state ──
  const [deleteConfirmProject, setDeleteConfirmProject] = useState(null)
  const [selectedProjects, setSelectedProjects] = useState([])

  // ── Credits state ──
  const [creditsBalance, setCreditsBalance] = useState(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsCosts, setCreditsCosts] = useState({})

  const loadCredits = useCallback(async () => {
    try {
      const res = await authFetch('/api/credits')
      if (res?.ok) {
        const data = await res.json()
        setCreditsBalance(data.balance)
        setCreditsCosts(data.costs || {})
      }
    } catch {}
  }, [])

  // Load credits on mount
  useEffect(() => {
    loadCredits()
  }, [loadCredits])

  const handleBuyCredits = async (packageId) => {
    setCreditsLoading(true)
    try {
      const res = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: packageId, origin_url: window.location.origin }),
      })
      if (res?.ok) {
        const data = await res.json()
        if (data.url) {
          window.location.href = data.url // Redirect to Stripe Checkout
          return
        }
      }
      const err = await res?.json().catch(() => ({}))
      toast({ title: 'Error', description: err.error || 'Failed to start checkout', variant: 'destructive' })
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to start checkout', variant: 'destructive' })
    } finally {
      setCreditsLoading(false)
    }
  }

  // Poll Stripe payment status on return from checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    const stripeStatus = params.get('stripe_status')
    if (!sessionId || stripeStatus !== 'success') return

    // Clear URL params
    window.history.replaceState({}, '', window.location.pathname)

    let cancelled = false
    const pollStatus = async (attempt = 0) => {
      if (cancelled || attempt >= 8) {
        if (attempt >= 8) toast({ title: 'Payment', description: 'Could not confirm payment. It may take a moment to process.', variant: 'default' })
        return
      }
      try {
        const res = await authFetch(`/api/stripe/status/${sessionId}`)
        if (res?.ok) {
          const data = await res.json()
          if (data.payment_status === 'paid') {
            // Grant credits via the correct auth path (uses proper dbUser.id)
            let grantResult = null
            if (data.needs_credit_grant) {
              try {
                const grantRes = await authFetch('/api/credits/add', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    amount: data.credits,
                    price_paid_usd: (data.amount_total || 0) / 100,
                  }),
                })
                if (grantRes?.ok) grantResult = await grantRes.json().catch(() => null)
                // Mark as granted so it's idempotent on retry
                await authFetch(`/api/stripe/confirm-credits/${sessionId}`, { method: 'POST' })
              } catch {}
            }
            const loyaltyBonus = grantResult?.loyaltyBonus || 0
            const firstPurchaseBonus = grantResult?.firstPurchaseBonus || 0
            const total = grantResult?.totalGranted || data.credits
            const tierLabel = grantResult?.loyalty_tier?.label
            let description
            if (loyaltyBonus > 0 && firstPurchaseBonus > 0) {
              // Both bonuses present
              description = `+${total} credits added (${data.credits} base + ${loyaltyBonus} ${tierLabel || ''} loyalty + ${firstPurchaseBonus} first-purchase bonus)`
            } else if (firstPurchaseBonus > 0) {
              // Only first-purchase bonus
              description = `+${total} credits added (${data.credits} base + ${firstPurchaseBonus} first-purchase bonus)`
            } else if (loyaltyBonus > 0) {
              // Only loyalty bonus
              description = `+${total} credits added (${data.credits} base + ${loyaltyBonus} ${tierLabel || ''} loyalty bonus)`
            } else {
              // No bonus
              description = `+${total} credits added to your account`
            }
            toast({ title: 'Payment Successful', description })
            loadCredits()
            return
          }
          if (data.status === 'expired') {
            toast({ title: 'Payment Expired', description: 'Checkout session expired. Please try again.', variant: 'destructive' })
            return
          }
        }
      } catch {}
      setTimeout(() => pollStatus(attempt + 1), 2000)
    }
    pollStatus()

    return () => { cancelled = true }
  }, [])

  // ── Import handlers ──
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState(null)
  const fileInputRef = useRef(null)
  const mediaBinInputRef = useRef(null)

  // ── GitHub import state ──
  const [githubPat, setGithubPat] = useState('')
  const [githubRepo, setGithubRepo] = useState('')
  const [githubBranch, setGithubBranch] = useState('main')
  const [githubImportLoading, setGithubImportLoading] = useState(false)
  const [showGithubForm, setShowGithubForm] = useState(false)

  const handleZipImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportLoading(true)
    setImportError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await authFetch('/api/import/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setImportError(data.error || 'Import failed')
        return
      }

      toast({ title: 'Import Successful', description: `${data.metadata.file_count} files imported as "${data.metadata.project_name}" (${data.metadata.framework})` })
      setShowImportModal(false)
      loadProjects()
      openProjectWorkspace(data.project)
    } catch (err) {
      setImportError(err.message || 'Import failed')
    } finally {
      setImportLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleGithubImport = async () => {
    const pat = githubPat.trim()
    const repo = githubRepo.trim()
    const branch = githubBranch.trim() || 'main'

    if (!pat || !repo) {
      setImportError('Personal Access Token and repository (owner/repo) are required')
      return
    }

    if (!/^[^/]+\/[^/]+$/.test(repo) && !/^https?:\/\/github\.com\/[^/]+\/[^/]+/.test(repo)) {
      setImportError('Repository must be in format owner/repo or a GitHub URL')
      return
    }

    setGithubImportLoading(true)
    setImportError(null)

    try {
      const res = await authFetch('/api/import/github', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ pat, repo, branch }),
      })

      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        setImportError(text.slice(0, 200) || `Import failed (HTTP ${res.status})`)
        return
      }

      if (!res.ok) {
        setImportError(data.error || 'GitHub import failed')
        return
      }

      toast({
        title: 'GitHub Import Successful',
        description: `${data.metadata.file_count} files imported from ${data.metadata.repo_url}@${data.metadata.branch} (${data.metadata.framework})`
      })
      setShowImportModal(false)
      setShowGithubForm(false)
      setGithubPat('')
      setGithubRepo('')
      setGithubBranch('main')

      // Go to project hub for the imported project
      hubEntryRef.current = true
      setSelectedChat(null)
      setMessages([])
      setSelectedProject(data.project)
      // loadProjectData will auto-create/select a chat since skipChatSelect=false
      loadProjects()
    } catch (err) {
      setImportError(err.message || 'GitHub import failed')
    } finally {
      setGithubImportLoading(false)
    }
  }

  const [syncLoading, setSyncLoading] = useState(false)

  const handleSyncRepo = async () => {
    if (!selectedProject) return

    const settings = selectedProject.settings || {}
    if (settings.import_source !== 'github') {
      toast({ title: 'Not a GitHub project', description: 'This project was not imported from GitHub', variant: 'destructive' })
      return
    }

    // Prompt for PAT
    const pat = window.prompt('Enter your GitHub Personal Access Token to sync:')
    if (!pat || !pat.trim()) return

    setSyncLoading(true)
    try {
      const res = await authFetch('/api/import/github/sync', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ project_id: selectedProject.id, pat: pat.trim() }),
      })

      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        toast({ title: 'Sync Failed', description: text.slice(0, 200) || `Sync failed (HTTP ${res.status})`, variant: 'destructive' })
        return
      }

      if (!res.ok) {
        toast({ title: 'Sync Failed', description: data.error, variant: 'destructive' })
        return
      }

      if (!data.updated) {
        toast({ title: 'Already Up to Date', description: data.message })
      } else {
        toast({ title: 'Sync Complete', description: data.message })
        // Reload project data to reflect updated files
        loadProjectData(selectedProject.id, true)
      }
    } catch (err) {
      toast({ title: 'Sync Failed', description: err.message, variant: 'destructive' })
    } finally {
      setSyncLoading(false)
    }
  }

  const [headline] = useState(() => EMANATOR_HEADLINES[Math.floor(Math.random() * EMANATOR_HEADLINES.length)])

  // Aurora control system — Phase H6
  const pageVariant = selectedProject ? 'focused' : 'dashboard'
  const aurora = useAuroraState(pageVariant)

  // ── Canvas aurora: activityLevel ──
  const [activityLevel, setActivityLevel] = useState(0)
  const activityDecayRef = useRef(null)

  const streamAbortRef = useRef(null)
  const hubEntryRef = useRef(false)
  const importChatTitleRef = useRef(null)
  const pendingHeroPromptRef = useRef(null)
  const briefBuildActiveRef = useRef(false)
  const tabChatStateRef = useRef({})
  const pendingRestoreChatRef = useRef(null)
  const coreProjectIdRef = useRef(null)
  const [buildWizardConfig, setBuildWizardConfig] = useState(null)
  const { toast } = useToast()

  const [logs, setLogs] = useState([
    { type: 'info', message: 'Welcome to Auroraly', timestamp: new Date().toISOString() },
    { type: 'info', message: 'AI generation engine ready', timestamp: new Date().toISOString() }
  ])
  const [buildMilestones, setBuildMilestones] = useState([])
  const [buildLog, setBuildLog] = useState([])

  const addLog = useCallback((type, message) => {
    setLogs(prev => [...prev, { type, message, timestamp: new Date().toISOString() }])
  }, [])

  const addMilestone = useCallback((label) => {
    setBuildMilestones(prev => [...prev.slice(-19), { label, timestamp: new Date().toISOString() }])
  }, [])

  const addBuildLogEntry = useCallback((phrase) => {
    setBuildLog(prev => {
      if (prev.length > 0 && prev[prev.length - 1].phrase === phrase) return prev
      return [...prev, { phrase, timestamp: new Date().toISOString() }]
    })
  }, [])

  useEffect(() => {
    if (!isOwner && builderMode !== 'app') {
      setBuilderMode('app')
    }
  }, [isOwner, builderMode])

  const openProjectWorkspace = useCallback((project) => {
    if (!project) return

    setOpenProjectTabs(prev => {
      const exists = prev.some(p => p.id === project.id)
      if (exists) return prev
      return [...prev, project]
    })

    setSelectedProject(project)
  }, [])

  const closeProjectWorkspaceTab = useCallback((projectId) => {
    // Clean up stored chat state
    delete tabChatStateRef.current[projectId]

    setOpenProjectTabs(prev => {
      const idx = prev.findIndex(p => p.id === projectId)
      const nextTabs = prev.filter(p => p.id !== projectId)

      if (selectedProject?.id === projectId) {
        if (nextTabs.length > 0) {
          // Switch to nearest tab (prefer right neighbor, then left)
          const target = idx < nextTabs.length ? nextTabs[idx] : nextTabs[nextTabs.length - 1]
          const savedChatId = tabChatStateRef.current[target.id]
          if (savedChatId) pendingRestoreChatRef.current = savedChatId
          hubEntryRef.current = true
          setSelectedChat(null)
          setMessages([])
          setSelectedProject(target)
        } else {
          // No project tabs remain — fall back to Project Bin
          setSelectedProject(null)
          setSelectedChat(null)
          setMessages([])
        }
      }

      return nextTabs
    })
  }, [selectedProject])

  const switchToProjectTab = useCallback((project) => {
    if (selectedProject?.id === project.id) return
    // Save current chat state
    if (selectedProject) {
      tabChatStateRef.current[selectedProject.id] = selectedChat?.id || null
    }
    const savedChatId = tabChatStateRef.current[project.id]
    if (savedChatId) {
      pendingRestoreChatRef.current = savedChatId
    }
    hubEntryRef.current = true
    setSelectedChat(null)
    setMessages([])
    setSelectedProject(project)
  }, [selectedProject, selectedChat])

  const goToProjectsGrid = useCallback(() => {
    if (selectedProject) {
      tabChatStateRef.current[selectedProject.id] = selectedChat?.id || null
    }
    setSelectedProject(null)
    setSelectedChat(null)
    setMessages([])
  }, [selectedProject, selectedChat])

  // Clear selfEditTarget when switching to a non-self-edit chat
  const handleSelectChat = (chat) => {
    setSelectedChat(chat)
    if (!chat || getChatType(chat) !== CHAT_TYPES.SELF_EDIT) {
      setSelfEditTarget(null)
    }
  }

  const fetchProviderStatus = async () => {
    try {
      const res = await authFetch('/api/providers/status')
      if (res.ok) {
        const data = await res.json()
        setProviderStatus(data)
        Object.entries(data).forEach(([prov, info]) => {
          if (info.status !== 'ready') {
            addLog('warn', `${prov}: ${info.status} — ${info.detail || ''}`)
          }
        })
      }
    } catch {
      // non-critical
    }
  }

  useEffect(() => {
    fetchProviderStatus()
  }, [])

  useEffect(() => {
    loadProjects()
  }, [])

  useEffect(() => {
    if (selectedProject) {
      const isHubEntry = hubEntryRef.current
      hubEntryRef.current = false
      const chatTitle = importChatTitleRef.current || 'New Conversation'
      importChatTitleRef.current = null
      const restoreChatId = pendingRestoreChatRef.current
      pendingRestoreChatRef.current = null
      loadProjectData(selectedProject.id, isHubEntry, chatTitle, restoreChatId)
      setSandboxTestResult(selectedProject.settings?.last_test_result || null)
    }
  }, [selectedProject?.id])

  // Ref to always have latest sendMessage available for event handlers
  const sendMessageRef = useRef(null)

  useEffect(() => {
    if (selectedChat) {
      loadMessages(selectedChat.id)
    } else {
      setMessages([])
    }
  }, [selectedChat?.id])

  // Send pending hero prompt AFTER messages finish loading (avoids race condition)
  // ONLY depends on messagesReadyTick — NOT selectedChat — to ensure loadMessages
  // has completed before we add new messages (otherwise loadMessages wipes them)
  useEffect(() => {
    console.log('[HeroPromptEffect] tick:', messagesReadyTick, 'pending:', !!pendingHeroPromptRef.current, 'chat:', !!selectedChat, 'project:', !!selectedProject, 'streaming:', streamingMessageId)
    if (pendingHeroPromptRef.current && selectedChat && selectedProject && !streamingMessageId) {
      const pending = pendingHeroPromptRef.current
      pendingHeroPromptRef.current = null
      briefBuildActiveRef.current = true

      // If it's a brief build on a fresh project (no files yet), route to the
      // stepped BuildWizard — avoids the Vercel 300s streaming timeout by
      // breaking the build into 5 discrete API calls the user advances through.
      const isFreshProject = !files || files.length === 0
      if (pending.fullInstruction && isFreshProject) {
        console.log('[HeroPromptEffect] Routing brief build → BuildWizard (fresh project)')
        // Prefer the model selected in the Creative Brief form; fall back to
        // the chat-footer dropdown's provider/model if user didn't pick one.
        const modelProvider = pending.modelChoice?.provider || aiProvider
        const modelId = pending.modelChoice?.model || aiModel
        setBuildWizardConfig({
          projectId: selectedProject.id,
          chatId: selectedChat.id,
          message: pending.fullInstruction,
          displayMessage: pending.displayMessage,
          attachments: pending.attachments || [],
          provider: modelProvider,
          model: modelId,
        })
        return
      }

      // Legacy path for edits / non-brief builds / projects with existing files
      if (pending.fullInstruction) {
        console.log('[HeroPromptEffect] SENDING brief build, display:', pending.displayMessage?.length, 'instruction:', pending.fullInstruction?.length)
        sendMessage(pending.displayMessage, pending.attachments || null, { hiddenInstruction: pending.fullInstruction })
      } else {
        console.log('[HeroPromptEffect] SENDING prompt, length:', (typeof pending === 'string' ? pending : pending.displayMessage || '').length)
        sendMessage(typeof pending === 'string' ? pending : pending.displayMessage)
      }
    }
  }, [messagesReadyTick])

  // ── Project/Chat CRUD operations (extracted to useDashboardProject) ──
  const {
    loadProjects, loadProjectData, autoCreateChat, loadMessages,
    createProject, createChat, createSelfEditChat, uploadFiles,
    forkChat, deleteChat, renameChat, renameProject, deleteProject,
    importProject, updateCanvas,
  } = useDashboardProject({
    setProjects, setSelectedProject, setOpenProjectTabs, selectedProject, openProjectTabs,
    setChats, chats, setSelectedChat, selectedChat, setMessages, setFiles, setCanvas, setLoading,
    setMessagesReadyTick, setSelfEditTarget,
    isOwner, addLog, toast, openProjectWorkspace,
    coreProjectIdRef, importChatTitleRef,
  })

  // ── Streaming/Plan/Diff operations (extracted to useDashboardStream) ──
  const {
    sendMessage, executePlan, retryWithFallback,
    applyDiffs, cancelDiffs, cancelPlan,
    streamingMessageId, streamingStatus,
    pendingPlan, setPendingPlan,
    executingPlan,
    pendingDiffs, setPendingDiffs,
    applyingDiffs,
    diffMessageId,
    diffPlanData,
    imageGenProgress,
  } = useDashboardStream({
    selectedChat, selectedProject, files, setFiles,
    messages, setMessages, canvas, setCanvas,
    scope, aiProvider, aiModel, selfEditTarget, designPrefs, visualMode, builderMode,
    livePromoteState, creditsBalance, setCreditsBalance,
    projectFileIndex, setProjectFileIndex,
    setLivePreviewData, setGeneratedImageMap, setRuntimeTestScript,
    addLog, addMilestone, addBuildLogEntry, toast,
    loadProjectData, loadMessages,
    setActivityLevel, setActiveTab,
    streamAbortRef, previewQueueRef, previewDrainTimerRef,
    setAiProvider, setAiModel,
    sendMessageRef,
    setBuildLog, setBuildMilestones, setAssetsRefreshKey, briefBuildActiveRef,
  })

  // Keep ref updated so event handlers always have latest sendMessage
  sendMessageRef.current = sendMessage

  // ── Aurora activity decay (depends on streamingMessageId from useDashboardStream) ──
  useEffect(() => {
    if (streamingMessageId) {
      setActivityLevel(1)
      if (activityDecayRef.current) {
        clearInterval(activityDecayRef.current)
        activityDecayRef.current = null
      }
      return
    }
    activityDecayRef.current = setInterval(() => {
      setActivityLevel(prev => {
        const next = prev - 0.008
        if (next <= 0) {
          clearInterval(activityDecayRef.current)
          activityDecayRef.current = null
          return 0
        }
        return next
      })
    }, 50)
    return () => {
      if (activityDecayRef.current) clearInterval(activityDecayRef.current)
    }
  }, [streamingMessageId])

  // ── Sandbox operations (extracted to useSandboxOps) ──
  const {
    sandboxTestResult, setSandboxTestResult,
    sandboxTesting, promoting,
    showPromoteConfirm, setShowPromoteConfirm,
    showRollbackConfirm, setShowRollbackConfirm,
    rollingBack,
    sandboxDiff, setSandboxDiff,
    showSandboxDiff, setShowSandboxDiff,
    loadingDiff,
    createSandbox, testBeforeApply, promoteSandbox, loadSandboxDiff, rollbackSandbox,
  } = useSandboxOps({
    selectedProject, setSelectedProject, setProjects, openProjectWorkspace,
    setChats, setSelectedChat, setMessages, setFiles, setCanvas, addLog, pendingDiffs, toast,
  })

  // ── Media bin (extracted to useMediaBin) ──
  const {
    mediaBinFiles, setMediaBinFiles,
    loadMediaBin, handleMediaBinUpload, handleMediaBinDelete,
  } = useMediaBin({ selectedProject, setFiles, uploadFiles, toast })


  const handleHeroPromptSubmit = async () => {
    const text = promptInput.trim()
    if (!text || heroSubmitting) return

    setHeroSubmitting(true)
    try {
      const type = projectMode === 'sandbox' ? 'sandbox' : 'app'
      pendingHeroPromptRef.current = text
      await createProject('New Project', type)
      setPromptInput('')
      aurora.triggerEnergyFlow?.()
      setActivityLevel(1)    } catch (error) {
      pendingHeroPromptRef.current = null
    } finally {
      setHeroSubmitting(false)
    }
  }

  const toggleVoiceDictation = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast({ title: 'Not Supported', description: 'Voice input is not supported in this browser.', variant: 'destructive' })
      return
    }

    if (voiceListening && voiceRecognitionRef.current) {
      voiceRecognitionRef.current.stop()
      setVoiceListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'
    voiceRecognitionRef.current = recognition

    let finalTranscript = ''

    recognition.onstart = () => setVoiceListening(true)

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript
        } else {
          interim += event.results[i][0].transcript
        }
      }
      setPromptInput(prev => {
        const base = prev.replace(/\u200B.*$/, '')
        return finalTranscript + (interim ? interim : '')
      })
    }

    recognition.onend = () => {
      setVoiceListening(false)
      voiceRecognitionRef.current = null
      if (finalTranscript) {
        setPromptInput(finalTranscript)
      }
    }

    recognition.onerror = (event) => {
      setVoiceListening(false)
      voiceRecognitionRef.current = null
      if (event.error !== 'aborted') {
        toast({ title: 'Voice Error', description: `Speech recognition error: ${event.error}`, variant: 'destructive' })
      }
    }

    recognition.start()
  }

  const openVariationStudio = (image, presetType, styleOverrides) => {
    setVariationStudio({ open: true, sourceImage: image, presetType, styleOverrides })
    if (selectedProject) {
      authFetch(`/api/projects/${selectedProject.id}/assets`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setProjectAssets(Array.isArray(data) ? data : []))
        .catch(() => {})
    }
  }

  const generateVariation = async (params) => {
    if (!selectedProject || !selectedChat) return

    const { variationType, sourceImage, references, locks, styleLevel, targetStyle, outputSettings, characterName, customPrompt, states } = params

    const statesToGenerate = (variationType === 'sprite_states' && states?.length > 1)
      ? states
      : [states?.[0] || null]

    for (const stateName of statesToGenerate) {
      const stateLabel = stateName || variationType.replace(/_/g, ' ')
      addLog('info', `Generating variation: ${stateLabel}...`)

      const tempId = `streaming-variation-${Date.now()}`
      setMessages(prev => [...prev, {
        id: tempId,
        role: 'assistant',
        content: `Generating ${stateLabel}...`,
        streaming: true,
        metadata: { toolMode: 'image_gen' },
      }])
      setStreamingMessageId(tempId)
      setImageGenProgress({ stage: 'preparing', progress: 5, label: 'Preparing request', mode: stateLabel, startTime: Date.now() })

      const prompt = sourceImage?.prompt
        ? `${sourceImage.prompt}${stateName ? ` — State: ${stateName}` : ''}${customPrompt ? `\n${customPrompt}` : ''}`
        : customPrompt || `Generate a ${variationType.replace(/_/g, ' ')}${stateName ? ` — state: ${stateName}` : ''}`

      try {
        const res = await authFetch(`/api/projects/${selectedProject.id}/generate-image`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            prompt,
            mode: sourceImage?.mode || 'image',
            size: '1024x1024',
            chatId: selectedChat.id,
            variation: {
              variationType,
              sourceImage: sourceImage ? { id: sourceImage.id, path: sourceImage.path, prompt: sourceImage.prompt, mode: sourceImage.mode } : null,
              references: (references || []).map(r => ({ id: r.id, path: r.path, prompt: r.prompt, mode: r.mode, role: r.role })),
              locks,
              styleLevel,
              targetStyle,
              outputSettings,
              characterName,
              customPrompt,
              stateName,
            }
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || 'Variation generation failed')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let asset = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          let currentEvent = null
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const eventData = JSON.parse(line.slice(6))
                if (currentEvent === 'image_stage') {
                  setImageGenProgress(prev => ({ ...prev, stage: eventData.stage, progress: eventData.progress, label: eventData.label }))
                } else if (currentEvent === 'image_complete') {
                  asset = eventData.asset
                  setImageGenProgress(prev => ({ ...prev, stage: 'rendering', progress: 100 }))
                } else if (currentEvent === 'image_error') {
                  throw new Error(eventData.error || 'Generation failed')
                }
              } catch (parseErr) {
                if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr
              }
              currentEvent = null
            }
          }
        }

        if (!asset) throw new Error('No image asset received')

        const genImage = {
          id: asset.id,
          path: asset.path,
          filename: asset.filename,
          prompt: asset.prompt,
          mode: asset.mode,
          size: asset.size,
          revisedPrompt: asset.revisedPrompt,
          duration: asset.duration,
          projectId: selectedProject.id,
          variationType: asset.variationType,
          sourceAssetPath: asset.sourceAssetPath,
          stateName: asset.stateName,
          characterName: asset.characterName,
        }

        const content = `## ${stateName ? `${stateName} State` : 'Variation'} Generated\n\n**Type:** ${variationType.replace(/_/g, ' ')}\n**Prompt:** ${prompt.slice(0, 200)}\n**File:** \`${asset.path}\`\n${asset.revisedPrompt ? `**Revised:** ${asset.revisedPrompt}\n` : ''}\n*Generated in ${(asset.duration / 1000).toFixed(1)}s*`

        try {
          const { recordGenerationDuration } = await import('./ImageGenerationProgress')
          recordGenerationDuration(asset.duration)
        } catch {}

        setMessages(prev => prev.map(m => m.id === tempId
          ? { ...m, id: m.id, content, streaming: false, metadata: { ...m.metadata, generatedImage: genImage } }
          : m
        ))

        addLog('success', `Variation generated: ${asset.filename}`)

        try {
          const r = await authFetch(`/api/projects/${selectedProject.id}/files`)
          if (r.ok) setFiles(await r.json())
        } catch {}

        setAssetsRefreshKey(k => k + 1)

      } catch (err) {
        setMessages(prev => prev.map(m => m.id === tempId
          ? { ...m, content: `Variation generation failed: ${err.message}`, streaming: false }
          : m
        ))
        addLog('error', `Variation failed: ${err.message}`)
      }

      setImageGenProgress(null)
      setStreamingStatus(null)
      setStreamingMessageId(null)
    }
  }

  if (showAdmin) {
    return (
      <AdminPanel
        user={user}
        dbUser={dbUser}
        onClose={() => setShowAdmin(false)}
        onSignOut={onSignOut}
      />
    )
  }

  if (showGrowth) {
    return (
      <div className="flex flex-col h-screen em-bg-base">
        <GrowthPanel
          onClose={() => setShowGrowth(false)}
          onFixIssue={(issueText, pageUrl) => {
            setShowGrowth(false)
            const fixPrompt = `Fix this SEO issue on ${pageUrl}: ${issueText}`
            setTimeout(() => sendMessage(fixPrompt), 300)
          }}
          onBuildBetter={(pageData) => {
            setShowGrowth(false)
            const buildPrompt = `Build a better version of this page. Here's the competitor analysis:

URL: ${pageData.url}
Title: ${pageData.title || 'None'}
Meta: ${pageData.meta || 'None'}
Word Count: ${pageData.wordCount || 'Unknown'}

SEO Issues Found:
${pageData.issues}

Build a stunning, SEO-optimized page that fixes ALL of these issues. Make it visually impressive with proper headings, meta tags, structured content, and a modern design. Outperform the competitor in every metric.`
            setTimeout(() => sendMessage(buildPrompt), 300)
          }}
        />
      </div>
    )
  }




  return (
    <div className={`h-screen flex flex-col relative ${aurora.auroraClassName}`} style={{ color: 'var(--em-text-primary)', zIndex: 1 }} data-testid="dashboard">
      {/* Canvas aurora background — full energy on Project Bin, chat-driven otherwise */}
      <AuroraBackground activityLevel={selectedProject ? activityLevel : 1} />
      {selectedProject?.settings?.is_sandbox && (() => {
        const testResult = sandboxTestResult || selectedProject.settings.last_test_result
        const canPromote = isOwner && testResult?.passed && selectedProject.settings.sandbox_status === 'active'
        const isPromoted = selectedProject.settings.sandbox_status === 'promoted'
        const isRolledBack = selectedProject.settings.sandbox_status === 'rolled_back'
        return (
          <>
            <div className="h-8 flex items-center justify-center gap-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-[11px] font-medium px-4" data-testid="sandbox-banner">
              {isRolledBack ? (
                <span className="text-orange-400">Sandbox rolled back — primary workspace restored to pre-promotion state</span>
              ) : isPromoted ? (
                <span className="text-emerald-400">Sandbox promoted to primary — this snapshot is read-only</span>
              ) : (
                <span>Sandbox Mode — Changes stay isolated</span>
              )}
              {!isPromoted && !isRolledBack && (
                <button
                  onClick={testBeforeApply}
                  disabled={sandboxTesting}
                  className="px-2.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-colors disabled:opacity-50 cursor-pointer text-[10px] font-semibold tracking-wide"
                  data-testid="test-before-apply-btn"
                >
                  {sandboxTesting ? 'Testing…' : 'Test Changes'}
                </button>
              )}
              {testResult && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    testResult.passed
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                      : 'bg-red-500/15 text-red-400 border border-red-500/20'
                  }`}
                  data-testid="test-result-badge"
                >
                  {testResult.passed ? 'PASS' : `FAIL (${testResult.errors?.length || 0})`}
                </span>
              )}
              {canPromote && (
                <button
                  onClick={() => setShowPromoteConfirm(true)}
                  disabled={promoting}
                  className="px-2.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 cursor-pointer text-[10px] font-semibold tracking-wide text-emerald-400"
                  data-testid="promote-btn"
                >
                  {promoting ? 'Promoting…' : 'Promote to Primary'}
                </button>
              )}
              {!isPromoted && !isRolledBack && (
                <button
                  onClick={loadSandboxDiff}
                  disabled={loadingDiff}
                  className="px-2.5 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-colors disabled:opacity-50 cursor-pointer text-[10px] font-semibold tracking-wide text-blue-400"
                  data-testid="view-diff-btn"
                >
                  {loadingDiff ? 'Loading…' : 'View Diff'}
                </button>
              )}
              {isPromoted && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" data-testid="promoted-badge">
                  PROMOTED
                </span>
              )}
              {isPromoted && isOwner && (
                <button
                  onClick={() => setShowRollbackConfirm(true)}
                  disabled={rollingBack}
                  className="px-2.5 py-0.5 rounded-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer text-[10px] font-semibold tracking-wide text-red-400"
                  data-testid="rollback-btn"
                >
                  {rollingBack ? 'Rolling back…' : 'Rollback'}
                </button>
              )}
              {selectedProject.settings.sandbox_status === 'rolled_back' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/20" data-testid="rolledback-badge">
                  ROLLED BACK
                </span>
              )}
            </div>

            {showPromoteConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="promote-confirm-overlay">
                <div className="bg-card border border-border rounded-lg p-6 max-w-md mx-4 shadow-xl" data-testid="promote-confirm-dialog">
                  <h3 className="text-sm font-semibold mb-2">Promote Sandbox to Primary?</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    This will overwrite the primary workspace files with the sandbox state.
                    The sandbox will remain as a read-only snapshot.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowPromoteConfirm(false)}
                      className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
                      data-testid="promote-cancel-btn"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={promoteSandbox}
                      disabled={promoting}
                      className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors disabled:opacity-50"
                      data-testid="promote-confirm-btn"
                    >
                      {promoting ? 'Promoting…' : 'Confirm Promote'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showRollbackConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="rollback-confirm-overlay">
                <div className="bg-card border border-border rounded-lg p-6 max-w-md mx-4 shadow-xl" data-testid="rollback-confirm-dialog">
                  <h3 className="text-sm font-semibold mb-2 text-red-400">Rollback Promotion?</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    This will restore the primary workspace to its state before this sandbox was promoted.
                    The sandbox will be marked as rolled back.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowRollbackConfirm(false)}
                      className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
                      data-testid="rollback-cancel-btn"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={rollbackSandbox}
                      disabled={rollingBack}
                      className="px-3 py-1.5 text-xs rounded-md bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-50"
                      data-testid="rollback-confirm-btn"
                    >
                      {rollingBack ? 'Rolling back…' : 'Confirm Rollback'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showSandboxDiff && sandboxDiff && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="sandbox-diff-overlay">
                <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[70vh] flex flex-col" data-testid="sandbox-diff-panel">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                    <div>
                      <h3 className="text-sm font-semibold">Sandbox vs Primary</h3>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {sandboxDiff.total_changes} change{sandboxDiff.total_changes !== 1 ? 's' : ''} —
                        <span className="text-emerald-400 ml-1">+{sandboxDiff.summary.created} created</span>
                        <span className="text-blue-400 ml-1">~{sandboxDiff.summary.updated} updated</span>
                        <span className="text-red-400 ml-1">-{sandboxDiff.summary.deleted} deleted</span>
                      </p>
                    </div>
                    <button
                      onClick={() => setShowSandboxDiff(false)}
                      className="px-2 py-1 text-xs rounded-md border border-border hover:bg-muted transition-colors"
                      data-testid="diff-close-btn"
                    >
                      Close
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2" data-testid="diff-file-list">
                    {sandboxDiff.total_changes === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8" data-testid="diff-empty">No differences — sandbox matches primary</p>
                    ) : (
                      <div className="space-y-px">
                        {sandboxDiff.changes.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/30 transition-colors" data-testid={`diff-row-${i}`}>
                            <span className={`text-[10px] font-bold w-14 text-center rounded px-1.5 py-0.5 ${
                              c.status === 'create' ? 'bg-emerald-500/15 text-emerald-400' :
                              c.status === 'delete' ? 'bg-red-500/15 text-red-400' :
                              'bg-blue-500/15 text-blue-400'
                            }`} data-testid={`diff-status-${i}`}>
                              {c.status === 'create' ? 'NEW' : c.status === 'delete' ? 'DEL' : 'MOD'}
                            </span>
                            <span className="text-xs font-mono truncate flex-1">{c.path}</span>
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">
                              {c.lines_added > 0 && <span className="text-emerald-400">+{c.lines_added}</span>}
                              {c.lines_added > 0 && c.lines_removed > 0 && ' '}
                              {c.lines_removed > 0 && <span className="text-red-400">-{c.lines_removed}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )
      })()}

      <TopBar
        user={user}
        dbUser={dbUser}
        selectedProject={selectedProject}
        onSignOut={onSignOut}
        onOpenAdmin={() => setShowAdmin(true)}
        onOpenSearch={() => setShowSearch(true)}
        onOpenDesign={() => setShowDesign(true)}
        onOpenCredits={() => setShowCreditsModal(true)}
        onOpenImport={() => setShowImportModal(true)}
        onOpenGrowth={() => setShowGrowth(true)}
        isOwner={isOwner}
        isMonitored={isMonitored}
        auroraIntensity={aurora.intensity}
        onAuroraIntensityChange={aurora.setIntensity}
        creditsBalance={creditsBalance}
      />

      {!selectedProject ? (
        <ProjectGrid
          projects={projects}
          isOwner={isOwner}
          headline={headline}
          aurora={aurora}
          onOpenProject={(item) => {
            hubEntryRef.current = true
            setBuilderMode('app')
            setSelectedChat(null)
            setMessages([])
            openProjectWorkspace(item)
          }}
          onCreateProject={createProject}
          onDeleteProject={async (pid) => {
            await authFetch(`/api/projects/${pid}`, { method: 'DELETE' })
            setProjects(prev => prev.filter(p => p.id !== pid))
          }}
          onEnterCoreSystem={async () => {
            setBuilderMode('core')
            let coreProject =
              projects.find(p => p.settings?.is_core === true) ||
              (coreProjectIdRef.current && projects.find(p => p.id === coreProjectIdRef.current)) ||
              null
            if (!coreProject) {
              try {
                const resp = await authFetch('/api/projects', {
                  method: 'POST',
                  headers: JSON_HEADERS,
                  body: JSON.stringify({ name: 'Core System', type: 'app', settings: { is_core: true } })
                })
                if (!resp.ok) return
                const data = await resp.json()
                coreProject = data.project || data
                setProjects(prev => [coreProject, ...prev])
              } catch { return }
            }
            coreProjectIdRef.current = coreProject.id
            hubEntryRef.current = true
            setSelectedChat(null)
            setMessages([])
            openProjectWorkspace(coreProject)
          }}
          onBuyCredits={handleBuyCredits}
          showNewProjectModal={showNewProjectModal}
          setShowNewProjectModal={setShowNewProjectModal}
          newProjectName={newProjectName}
          setNewProjectName={setNewProjectName}
          newProjectType={newProjectType}
          setNewProjectType={setNewProjectType}
          selectedTemplate={selectedTemplate}
          setSelectedTemplate={setSelectedTemplate}
          selectedProject={selectedProject}
          addLog={addLog}
          toast={toast}
          projectMode={projectMode}
          heroSubmitting={heroSubmitting}
          setHeroSubmitting={setHeroSubmitting}
          pendingHeroPromptRef={pendingHeroPromptRef}
          importChatTitleRef={importChatTitleRef}
          setActivityLevel={setActivityLevel}
          showCreditsModal={showCreditsModal}
          setShowCreditsModal={setShowCreditsModal}
          creditsBalance={creditsBalance}
          creditsLoading={creditsLoading}
          creditsCosts={creditsCosts}
          selectedProjects={selectedProjects}
          setSelectedProjects={setSelectedProjects}
          deleteConfirmProject={deleteConfirmProject}
          setDeleteConfirmProject={setDeleteConfirmProject}
        />
      ) : !selectedChat ? (
        <ProjectHub
          project={selectedProject}
          chats={chats}
          files={files}
          mediaBinFiles={mediaBinFiles}
          onSelectChat={(chat) => handleSelectChat(chat)}
          onCreateChat={() => builderMode === 'core' && isOwner ? createSelfEditChat() : createChat()}
          onBack={goToProjectsGrid}
          onDeleteProject={() => setDeleteConfirmProject(selectedProject)}
          onUploadMediaBin={() => mediaBinInputRef.current?.click()}
          onSyncRepo={handleSyncRepo}
          onRenameChat={renameChat}
          onRenameProject={(newName) => renameProject(selectedProject.id, newName)}
          onDeleteMediaFile={handleMediaBinDelete}
          onOpenCanvas={() => setShowCanvas(true)}
          livePromoteState={livePromoteState}
        />
      ) : (
        <>
          {/* ── Workspace Tabs Row ── */}
          <div className="flex items-center justify-between px-6 pt-3 pb-2 relative z-10">
            {/* Left: Project navigation */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSelectedProject(null)
                  setChats([])
                  setSelectedChat(null)
                  setMessages([])
                  setFiles([])
                  setCanvas(null)
                }}
                className="shrink-0 px-4 py-2 rounded-full text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 border border-white/10 transition-all duration-300 backdrop-blur-sm"
                data-testid="workspace-back-to-grid"
              >
                Project Bin
              </button>
              <button
                onClick={() => {
                  setSelectedChat(null)
                  setMessages([])
                }}
                className="shrink-0 px-4 py-2 rounded-full text-xs font-medium bg-white/10 text-white border border-white/20 backdrop-blur-md shadow-[0_-4px_12px_-4px_rgba(255,255,255,0.05)]"
                data-testid="workspace-back-to-hub"
              >
                {selectedProject?.name || 'Hub'}
              </button>
              {selectedChat && (
                <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-white/80 backdrop-blur-sm">
                  <span className="truncate max-w-[180px]">{selectedChat.title || 'Chat'}</span>
                  <button
                    onClick={() => {
                      const newTitle = prompt('Rename conversation:', selectedChat.title)
                      if (newTitle?.trim()) renameChat(selectedChat.id, newTitle.trim())
                    }}
                    className="ml-1 opacity-40 hover:opacity-100 transition-opacity"
                    data-testid="workspace-rename-chat"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  </button>
                </div>
              )}
            </div>

            {/* Right: Preview toolbar */}
            <div className="flex items-center gap-1.5">
              {[
                { label: 'New Tab', icon: 'ExternalLink', testid: 'preview-open-tab', action: () => { if (selectedProject?.id) window.open(`/api/projects/${selectedProject.id}/preview`, '_blank') } },
                { label: 'Refresh', icon: 'RefreshCw', testid: 'preview-refresh', action: () => { setActiveTab('preview') } },
              ].map(btn => (
                <button
                  key={btn.testid}
                  onClick={btn.action}
                  className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors backdrop-blur-sm"
                  data-testid={btn.testid}
                  title={btn.label}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {btn.icon === 'ExternalLink' && <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>}
                    {btn.icon === 'RefreshCw' && <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>}
                  </svg>
                </button>
              ))}
              <button
                onClick={() => setActiveTab('deploy')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold bg-white text-black hover:bg-gray-200 transition-all duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                data-testid="preview-deploy-btn"
              >
                Deploy
              </button>
            </div>
          </div>

          {/* ── Main Workspace: Chat + Preview glass panels ── */}
          <div className="flex-1 px-6 pb-6 min-h-0 overflow-hidden">
            <ResizablePanelGroup direction="horizontal" className="h-full gap-4">
              <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
                <div className="em-glass rounded-[2rem] h-full overflow-hidden" data-testid="chat-glass-panel">
                  <LeftPanel
                  projects={projects}
                  selectedProject={selectedProject}
                  onSelectProject={openProjectWorkspace}
                  onCreateProject={createProject}
                  onDeleteProject={deleteProject}
                  chats={builderMode === 'core' && isOwner
                    ? chats.filter(chat => getChatType(chat) === CHAT_TYPES.SELF_EDIT)
                    : chats.filter(chat => getChatType(chat) !== CHAT_TYPES.SELF_EDIT)
                  }
                  selectedChat={selectedChat}
                  onSelectChat={handleSelectChat}
                  onCreateChat={builderMode === 'core' && isOwner ? createSelfEditChat : createChat}
                  onDeleteChat={deleteChat}
                  onForkChat={forkChat}
                  onRenameChat={renameChat}
                  onCreateSelfEditChat={createSelfEditChat}
                  selfEditTarget={selfEditTarget}
                  selfEditTargets={SELF_EDIT_TARGETS}
                  onSelfEditTargetChange={setSelfEditTarget}
                  isOwner={isOwner}
                  isMonitored={isMonitored}
                  messages={messages}
                  onSendMessage={sendMessage}
                  builderMode={builderMode}
                  onBuilderModeChange={setBuilderMode}
                  aiProvider={aiProvider}
                  aiModel={aiModel}
                  onAiProviderChange={setAiProvider}
                  onAiModelChange={setAiModel}
                  onImportProject={importProject}
                  providerStatus={providerStatus}
                  onRetryWithFallback={retryWithFallback}
                  scope={scope}
                  onScopeChange={setScope}
                  projectName={selectedProject?.name}
                  fileCount={projectFileIndex[selectedProject?.id]?.length ?? files?.length ?? 0}
                  loading={loading}
                  streamingMessageId={streamingMessageId}
                  streamingStatus={streamingStatus}
                  pendingPlan={pendingPlan}
                  executingPlan={executingPlan}
                  onExecutePlan={executePlan}
                  onCancelPlan={cancelPlan}
                  pendingDiffs={pendingDiffs}
                  applyingDiffs={applyingDiffs}
                  onApplyDiffs={applyDiffs}
                  onCancelDiffs={cancelDiffs}
                  onUploadFiles={uploadFiles}
                  imageGenProgress={imageGenProgress}
                  onRetryImageGen={() => {
                    const lastUser = [...messages].reverse().find(m => m.role === 'user')
                    if (lastUser) {
                      setImageGenProgress(null)
                      sendMessage(lastUser.content)
                    }
                  }}
                  onOpenVariationStudio={openVariationStudio}
                  onOpenPromptLibrary={() => setShowPromptLibrary(true)}
                  onOpenBuilderMemory={() => setShowBuilderMemory(true)}
                  onSavePrompt={(text, metadata) => setSavePromptData({ text, metadata })}
                  onCreateSandbox={createSandbox}
                  visualMode={visualMode}
                  onVisualModeChange={setVisualMode}
                  buildMilestones={buildMilestones}
                  buildLog={buildLog}
                />
                </div>
              </ResizablePanel>

              <ResizableHandle className="w-1 bg-transparent hover:bg-white/10 transition-colors duration-200 rounded-full" />

              <ResizablePanel defaultSize={65}>
                <div className="em-glass rounded-[2rem] h-full overflow-hidden" data-testid="preview-glass-panel">
                  <RightPanel
                  selectedProject={selectedProject}
                  files={files}
                  setFiles={setFiles}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  logs={logs}
                  addLog={addLog}
                  onOpenVariationStudio={openVariationStudio}
                  assetsRefreshKey={assetsRefreshKey}
                  livePromoteState={livePromoteState}
                  setLivePromoteState={setLivePromoteState}
                  livePreviewData={livePreviewData}
                  isBuilding={!!streamingMessageId}
                  runtimeTestScript={runtimeTestScript}
                  generatedImageMap={generatedImageMap}
                  onApplySuccess={null}
                />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </>
      )}

      {showSearch && (
        <SearchPanel
          onClose={() => setShowSearch(false)}
          onSelectProject={(project) => {
            openProjectWorkspace(project)
            setShowSearch(false)
          }}
          onSelectChat={(chat, project) => {
            if (project) openProjectWorkspace(project)
            setSelectedChat(chat)
            setShowSearch(false)
          }}
        />
      )}

      {showCanvas && selectedProject && (
        <CanvasPanel
          project={selectedProject}
          onClose={() => setShowCanvas(false)}
          onStartBuilding={async (prompt) => {
            console.log('[Dashboard] onStartBuilding called, prompt length:', prompt?.length, 'selectedChat:', !!selectedChat)
            setShowCanvas(false)
            // Ensure we have a chat to send to
            if (!selectedChat) {
              console.log('[Dashboard] No chat — creating one...')
              await createChat('Build from Brief')
              // Wait for chat state to settle
              await new Promise(r => setTimeout(r, 500))
            }
            pendingHeroPromptRef.current = prompt
            setMessagesReadyTick(t => t + 1)
            console.log('[Dashboard] Set pendingHeroPrompt and incremented tick')
          }}
        />
      )}

      {showDesign && selectedProject && (
        <DesignPanel
          projectId={selectedProject.id}
          designPrefs={designPrefs}
          onUpdate={setDesignPrefs}
          onClose={() => setShowDesign(false)}
        />
      )}

      {buildWizardConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" data-testid="build-wizard-overlay">
          <div className="w-full max-w-xl">
            <BuildWizard
              projectId={buildWizardConfig.projectId}
              chatId={buildWizardConfig.chatId}
              message={buildWizardConfig.message}
              attachments={buildWizardConfig.attachments}
              provider={buildWizardConfig.provider}
              model={buildWizardConfig.model}
              onComplete={async (resp) => {
                console.log('[Dashboard] BuildWizard complete:', resp)
                toast({ title: 'Build complete', description: `${resp.fileCount || 0} files created. Refreshing preview...` })
                briefBuildActiveRef.current = false
                setTimeout(() => {
                  setBuildWizardConfig(null)
                  if (loadProjectData && selectedProject) loadProjectData(selectedProject.id)
                  setAssetsRefreshKey((k) => k + 1)
                }, 1500)
              }}
              onCancel={() => {
                setBuildWizardConfig(null)
                briefBuildActiveRef.current = false
              }}
            />
          </div>
        </div>
      )}

      <VariationStudio
        key={`vs-${variationStudio.sourceImage?.id || 'new'}`}
        open={variationStudio.open}
        onClose={() => setVariationStudio({ open: false, sourceImage: null })}
        sourceImage={variationStudio.sourceImage}
        presetType={variationStudio.presetType}
        styleOverrides={variationStudio.styleOverrides}
        assets={projectAssets}
        projectId={selectedProject?.id}
        onGenerate={generateVariation}
      />

      <PromptLibrary
        open={showPromptLibrary}
        onClose={() => setShowPromptLibrary(false)}
        projectId={selectedProject?.id}
        onUsePrompt={(text) => {
          const composer = document.querySelector('[data-testid="chat-input"]')
          if (composer) {
            composer.value = text
            composer.dispatchEvent(new Event('input', { bubbles: true }))
          }
        }}
      />

      <BuilderMemory
        open={showBuilderMemory}
        onClose={() => setShowBuilderMemory(false)}
        projectId={selectedProject?.id}
      />

      {savePromptData && (
        <SavePromptDialog
          open={!!savePromptData}
          onClose={() => setSavePromptData(null)}
          projectId={selectedProject?.id}
          messageText={savePromptData.text}
          metadata={savePromptData.metadata}
        />
      )}

      {/* ── Delete Project Confirmation Modal ── */}
      {deleteConfirmProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" data-testid="delete-project-overlay">
          <div className="em-glass rounded-2xl p-6 w-[420px] border border-[rgba(255,80,80,0.20)]" data-testid="delete-project-modal">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[rgba(255,60,60,0.12)] border border-[rgba(255,60,60,0.25)] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold em-text-primary">Delete Project</h3>
                <p className="text-[11px] em-text-secondary mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            <div className="mb-5 p-3 rounded-xl bg-[rgba(255,60,60,0.06)] border border-[rgba(255,60,60,0.12)]">
              <p className="text-xs em-text-primary mb-1.5">
                You are about to permanently delete <span className="font-semibold text-red-400">&ldquo;{deleteConfirmProject.name}&rdquo;</span>.
              </p>
              <p className="text-[11px] em-text-secondary leading-relaxed">
                This will remove the project and all its conversations, messages, files, canvas, and generation history. This cannot be recovered.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmProject(null)}
                className="px-4 py-2 text-xs font-medium rounded-xl border border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.06)] em-text-primary transition-all"
                data-testid="delete-project-cancel-btn"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const projectToDelete = deleteConfirmProject
                  setDeleteConfirmProject(null)
                  await deleteProject(projectToDelete.id)
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all duration-200 shadow-[0_0_12px_rgba(255,60,60,0.15)]"
                data-testid="delete-project-confirm-btn"
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Media Bin hidden file input ── */}
      <input
        ref={mediaBinInputRef}
        type="file"
        multiple
        accept=".txt,.md,.json,.csv,.html,.css,.js,.jsx,.ts,.tsx,.py,.sql,.pdf,.png,.jpg,.jpeg,.webp,.svg"
        className="hidden"
        onChange={(e) => { handleMediaBinUpload(e.target.files); e.target.value = '' }}
        data-testid="media-bin-file-input"
      />

      {/* ── Import Modal (top-level so it works in all views) ── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="em-glass rounded-2xl p-6 w-[440px] border border-[rgba(255,255,255,0.15)]" data-testid="import-modal">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold em-text-primary flex items-center gap-2">
                <Upload className="w-4 h-4 text-[var(--em-cyan)]" />
                Import Project
              </h2>
              <button onClick={() => { setShowImportModal(false); setImportError(null); setShowGithubForm(false); setGithubPat(''); setGithubRepo(''); setGithubBranch('main') }} className="em-text-muted hover:text-[var(--em-text-primary)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {importError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs" data-testid="import-error">
                {importError}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleZipImport}
              data-testid="import-file-input"
            />

            <div className="space-y-3" data-testid="import-options">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importLoading}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[rgba(255,255,255,0.10)] hover:border-[rgba(255,255,255,0.22)] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200 text-left disabled:opacity-50"
                data-testid="import-zip"
              >
                <div className="w-10 h-10 rounded-lg bg-[rgba(0,229,255,0.08)] border border-[rgba(0,229,255,0.15)] flex items-center justify-center shrink-0">
                  {importLoading ? (
                    <div className="w-4 h-4 border-2 border-[var(--em-cyan)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <FolderArchive className="w-4 h-4 text-[var(--em-cyan)]" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium em-text-primary">{importLoading ? 'Importing...' : 'Import from Zip'}</div>
                  <div className="text-[11px] em-text-secondary mt-0.5">Upload a zipped project directory (.zip)</div>
                </div>
              </button>

              <button
                onClick={() => setShowGithubForm(!showGithubForm)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left ${
                  showGithubForm
                    ? 'border-[rgba(168,85,247,0.30)] bg-[rgba(168,85,247,0.06)]'
                    : 'border-[rgba(255,255,255,0.10)] hover:border-[rgba(168,85,247,0.25)] hover:bg-[rgba(255,255,255,0.06)]'
                }`}
                data-testid="import-repo"
              >
                <div className="w-10 h-10 rounded-lg bg-[rgba(168,85,247,0.10)] border border-[rgba(168,85,247,0.20)] flex items-center justify-center shrink-0">
                  <GitBranch className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <div className="text-sm font-medium em-text-primary">Import from GitHub</div>
                  <div className="text-[11px] em-text-secondary mt-0.5">Clone a repository using Personal Access Token</div>
                </div>
              </button>

              {showGithubForm && (
                <div className="p-4 rounded-xl border border-[rgba(168,85,247,0.15)] bg-[rgba(168,85,247,0.03)] space-y-3" data-testid="github-import-form">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider em-text-muted mb-1 block">Personal Access Token</label>
                    <input
                      type="password"
                      value={githubPat}
                      onChange={(e) => setGithubPat(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxx"
                      className="w-full px-3 py-2 rounded-lg text-xs em-text-primary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)] focus:border-[rgba(168,85,247,0.40)] focus:outline-none transition-colors placeholder:text-[var(--em-text-muted)]"
                      data-testid="github-pat-input"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider em-text-muted mb-1 block">Repository</label>
                    <input
                      type="text"
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      placeholder="owner/repo"
                      className="w-full px-3 py-2 rounded-lg text-xs em-text-primary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)] focus:border-[rgba(168,85,247,0.40)] focus:outline-none transition-colors placeholder:text-[var(--em-text-muted)]"
                      data-testid="github-repo-input"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider em-text-muted mb-1 block">Branch</label>
                    <input
                      type="text"
                      value={githubBranch}
                      onChange={(e) => setGithubBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 rounded-lg text-xs em-text-primary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)] focus:border-[rgba(168,85,247,0.40)] focus:outline-none transition-colors placeholder:text-[var(--em-text-muted)]"
                      data-testid="github-branch-input"
                    />
                  </div>
                  <button
                    onClick={handleGithubImport}
                    disabled={githubImportLoading || !githubPat.trim() || !githubRepo.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_12px_rgba(168,85,247,0.15)]"
                    data-testid="github-import-submit"
                  >
                    {githubImportLoading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <GitBranch className="w-3.5 h-3.5" />
                        Import Repository
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
