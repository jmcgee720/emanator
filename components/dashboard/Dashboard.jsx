'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useToast } from '@/hooks/use-toast'
import { streamMessage } from '@/lib/stream-client'
import TopBar from './TopBar'
import LeftPanel from './LeftPanel'
import RightPanel from './RightPanel'
import ProjectHub from './ProjectHub'
import GrowthPanel from './GrowthPanel'
import AdminPanel from './AdminPanel'
import SearchPanel from './SearchPanel'
import CanvasPanel from './CanvasPanel'
import InlineBrief from './InlineBrief'
import DesignPanel from './DesignPanel'
import VariationStudio from './VariationStudio'
import PromptLibrary from './PromptLibrary'
import { SavePromptDialog } from './PromptLibrary'
import BuilderMemory from './BuilderMemory'
import NewProjectModal from './NewProjectModal'
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

// Whimsical status phrases for the build log
const BUILD_LOG_PHRASES = {
  connecting: 'Warming up the engines...',
  classifying_intent: 'Reading your mind (almost)...',
  intent_classified: 'Got it — plotting the game plan...',
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
  generating: 'Generating your project...',
  proposing_plan: 'Creating the build plan...',
  analyzing: 'Analyzing codebase...',
  analysis_complete: 'Analysis complete, building...',
}

// Lightweight project thumbnail — uses initials/gradients instead of DB queries
// This prevents 80+ concurrent database requests on page load
const THUMBNAIL_COLORS = [
  ['#1a1a2e', '#16213e'], ['#0f3460', '#1a1a2e'], ['#162447', '#1f4068'],
  ['#1b262c', '#0f4c75'], ['#222831', '#393e46'], ['#2d3436', '#636e72'],
  ['#1e272e', '#485460'], ['#0a3d62', '#3c6382'], ['#0c2461', '#1e3799'],
]

function ProjectThumbnail({ projectId, projectName }) {
  const colorIndex = (projectId?.charCodeAt?.(0) || 0) % THUMBNAIL_COLORS.length
  const [bg1, bg2] = THUMBNAIL_COLORS[colorIndex]
  const initials = (projectName || 'P')
    .split(/[\s-_]+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')

  return (
    <div
      className="aspect-[4/3] border-b border-[rgba(255,255,255,0.06)] flex items-center justify-center"
      style={{ background: `linear-gradient(135deg, ${bg1}, ${bg2})` }}
    >
      <span className="text-lg font-semibold text-white/30 select-none">{initials || 'P'}</span>
    </div>
  )
}

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
  const [aiProvider, setAiProvider] = useState('openai')
  const [aiModel, setAiModel] = useState('gpt-4o')
  const [providerStatus, setProviderStatus] = useState({})
  const [scope, setScope] = useState('project')
  const [visualMode, setVisualMode] = useState('stock')
  const [selfEditTarget, setSelfEditTarget] = useState(null)

  const [streamingMessageId, setStreamingMessageId] = useState(null)
  const [streamingStatus, setStreamingStatus] = useState(null)
  const [pendingPlan, setPendingPlan] = useState(null)
  const [executingPlan, setExecutingPlan] = useState(false)
  const [pendingDiffs, setPendingDiffs] = useState([])
  const [applyingDiffs, setApplyingDiffs] = useState(false)
  const [diffMessageId, setDiffMessageId] = useState(null)
  const [diffPlanData, setDiffPlanData] = useState(null)
  const [imageGenProgress, setImageGenProgress] = useState(null)
  const [variationStudio, setVariationStudio] = useState({ open: false, sourceImage: null })
  const [projectAssets, setProjectAssets] = useState([])
  const [assetsRefreshKey, setAssetsRefreshKey] = useState(0)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [showBuilderMemory, setShowBuilderMemory] = useState(false)
  const [savePromptData, setSavePromptData] = useState(null)
  const [sandboxTestResult, setSandboxTestResult] = useState(null)
  const [sandboxTesting, setSandboxTesting] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [showPromoteConfirm, setShowPromoteConfirm] = useState(false)
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [sandboxDiff, setSandboxDiff] = useState(null)
  const [showSandboxDiff, setShowSandboxDiff] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)

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
            if (data.needs_credit_grant) {
              try {
                await authFetch('/api/credits/add', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ amount: data.credits }),
                })
                // Mark as granted so it's idempotent on retry
                await authFetch(`/api/stripe/confirm-credits/${sessionId}`, { method: 'POST' })
              } catch {}
            }
            toast({ title: 'Payment Successful', description: `+${data.credits} credits added to your account` })
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
  const [mediaBinFiles, setMediaBinFiles] = useState([])

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

  // ── Canvas aurora: activityLevel (0–1) — spikes on chat, decays when idle ──
  const [activityLevel, setActivityLevel] = useState(0)
  const activityDecayRef = useRef(null)

  useEffect(() => {
    if (streamingMessageId) {
      setActivityLevel(1)
      if (activityDecayRef.current) {
        clearInterval(activityDecayRef.current)
        activityDecayRef.current = null
      }
      return
    }
    // Start decay when streaming stops
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

  const streamAbortRef = useRef(null)
  const hubEntryRef = useRef(false)
  const importChatTitleRef = useRef(null)
  const pendingHeroPromptRef = useRef(null)
  const briefBuildActiveRef = useRef(false)
  const tabChatStateRef = useRef({})
  const pendingRestoreChatRef = useRef(null)
  const coreProjectIdRef = useRef(null)
  const { toast } = useToast()

  const [logs, setLogs] = useState([
    { type: 'info', message: 'Welcome to Emanator', timestamp: new Date().toISOString() },
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

  // Listen for Core System "Apply to Live" success → auto-continue
  // Ref to always have latest sendMessage available for event handlers
  const sendMessageRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      console.log('[Dashboard] core_apply_success event received', e.detail)

      // Extract the last AI message's enhancement suggestions
      const lastAiMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
      let suggestions = ''
      if (lastAiMsg?.content) {
        const match = lastAiMsg.content.match(/What could enhance this further:\n([\s\S]*?)(?:\n\n|\{\{|$)/)
        if (match) {
          suggestions = `\n\nThe suggestions from the last edit were:\n${match[1].trim()}\n\nImplement the first suggestion now.`
        }
      }

      const autoMsg = suggestions
        ? `Applied to live successfully.${suggestions}`
        : 'Applied to live. Continue improving the file — pick a meaningful enhancement and implement it now.'

      const tryAutoSend = (attempt = 0) => {
        if (attempt > 5) return
        const delay = 1000 + (attempt * 1000)
        setTimeout(() => {
          console.log(`[Dashboard] Auto-continue attempt ${attempt + 1}`)
          const fn = sendMessageRef.current
          if (fn) {
            try { fn(autoMsg) } catch { tryAutoSend(attempt + 1) }
          } else {
            tryAutoSend(attempt + 1)
          }
        }, delay)
      }
      tryAutoSend(0)
    }
    window.addEventListener('core_apply_success', handler)
    return () => window.removeEventListener('core_apply_success', handler)
  }, [messages])

  // Listen for inline "Apply to Live" button click from chat messages
  useEffect(() => {
    const handler = async () => {
      if (!selectedProject?.id) return
      console.log('[Dashboard] inline_apply_to_live event received')
      try {
        const res = await authFetch(`/api/projects/${selectedProject.id}/promote-to-live`, { method: 'POST' })
        const data = await res.json()
        if (res.ok && data.success) {
          setLivePromoteState({ snapshotId: data.snapshot_id, lastApply: { time: new Date().toISOString(), filesWritten: data.files_written } })
          toast({ title: 'Applied to Live', description: `${data.files_written} file(s) written to disk.` })
          // Auto-continue after a delay
          if (selectedProject?.settings?.is_core) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('core_apply_success', { detail: { projectId: selectedProject.id, filesWritten: data.files_written } }))
            }, 500)
          }
        } else {
          toast({ title: 'Apply Failed', description: data.error || 'Something went wrong.', variant: 'destructive' })
        }
      } catch (err) {
        toast({ title: 'Apply Failed', description: err.message, variant: 'destructive' })
      }
    }
    window.addEventListener('inline_apply_to_live', handler)
    return () => window.removeEventListener('inline_apply_to_live', handler)
  }, [selectedProject?.id, selectedChat?.id])



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
      // If it's a brief build with split messages, send display + instruction separately
      if (pending.fullInstruction) {
        console.log('[HeroPromptEffect] SENDING brief build, display:', pending.displayMessage?.length, 'instruction:', pending.fullInstruction?.length)
        sendMessage(pending.displayMessage, pending.attachments || null, { hiddenInstruction: pending.fullInstruction })
      } else {
        console.log('[HeroPromptEffect] SENDING prompt, length:', (typeof pending === 'string' ? pending : pending.displayMessage || '').length)
        sendMessage(typeof pending === 'string' ? pending : pending.displayMessage)
      }
    }
  }, [messagesReadyTick])

  const loadProjects = async () => {
    try {
      const response = await authFetch('/api/projects')
      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        console.error('[loadProjects] JSON parse failed, raw:', text.slice(0, 200))
        throw new Error('Failed to load projects')
      }
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load projects')
      }
      const projectList = Array.isArray(data) ? data : []
      setProjects(projectList)

      // Seed core project ID ref from loaded data
      const coreP = projectList.find(p => p.settings?.is_core === true)
      if (coreP) coreProjectIdRef.current = coreP.id

      if (selectedProject) {
        const refreshedSelected = projectList.find(p => p.id === selectedProject.id)
        if (refreshedSelected) {
          setSelectedProject(refreshedSelected)
        }
      }

      setOpenProjectTabs(prevTabs =>
        prevTabs
          .map(tab => projectList.find(p => p.id === tab.id) || tab)
          .filter(Boolean)
      )
    } catch (error) {
      console.error('Error loading projects:', error)
      addLog('error', `Failed to load projects: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const loadProjectData = async (projectId, skipChatSelect = false, chatTitle = 'New Conversation', restoreChatId = null) => {
    try {
      const chatsResponse = await authFetch(`/api/projects/${projectId}/chats`)
      const chatsText = await chatsResponse.text()
      let chatsData
      try { chatsData = JSON.parse(chatsText) } catch { chatsData = [] }
      const chatList = Array.isArray(chatsData) ? chatsData : []
      setChats(chatList)

      if (restoreChatId) {
        const restored = chatList.find(c => c.id === restoreChatId)
        if (restored) {
          setSelectedChat(restored)
        }
        // If the saved chat was deleted, stay on hub (skipChatSelect is true)
      } else if (!skipChatSelect) {
        if (chatList.length > 0) {
          setSelectedChat(chatList[0])
        } else {
          await autoCreateChat(projectId, chatTitle)
        }
      }
    } catch (error) {
      console.error('Error loading chats:', error)
      addLog('error', `Failed to load chats: ${error.message}`)
    }

    try {
      const filesResponse = await authFetch(`/api/projects/${projectId}/files`)
      const filesText = await filesResponse.text()
      let filesData
      try { filesData = JSON.parse(filesText) } catch { filesData = [] }
      setFiles(Array.isArray(filesData) ? filesData : [])
    } catch (error) {
      console.error('Error loading files:', error)
    }

    try {
      const indexRes = await authFetch(`/api/projects/${projectId}/files-index`)
      if (indexRes.ok) {
        const indexData = await indexRes.json()
        setProjectFileIndex(prev => ({ ...prev, [projectId]: indexData.files }))
      }
    } catch (err) {
      console.warn('[files-index] fetch failed:', err.message)
    }

    loadMediaBin(projectId)

    try {
      const canvasResponse = await authFetch(`/api/projects/${projectId}/canvas`)
      if (canvasResponse.ok) {
        const canvasData = await canvasResponse.json()
        const content = canvasData.canvas_content || null
        setCanvas(content)
      } else {
        console.warn('[canvas_fetch] failed:', canvasResponse.status)
        setCanvas(null)
      }
    } catch (error) {
      console.error('[canvas_fetch] exception:', error.message)
      setCanvas(null)
    }

    try {
      const designResponse = await authFetch(`/api/projects/${projectId}/design`)
      if (designResponse.ok) {
        const designData = await designResponse.json()
        setDesignPrefs(designData.design_prefs || getDefaultDesignPrefs())
      } else {
        setDesignPrefs(getDefaultDesignPrefs())
      }
    } catch {
      setDesignPrefs(getDefaultDesignPrefs())
    }
  }

  const autoCreateChat = async (projectId, title = 'New Conversation') => {
    try {
      const response = await authFetch(`/api/projects/${projectId}/chats`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title })
      })
      if (response.ok) {
        const text = await response.text()
        const newChat = JSON.parse(text)
        setChats([newChat])
        setSelectedChat(newChat)
        setMessages([])
        addLog('info', 'Created initial conversation')
      }
    } catch (error) {
      console.error('Error auto-creating chat:', error)
    }
  }

  const loadMessages = async (chatId) => {
    try {
      const response = await authFetch(`/api/chats/${chatId}/messages`)
      const text = await response.text()
      let data
      try { data = JSON.parse(text) } catch { data = [] }
      setMessages(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error loading messages:', error)
    }
    setMessagesReadyTick(t => t + 1)
  }

  const createProject = async (name, type = 'app', templateId = null) => {
    try {
      addLog('info', `Creating project: ${name}`)
      const body = { name, type }
      if (templateId) body.template_id = templateId
      // Pass the brief-derived chat title so the initial chat uses it instead of the project name
      if (importChatTitleRef.current) body.chat_title = importChatTitleRef.current
      const response = await authFetch('/api/projects', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body)
      })

      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch (parseErr) {
        console.error('[createProject] JSON parse failed, raw:', text.slice(0, 200))
        throw new Error('Server returned invalid response. Please try again.')
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create project')
      }

      const newProject = data.project || data
      const initialChat = data.initialChat || null

      setProjects(prev => [newProject, ...prev])
      openProjectWorkspace(newProject)

      if (initialChat) {
        setChats([initialChat])
        setSelectedChat(initialChat)
        setMessages([])
      }

      // If template was used, fetch the populated files from backend
      if (templateId) {
        try {
          const filesRes = await authFetch(`/api/projects/${newProject.id}/files`)
          if (filesRes.ok) {
            const filesData = await filesRes.json()
            setFiles(Array.isArray(filesData) ? filesData : [])
          } else {
            setFiles([])
          }
        } catch {
          setFiles([])
        }
      } else {
        setFiles([])
      }
      setCanvas(null)

      addLog('success', `Project "${name}" created${templateId ? ' from template' : ''}`)
      toast({ title: 'Project Created', description: `"${name}" is ready to go.` })

      return newProject
    } catch (error) {
      console.error('Error creating project:', error)
      addLog('error', `Failed to create project: ${error.message}`)
      toast({ title: 'Create Failed', description: error.message, variant: 'destructive' })
      throw error
    }
  }

  const createSandbox = async (projectId) => {
    try {
      addLog('info', 'Creating sandbox...')
      const response = await authFetch(`/api/projects/${projectId}/sandbox`, {
        method: 'POST',
        headers: JSON_HEADERS,
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to create sandbox')
      }
      const data = await response.json()
      const sandbox = data.project || data
      const initialChat = data.initialChat || null

      setProjects(prev => [sandbox, ...prev])
      openProjectWorkspace(sandbox)

      if (initialChat) {
        setChats([initialChat])
        setSelectedChat(initialChat)
        setMessages([])
      }

      setFiles([])
      setCanvas(null)

      addLog('success', `Sandbox created from project`)
      toast({ title: 'Sandbox Created', description: `"${sandbox.name}" is ready. Changes stay isolated.` })
      return sandbox
    } catch (error) {
      console.error('Error creating sandbox:', error)
      toast({ title: 'Sandbox Failed', description: error.message, variant: 'destructive' })
    }
  }

  const testBeforeApply = async () => {
    if (!selectedProject?.settings?.is_sandbox || sandboxTesting) return
    setSandboxTesting(true)
    addLog('info', 'Running test-before-apply validation...')
    try {
      const diffs = pendingDiffs.map(f => ({
        path: f.path || f.filename,
        content: f.content || f.newContent || '',
      }))
      const response = await authFetch(`/api/projects/${selectedProject.id}/test-before-apply`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ diffs }),
      })
      const result = await response.json()
      setSandboxTestResult(result)
      setSelectedProject(prev => ({
        ...prev,
        settings: { ...prev.settings, last_test_result: result }
      }))
      if (result.passed) {
        addLog('success', `Validation passed — ${result.files_tested} file(s) checked`)
        toast({ title: 'Test Passed', description: `${result.files_tested} file(s) validated successfully` })
      } else {
        addLog('error', `Validation failed — ${result.errors.length} error(s)`)
        toast({ title: 'Test Failed', description: `${result.errors.length} error(s) found`, variant: 'destructive' })
      }
    } catch (error) {
      addLog('error', `Test failed: ${error.message}`)
      toast({ title: 'Test Error', description: error.message, variant: 'destructive' })
    } finally {
      setSandboxTesting(false)
    }
  }

  const promoteSandbox = async () => {
    if (!selectedProject?.settings?.is_sandbox || promoting) return
    setPromoting(true)
    addLog('info', 'Promoting sandbox to primary...')
    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/promote`, {
        method: 'POST',
        headers: JSON_HEADERS,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Promotion failed')

      setSelectedProject(prev => ({
        ...prev,
        settings: { ...prev.settings, sandbox_status: 'promoted', promoted_at: result.promoted_at }
      }))
      setShowPromoteConfirm(false)
      addLog('success', `Promoted ${result.files_promoted} file(s) to primary workspace`)
      toast({ title: 'Promoted to Primary', description: `${result.files_promoted} file(s) applied to the primary workspace.` })
    } catch (error) {
      addLog('error', `Promotion failed: ${error.message}`)
      toast({ title: 'Promotion Failed', description: error.message, variant: 'destructive' })
    } finally {
      setPromoting(false)
    }
  }

  const loadSandboxDiff = async () => {
    if (!selectedProject?.settings?.is_sandbox || loadingDiff) return
    setLoadingDiff(true)
    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/sandbox-diff`)
      if (!response.ok) throw new Error((await response.json()).error || 'Failed')
      const data = await response.json()
      setSandboxDiff(data)
      setShowSandboxDiff(true)
    } catch (error) {
      toast({ title: 'Diff Failed', description: error.message, variant: 'destructive' })
    } finally {
      setLoadingDiff(false)
    }
  }

  const rollbackSandbox = async () => {
    if (!selectedProject?.settings?.is_sandbox || rollingBack) return
    setRollingBack(true)
    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/rollback`, {
        method: 'POST',
        headers: JSON_HEADERS,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Rollback failed')

      setSelectedProject(prev => ({
        ...prev,
        settings: { ...prev.settings, sandbox_status: 'rolled_back', rolled_back_at: result.rolled_back_at }
      }))
      setShowRollbackConfirm(false)
      addLog('success', `Rolled back: restored ${result.files_restored} file(s)`)
      toast({ title: 'Rollback Complete', description: `Primary workspace restored. ${result.files_restored} file(s) recovered.` })
    } catch (error) {
      addLog('error', `Rollback failed: ${error.message}`)
      toast({ title: 'Rollback Failed', description: error.message, variant: 'destructive' })
    } finally {
      setRollingBack(false)
    }
  }

  const createChat = async (title = 'New Chat') => {
    if (!selectedProject) return

    const isSelfEditTitle = title.startsWith('\u2699 Self-Edit: ')
    if (isSelfEditTitle && !isOwner) {
      toast({ title: 'Error', description: 'Only owners can create Core System chats', variant: 'destructive' })
      return
    }

    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/chats`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title })
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create chat')
      }

      const text = await response.text()
      let newChat
      try {
        newChat = JSON.parse(text)
      } catch {
        throw new Error('Server returned invalid response')
      }
      setChats(prev => [newChat, ...prev])
      setSelectedChat(newChat)
      setMessages([])
      addLog('info', 'New conversation started')
    } catch (error) {
      console.error('Error creating chat:', error)
      addLog('error', `Failed to create chat: ${error.message}`)
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    }
  }

  const createSelfEditChat = async (description = 'Internal Improvement') => {
    if (!selectedProject || !isOwner) return
    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/chats`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: selfEditTitle(description), is_self_edit: true })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        toast({ title: 'Error', description: err.error || 'Failed to create Core System chat', variant: 'destructive' })
        return
      }
      const text = await response.text()
      let newChat
      try {
        newChat = JSON.parse(text)
      } catch {
        toast({ title: 'Error', description: 'Server returned invalid response', variant: 'destructive' })
        return
      }
      setChats(prev => [newChat, ...prev])
      setSelectedChat(newChat)
      setSelfEditTarget(null)
    } catch {
      toast({ title: 'Error', description: 'Failed to create Core System chat', variant: 'destructive' })
    }
  }

  const uploadFiles = async (files) => {
    if (!selectedProject) return null
    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, chatId: selectedChat?.id }),
      })
      const result = await response.json()
      if (result.uploads) {
        const successes = result.uploads.filter(u => u.success)
        const errors = result.uploads.filter(u => u.error)
        if (successes.length > 0) addLog('success', `Uploaded ${successes.length} file(s)`)
        if (errors.length > 0) {
          for (const e of errors) addLog('error', `Upload failed: ${e.filename} — ${e.error}`)
        }
      }
      return result
    } catch (err) {
      addLog('error', `Upload error: ${err.message}`)
      return null
    }
  }

  // Keep ref updated for event handlers that need latest sendMessage
  // (assigned after sendMessage definition below)

  const sendMessage = async (content, attachments, opts = {}) => {
    if (!selectedChat) { console.log('[sendMessage] blocked: no selectedChat'); return }
    if (!opts.silent && !(content || '').trim()) return
    if (streamingMessageId) { console.log('[sendMessage] blocked: streamingMessageId still set:', streamingMessageId); return }

    setActivityLevel(1)
    streamAbortRef.current?.abort()

    const streamingAssistantId = `streaming-${Date.now()}`
    const collectedDiffs = []
    const tempUserId = `temp-${Date.now()}`

    // Silent messages skip the user bubble entirely — only the AI response appears
    if (!opts.silent) {
      const tempUserMessage = {
        id: tempUserId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        metadata: attachments ? { attachments } : undefined
      }
      setMessages(prev => [...prev, tempUserMessage])
    }

    const clientMessageKey = `cmk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const placeholderAssistant = {
      id: streamingAssistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      created_at: new Date().toISOString(),
      clientMessageKey,
    }
    setMessages(prev => [...prev, placeholderAssistant])
    setStreamingMessageId(streamingAssistantId)
    setStreamingStatus({ stage: 'connecting', detail: 'Connecting...' })
    setBuildLog([])
    setBuildMilestones([])
    setGeneratedImageMap([]) // Clear stale image mapping from previous builds

    // If there's a hidden instruction (from creative brief), send that to the AI instead of the display message
    const aiContent = opts.hiddenInstruction || content

    const isSelfEditChat = selectedChat && getChatType(selectedChat) === CHAT_TYPES.SELF_EDIT
    const streamOpts = { provider: aiProvider, model: aiModel, scope, designPrefs, attachments, visualMode }
    if (opts.hiddenInstruction) {
      streamOpts.displayContent = content // Save this as the visible user message
    }
    if (isSelfEditChat) {
      streamOpts.selfEditTarget = selfEditTarget || { id: 'all', path: null }
    }

    const abortController = streamMessage(
      selectedChat.id,
      aiContent,
      streamOpts,
      {
        onUserMessage: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === tempUserId ? { ...m, id: data.id, created_at: data.created_at } : m
          ))
        },

        onStatus: (data) => {
          setStreamingStatus(data)
          addLog('info', `[${data.stage}] ${data.detail}`)
          // Add whimsical phrase to persistent build log
          const phrase = BUILD_LOG_PHRASES[data.stage]
          if (phrase) addBuildLogEntry(phrase)
          else if (data.detail && !data.detail.includes('Using ')) addBuildLogEntry(data.detail)
        },

        onToken: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: m.content + data.content }
              : m
          ))
        },

        onFile: (data) => {
          addLog('success', `${data.action === 'created' ? 'Created' : 'Updated'}: ${data.path}`)
          const cleanName = data.path?.replace(/^src\/(components|pages)\//, '').replace(/\.(jsx|tsx|js|ts|css)$/, '') || data.path
          addMilestone(`${data.action === 'created' ? 'Built' : 'Updated'} ${cleanName}`)
          addBuildLogEntry(`${data.action === 'created' ? 'Built' : 'Refined'} ${cleanName}`)
        },

        onDiffFile: (data) => {
          collectedDiffs.push(data)
          addLog('info', `Diff ready: ${data.action} ${data.path}`)
        },

        onPreviewPartial: (data) => {
          // Buffer partials and drain progressively for visible incremental updates
          if (!data?.path || !data?.content) return
          previewQueueRef.current.push(data)
          if (!isSelfEditChat) setActiveTab('preview')
          // Start draining if not already
          if (!previewDrainTimerRef.current) {
            // Show first partial immediately
            setLivePreviewData(previewQueueRef.current.shift())
            previewDrainTimerRef.current = setInterval(() => {
              if (previewQueueRef.current.length > 0) {
                setLivePreviewData(previewQueueRef.current.shift())
              } else {
                clearInterval(previewDrainTimerRef.current)
                previewDrainTimerRef.current = null
              }
            }, 200)
          }
        },

        onImageGenerated: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, metadata: { ...m.metadata, generatedImage: data } }
              : m
          ))
          addLog('success', `Image generated: ${data.filename} (${data.mode})`)
        },

        onCreativeBrief: () => {
          // Design context is used internally by the AI — not shown in chat
        },

        onGeneratedImagesMap: (data) => {
          if (data?.images?.length > 0) {
            setGeneratedImageMap(data.images)
            addLog('info', `Mapped ${data.images.length} generated image(s) for preview`)
          }
        },

        onImageIntent: async (data) => {
          // ── HARD GUARD: Block image generation for BUILD / plan_patch requests ──
          const isBuildIntent = /\bINTENT:\s*BUILD\b/i.test(data.prompt || '')
          if (isBuildIntent) {
            console.warn('[Dashboard] Image generation blocked — INTENT: BUILD detected in prompt')
            return
          }

          // clientMessageKey is closed over from outer scope — stable identity that survives id swap
          addLog('info', `Generating ${data.mode} image... (this may take 30-60s)`)
          setImageGenProgress({ stage: 'preparing', progress: 5, label: 'Preparing request', mode: data.mode, startTime: Date.now() })
          setStreamingStatus({ stage: 'generating_image', detail: `Generating ${data.mode} with OpenAI...` })

          try {
            const res = await authFetch(`/api/projects/${data.projectId}/generate-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: data.prompt,
                mode: data.mode,
                spriteOpts: data.spriteOpts,
                size: data.size || '1024x1024',
                chatId: data.chatId,
                variation: data.variation || undefined,
              }),
            })

            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err.error || 'Image generation failed')
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
                      const progressUpdate = {
                        stage: eventData.stage,
                        progress: eventData.progress,
                        label: eventData.label,
                      }
                      setImageGenProgress(prev => ({ ...prev, ...progressUpdate }))
                      // Persist progress to message metadata for stable rendering
                      setMessages(prev => prev.map(m => 
                        m.clientMessageKey === clientMessageKey 
                          ? { ...m, metadata: { ...m.metadata, imageGenProgress: progressUpdate } }
                          : m
                      ))
                    } else if (currentEvent === 'image_complete') {
                      asset = eventData.asset
                      setImageGenProgress(prev => ({ ...prev, stage: 'rendering', progress: 100, label: 'Rendering preview' }))
                    } else if (currentEvent === 'image_error') {
                      throw new Error(eventData.error || 'Image generation failed')
                    }
                  } catch (parseErr) {
                    if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr
                  }
                  currentEvent = null
                }
              }
            }

            if (!asset) throw new Error('No image asset received from server')

            const genImage = {
              id: asset.id,
              path: asset.path,
              filename: asset.filename,
              prompt: asset.prompt,
              mode: asset.mode,
              size: asset.size,
              revisedPrompt: asset.revisedPrompt,
              duration: asset.duration,
              projectId: data.projectId,
              variationType: asset.variationType,
              sourceAssetPath: asset.sourceAssetPath,
              stateName: asset.stateName,
              characterName: asset.characterName,
            }

            const content = `## Image Generated\n\n**Prompt:** ${data.prompt.slice(0, 200)}\n**Mode:** ${asset.mode}\n**Size:** ${asset.size}\n**File:** \`${asset.path}\`\n${asset.revisedPrompt ? `**Revised prompt:** ${asset.revisedPrompt}\n` : ''}\n*Generated in ${(asset.duration / 1000).toFixed(1)}s*`

            try {
              const { recordGenerationDuration } = await import('./ImageGenerationProgress')
              recordGenerationDuration(asset.duration)
            } catch {}

            let realMsgId = null
            setMessages(prev => {
              const updated = prev.map(m => {
                if (m.clientMessageKey === clientMessageKey) {
                  realMsgId = m.id
                  // Clear imageGenProgress when attaching generatedImage
                  const { imageGenProgress: _, ...restMetadata } = m.metadata || {}
                  return { ...m, content, streaming: false, metadata: { ...restMetadata, generatedImage: genImage } }
                }
                return m
              })
              if (!realMsgId) {
                // Fallback for variation studio where toolMode is set
                return prev.map(m => {
                  if (!realMsgId && m.role === 'assistant' && m.metadata?.toolMode === 'image_gen' && !m.metadata?.generatedImage) {
                    realMsgId = m.id
                    const { imageGenProgress: _, ...restMetadata } = m.metadata || {}
                    return { ...m, content, streaming: false, metadata: { ...restMetadata, generatedImage: genImage } }
                  }
                  return m
                })
              }
              return updated
            })

            addLog('success', `Image generated: ${asset.filename} (${asset.mode}) in ${(asset.duration / 1000).toFixed(1)}s`)
            setImageGenProgress(null)
            setStreamingStatus(null)
            setStreamingMessageId(null)

            try {
              const filesRes = await authFetch(`/api/projects/${data.projectId}/files`)
              if (filesRes.ok) {
                const filesData = await filesRes.json()
                setFiles(filesData)
              }
            } catch {}

            setAssetsRefreshKey(k => k + 1)

            if (realMsgId && !realMsgId.startsWith('streaming-')) {
              try {
                await authFetch(`/api/messages/${realMsgId}/metadata`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ generatedImage: genImage }),
                })
              } catch {}
            }

          } catch (err) {
            console.error('[Dashboard] Image generation error:', err)
            setImageGenProgress({ stage: 'error', progress: 0, error: err.message, mode: data.mode })
            setMessages(prev => prev.map(m =>
              (m.clientMessageKey === clientMessageKey || (m.role === 'assistant' && m.metadata?.toolMode === 'image_gen' && !m.metadata?.generatedImage))
                ? { ...m, content: `Image generation failed: ${err.message}\n\nPlease try again.`, streaming: false }
                : m
            ))
            addLog('error', `Image generation failed: ${err.message}`)
            setStreamingStatus(null)
            setStreamingMessageId(null)
          }
        },

        onDone: (data) => {
          const hasDiffs = (data?.diffFiles?.length > 0) || (collectedDiffs.length > 0)
          setStreamingStatus({
            stage: hasDiffs ? 'diff_ready' : 'complete',
            detail: data.proposedPlan ? 'Plan proposed — awaiting approval' : hasDiffs ? `${(data?.diffFiles || collectedDiffs).length} file(s) ready for review` : 'Generation complete'
          })

          if (hasDiffs) {
            const diffs = data?.diffFiles || collectedDiffs
            setPendingDiffs(diffs)
            addLog('info', `${diffs.length} file diff(s) ready for review`)
          }

          const meta = data || {}
          if (meta.provider) {
            const parts = [`${meta.provider}/${meta.model}`]
            if (meta.scope && meta.scope !== 'project') parts.push(`scope: ${meta.scope}`)
            if (meta.intent && meta.intent !== 'chat') parts.push(`intent: ${meta.intent}`)
            if (meta.fsStats) parts.push(`files scanned: ${meta.fsStats.scanned}, matched: ${meta.fsStats.matched}`)
            addLog('info', `Response via ${parts.join(' | ')}`)
          }

          if (meta.files?.length > 0) {
            addLog('success', `Generated ${meta.files.length} file(s)`)
          }

          if (meta.proposedPlan) {
            addLog('info', 'Plan proposed — waiting for user approval')
          }
        },

        onPlan: (data) => {
          setPendingPlan(data)
        },

        onMessageSaved: async (data) => {
          const updatedMeta = { intent: data.intent, scope: data.scope }
          if (data.tool_mode) updatedMeta.toolMode = data.tool_mode
          if (data.proposedPlan) {
            updatedMeta.proposedPlan = data.proposedPlan
            updatedMeta.planStatus = 'proposed'
          }
          if (data.planExecuted) {
            updatedMeta.planExecuted = true
          }
          const diffs = data.diffFiles || (collectedDiffs.length > 0 ? collectedDiffs : null)
          if (diffs?.length > 0) {
            updatedMeta.diffFiles = diffs
            updatedMeta.diffStatus = data.diffStatus || 'pending'
            setDiffMessageId(data.id)
          }

          setMessages(prev => prev.map(m => {
            if (m.id !== streamingAssistantId) return m
            const existingImage = m.metadata?.generatedImage
            return {
              ...m,
              id: data.id,
              content: data.contentOverride || m.content,
              streaming: false,
              clientMessageKey: m.clientMessageKey,  // Preserve stable identity across id swap
              metadata: { ...updatedMeta, generatedImage: existingImage || null }
            }
          }))
          setStreamingMessageId(null)
          setStreamingStatus(null)

          if ((data.generatedFiles?.length > 0 || data.directEditMode) && !diffs?.length) {
            // Flush remaining preview queue and clear drain timer
            if (previewDrainTimerRef.current) {
              clearInterval(previewDrainTimerRef.current)
              previewDrainTimerRef.current = null
            }
            // Show the last queued partial before clearing
            if (previewQueueRef.current.length > 0) {
              setLivePreviewData(previewQueueRef.current[previewQueueRef.current.length - 1])
              previewQueueRef.current = []
            }
            // Small delay to let the last partial render, then load final files
            await new Promise(r => setTimeout(r, 300))
            setLivePreviewData(null)  // Clear streaming preview — final files coming
            const filesResponse = await authFetch(`/api/projects/${selectedProject.id}/files`)
            const filesData = await filesResponse.json()
            setFiles(Array.isArray(filesData) ? filesData : [])
            setActiveTab(isSelfEditChat ? 'code' : 'preview')
          }

          const refreshCanvas = async (retries = 2) => {
            for (let i = 0; i <= retries; i++) {
              try {
                if (i > 0) await new Promise(r => setTimeout(r, 500 * i))
                const res = await authFetch(`/api/projects/${selectedProject.id}/canvas`)
                if (res.ok) {
                  const d = await res.json()
                  if (d.canvas_content) {
                    setCanvas(d.canvas_content)
                    return
                  }
                }
              } catch {}
            }
          }
          await refreshCanvas()

          // PM auto-continue disabled — was causing cascading multi-stream failures
          if (briefBuildActiveRef.current) {
            briefBuildActiveRef.current = false
          }
        },

        onError: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? {
                  ...m,
                  content: m.content || data.message,
                  streaming: false,
                  metadata: {
                    providerError: true,
                    error_type: data.error_type,
                    provider: data.provider,
                    partial: data.partial
                  }
                }
              : m
          ))
          setStreamingMessageId(null)
          setStreamingStatus(null)
          addLog('error', `Error: ${data.message}`)

          if (!data.partial) {
            toast({ title: 'Generation Issue', description: data.message, variant: 'destructive' })
          }
        },

        // ── Platform billing events ──
        onCreditsExhausted: (data) => {
          // The upsell message is already streamed as tokens — just update balance
          setCreditsBalance(data.balance)
          setStreamingMessageId(null)
          setStreamingStatus(null)
        },
        onCreditsUpdate: (data) => {
          setCreditsBalance(data.balance)
        },
        onFallbackNotice: (data) => {
          toast({ title: 'Model Fallback', description: `Used ${data.model} for this request.` })
        },
        onRuntimeTests: (data) => {
          setRuntimeTestScript(data.script)
        },
        onCanvasUpdate: (data) => {
          window.dispatchEvent(new CustomEvent('canvas_update', { detail: data }))
          setCanvas(data.content)
        }
      }
    )

    streamAbortRef.current = abortController
  }

  // Keep ref updated so event handlers always have latest sendMessage
  sendMessageRef.current = sendMessage

  const executePlan = async (messageId, planData) => {
    if (!selectedChat || executingPlan) return

    setExecutingPlan(true)
    setPendingDiffs([])
    setDiffMessageId(null)
    setDiffPlanData(planData)
    addLog('info', 'Generating file changes for review...')

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, metadata: { ...m.metadata, planStatus: 'executing' } }
        : m
    ))

    const streamingAssistantId = `streaming-exec-${Date.now()}`
    const collectedDiffs = []

    const placeholderAssistant = {
      id: streamingAssistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      created_at: new Date().toISOString()
    }
    setMessages(prev => [...prev, placeholderAssistant])
    setStreamingMessageId(streamingAssistantId)
    setStreamingStatus({ stage: 'executing_plan', detail: 'Generating diffs...' })

    streamAbortRef.current?.abort()

    const abortController = streamMessage(
      selectedChat.id,
      `Execute the approved plan: ${planData.summary}`,
      { provider: aiProvider, model: aiModel, scope, designPrefs, executePlan: planData },
      {
        onUserMessage: () => {},
        onStatus: (data) => {
          setStreamingStatus(data)
          addLog('info', `[${data.stage}] ${data.detail}`)
        },
        onToken: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: m.content + data.content }
              : m
          ))
        },
        onFile: () => {},
        onDiffFile: (data) => {
          collectedDiffs.push(data)
          addLog('info', `Diff ready: ${data.action} ${data.path}`)
        },
        onDone: (data) => {
          const diffs = data?.diffFiles || collectedDiffs
          if (diffs.length > 0) {
            setPendingDiffs(diffs)
            setStreamingStatus({ stage: 'diff_ready', detail: `${diffs.length} file(s) ready for review` })
            addLog('info', `${diffs.length} file diff(s) ready for review`)
          } else {
            setStreamingStatus({ stage: 'complete', detail: 'No file changes generated' })
          }
        },
        onPlan: () => {},
        onMessageSaved: async (data) => {
          const diffs = data.diffFiles || collectedDiffs
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? {
                  ...m,
                  id: data.id,
                  streaming: false,
                  metadata: {
                    intent: data.intent,
                    diffFiles: diffs,
                    diffStatus: diffs.length > 0 ? 'pending' : 'none',
                    planData: data.planData || planData,
                  }
                }
              : m
          ))

          setDiffMessageId(data.id)
          setStreamingMessageId(null)
          setStreamingStatus(null)
          setExecutingPlan(false)

          if (diffs.length > 0) {
            setMessages(prev => prev.map(m =>
              m.id === messageId
                ? { ...m, metadata: { ...m.metadata, planStatus: 'diff_review' } }
                : m
            ))
          }
        },
        onError: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, content: m.content || data.message, streaming: false, metadata: { providerError: true, error_type: data.error_type } }
              : m
          ))
          setStreamingMessageId(null)
          setStreamingStatus(null)
          setExecutingPlan(false)
          addLog('error', `Diff generation failed: ${data.message}`)
          toast({ title: 'Generation Issue', description: data.message, variant: 'destructive' })
        },
        onCreditsExhausted: (data) => {
          setCreditsBalance(data.balance)
          setStreamingMessageId(null)
          setStreamingStatus(null)
          setExecutingPlan(false)
        },
        onCreditsUpdate: (data) => {
          setCreditsBalance(data.balance)
        },
        onFallbackNotice: (data) => {
          toast({ title: 'Model Fallback', description: `Used ${data.model} for this request.` })
        },
        onRuntimeTests: (data) => {
          setRuntimeTestScript(data.script)
        },
        onCanvasUpdate: (data) => {
          window.dispatchEvent(new CustomEvent('canvas_update', { detail: data }))
          setCanvas(data.content)
        }
      }
    )

    streamAbortRef.current = abortController
  }

      const applyDiffs = async (approvedFiles) => {
    if (!selectedProject || !selectedChat || applyingDiffs) return

    setApplyingDiffs(true)
    addLog('info', `Applying ${approvedFiles.length} approved file(s)...`)

    try {
      let serverPendingMsg = null

      for (let i = 0; i < 10; i++) {
        const messagesRes = await authFetch(`/api/chats/${selectedChat.id}/messages`)
        const messagesData = await messagesRes.json()

        if (Array.isArray(messagesData)) {
          serverPendingMsg = [...messagesData].reverse().find(
            m =>
              m.role === 'assistant' &&
              m.metadata?.diffStatus === 'pending' &&
              m.metadata?.diffFiles?.length > 0
          )
        }

        if (serverPendingMsg) break
        await new Promise(r => setTimeout(r, 800))
      }

      if (!serverPendingMsg) {
        addLog('error', 'Apply blocked: pending diff message not yet saved on server')
        toast({
          title: 'Apply Not Ready',
          description: 'The diff is still being saved. Wait 2–3 seconds, then click Apply All again.',
          variant: 'destructive'
        })
        return
      }

      const planId = serverPendingMsg?.metadata?.planId || null
      const diffId = serverPendingMsg?.metadata?.diffId || null

      const response = await authFetch(`/api/projects/${selectedProject.id}/apply-diffs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedFiles,
          planData: diffPlanData,
          chatId: selectedChat.id,
          planId,
          diffId,
          provider: aiProvider,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setMessages(prev =>
          prev.map(m =>
            m.id === serverPendingMsg.id
              ? { ...m, metadata: { ...m.metadata, diffStatus: 'applied' } }
              : m
          )
        )

        if (result.snapshot) {
          addLog('info', `Snapshot created: ${result.snapshot.name}`)
        }

        addLog(
          'success',
          `Applied ${result.written.length} file(s)${
            result.deleted.length > 0 ? `, deleted ${result.deleted.length}` : ''
          }`
        )

        if (result.errors.length > 0) {
          for (const err of result.errors) {
            addLog('error', typeof err === 'string' ? err : `${err.path} — ${err.error}`)
          }
        }

        const filesResponse = await authFetch(`/api/projects/${selectedProject.id}/files`)
        const filesData = await filesResponse.json()
        setFiles(Array.isArray(filesData) ? filesData : [])
        setActiveTab(selectedChat && getChatType(selectedChat) === CHAT_TYPES.SELF_EDIT ? 'code' : 'preview')

        try {
          const res = await authFetch(`/api/projects/${selectedProject.id}/canvas`)
          if (res.ok) {
            const d = await res.json()
            if (d.canvas_content) setCanvas(d.canvas_content)
          }
        } catch {}

        toast({
          title: 'Changes Applied',
          description: `${result.written.length} file(s) written. Snapshot saved.`
        })

        setPendingDiffs([])
        setDiffMessageId(null)
        setDiffPlanData(null)
        setPendingPlan(null)

        // Auto-continuation: if server returned a next step, send it after a short delay
        if (result.continuation?.nextStep) {
          const { nextStep, remainingSteps, originalTask } = result.continuation
          addLog('info', `Continuing: ${nextStep}`)
          toast({
            title: 'Continuing to next step...',
            description: nextStep.length > 80 ? nextStep.slice(0, 80) + '...' : nextStep,
          })
          setTimeout(() => {
            sendMessage(`Continue the task: ${originalTask}\n\nNext step: ${nextStep}`, { scope: 'project' })
          }, 1500)
        }
      } else {
        addLog('error', `Apply failed: ${result.error}`)
        toast({ title: 'Apply Failed', description: result.error, variant: 'destructive' })
      }
    } catch (err) {
      addLog('error', `Apply error: ${err.message}`)
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
      } finally {
    setApplyingDiffs(false)
  }
}
  const cancelDiffs = (messageId) => {
    if (messageId || diffMessageId) {
      setMessages(prev => prev.map(m =>
        m.id === (messageId || diffMessageId)
          ? { ...m, metadata: { ...m.metadata, diffStatus: 'cancelled' } }
          : m
      ))
    }
    setPendingDiffs([])
    setDiffMessageId(null)
    setDiffPlanData(null)
    addLog('info', 'Changes discarded — no files were written')
    toast({ title: 'Changes Discarded', description: 'No files were modified.' })
  }

  const cancelPlan = (messageId) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, metadata: { ...m.metadata, planStatus: 'cancelled' } }
        : m
    ))
    setPendingPlan(null)
    addLog('info', 'Plan cancelled')
    toast({ title: 'Plan Cancelled', description: 'No files were changed.' })
  }

  const retryWithFallback = async (errorMessage) => {
    const idx = messages.findIndex(m => m.id === errorMessage.id)
    const prevUser = idx > 0
      ? messages.slice(0, idx).reverse().find(m => m.role === 'user')
      : null

    if (!prevUser) {
      toast({ title: 'Nothing to retry', description: 'Could not find the original message.', variant: 'destructive' })
      return
    }

    const failedProvider = errorMessage.metadata?.provider
    const fallbackProvider = failedProvider === 'openai' ? 'anthropic' : 'openai'
    const fallbackModel = fallbackProvider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6'

    setAiProvider(fallbackProvider)
    setAiModel(fallbackModel)

    addLog('info', `Retrying with ${fallbackProvider}/${fallbackModel}...`)
    await sendMessage(prevUser.content)
  }

  const forkChat = async (chatId) => {
    try {
      const response = await authFetch(`/api/chats/${chatId}/fork`, { method: 'POST' })
      if (!response.ok) throw new Error('Failed to fork chat')
      const text = await response.text()
      const data = JSON.parse(text)
      const newChat = { id: data.id, title: data.title, project_id: data.project_id, chat_type: getChatType({ title: data.title }) }
      setChats(prev => [newChat, ...prev])
      setSelectedChat(newChat)
      // Load messages for the new chat so it's ready to use
      try {
        const msgRes = await authFetch(`/api/chats/${data.id}/messages`)
        if (msgRes.ok) {
          const msgData = await msgRes.json()
          setMessages(msgData)
        } else {
          setMessages([])
        }
      } catch { setMessages([]) }
      toast({ title: 'New chat ready', description: data.title })
    } catch (error) {
      console.error('Error forking chat:', error)
      toast({ title: 'Error', description: 'Failed to fork conversation', variant: 'destructive' })
    }
  }

  const deleteChat = async (chatId) => {
    try {
      await authFetch(`/api/chats/${chatId}`, { method: 'DELETE' })
      const remaining = chats.filter(c => c.id !== chatId)
      setChats(remaining)
      if (selectedChat?.id === chatId) {
        if (remaining.length > 0) {
          setSelectedChat(remaining[0])
        } else {
          setSelectedChat(null)
          setMessages([])
        }
      }
    } catch (error) {
      console.error('Error deleting chat:', error)
      toast({ title: 'Error', description: 'Failed to delete conversation', variant: 'destructive' })
    }
  }

  const renameChat = async (chatId, newTitle) => {
    try {
      const response = await authFetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || `Rename failed (${response.status})`)
      }
      const data = await response.json()
      const saved = data.chat || { title: newTitle }
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, ...saved } : c))
      if (selectedChat?.id === chatId) {
        setSelectedChat(prev => ({ ...prev, ...saved }))
      }
    } catch (error) {
      console.error('Error renaming chat:', error)
      toast({ title: 'Error', description: error.message || 'Failed to rename conversation', variant: 'destructive' })
      throw error
    }
  }

  const renameProject = async (projectId, newName) => {
    try {
      const response = await authFetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || `Rename failed (${response.status})`)
      }
      const data = await response.json()
      const saved = data.project || { name: newName }
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...saved } : p))
      setOpenProjectTabs(prev => prev.map(t => t.id === projectId ? { ...t, ...saved } : t))
      if (selectedProject?.id === projectId) {
        setSelectedProject(prev => ({ ...prev, ...saved }))
      }
    } catch (error) {
      console.error('Error renaming project:', error)
      toast({ title: 'Error', description: error.message || 'Failed to rename project', variant: 'destructive' })
      throw error
    }
  }

  const loadMediaBin = async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/attachments`)
      if (res.ok) {
        const data = await res.json()
        const items = Array.isArray(data) ? data : []
        // Fetch preview data for image files in parallel
        const withPreviews = await Promise.all(items.map(async (f) => {
          if (f.file_type === 'image') {
            try {
              const r = await authFetch(`/api/projects/${projectId}/attachment-content?path=${encodeURIComponent(f.path)}`)
              if (r.ok) {
                const d = await r.json()
                return { ...f, preview_data: d.content }
              }
            } catch {}
          }
          return f
        }))
        setMediaBinFiles(withPreviews)
      }
    } catch (error) {
      console.error('Error loading media bin:', error)
    }
  }

  const handleMediaBinUpload = async (fileList) => {
    if (!selectedProject || !fileList?.length) return
    const toUpload = []
    for (const file of fileList) {
      const reader = new FileReader()
      const result = await new Promise((resolve) => {
        reader.onload = (e) => resolve(e.target.result)
        if (file.type.startsWith('text/') || /\.(txt|md|json|csv|html|css|js|jsx|ts|tsx|py|sql)$/i.test(file.name)) {
          reader.readAsText(file)
        } else {
          reader.readAsDataURL(file)
        }
      })
      const isText = file.type.startsWith('text/') || /\.(txt|md|json|csv|html|css|js|jsx|ts|tsx|py|sql)$/i.test(file.name)
      toUpload.push({
        filename: file.name,
        mime_type: file.type,
        ...(isText ? { content: result } : { data: result })
      })
    }
    const res = await uploadFiles(toUpload)
    if (res?.uploads) {
      const successes = res.uploads.filter(u => u.success)
      if (successes.length > 0) {
        toast({ title: 'Uploaded', description: `${successes.length} file(s) added to Media Bin` })
        // Append new uploads to mediaBinFiles with preview data intact
        const newItems = successes.map(u => ({
          id: u.id,
          filename: u.filename,
          path: u.path,
          file_type: u.file_category === 'image' ? 'image' : u.file_category === 'pdf' ? 'document' : 'code',
          size: u.size,
          created_at: u.created_at,
          preview_data: u.preview_data || null,
        }))
        setMediaBinFiles(prev => [...prev, ...newItems])
        // Refresh files so AI context picks them up
        const filesRes = await authFetch(`/api/projects/${selectedProject.id}/files`)
        if (filesRes.ok) { const d = await filesRes.json(); setFiles(Array.isArray(d) ? d : []) }
      }
    }
  }


  const handleMediaBinDelete = async (fileId) => {
    if (!selectedProject) return
    try {
      const res = await authFetch(`/api/projects/${selectedProject.id}/files/${fileId}`, { method: 'DELETE' })
      if (res.ok) {
        setMediaBinFiles(prev => prev.filter(f => f.id !== fileId))
        // Refresh files so AI context drops the deleted file
        const filesRes = await authFetch(`/api/projects/${selectedProject.id}/files`)
        if (filesRes.ok) { const d = await filesRes.json(); setFiles(Array.isArray(d) ? d : []) }
      }
    } catch (error) {
      console.error('Error deleting media file:', error)
    }
  }


  const deleteProject = async (projectId) => {
    try {
      const response = await authFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete project')
      }

      setProjects(prev => prev.filter(p => p.id !== projectId))
      setOpenProjectTabs(prev => prev.filter(p => p.id !== projectId))

      if (selectedProject?.id === projectId) {
        const remaining = openProjectTabs.filter(p => p.id !== projectId)
        if (remaining.length > 0) {
          setSelectedProject(remaining[remaining.length - 1])
        } else {
          setSelectedProject(null)
          setChats([])
          setSelectedChat(null)
          setMessages([])
          setFiles([])
          setCanvas(null)
        }
      }

      addLog('info', 'Project and all related data deleted')
      toast({ title: 'Project Deleted', description: 'Project and all its chats have been removed.' })
    } catch (error) {
      console.error('Error deleting project:', error)
      toast({ title: 'Delete Failed', description: error.message, variant: 'destructive' })
    }
  }


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

  const importProject = async (manifest) => {
    try {
      const response = await authFetch('/api/projects/import', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ manifest })
      })
      const data = await response.json()
      if (data.project) {
        setProjects(prev => [data.project, ...prev])
        openProjectWorkspace(data.project)
        addLog('success', `Imported project: ${data.project.name}`)
        toast({ title: 'Project Imported', description: data.project.name })
      }
      return data
    } catch (error) {
      console.error('Error importing project:', error)
      toast({ title: 'Import Failed', description: error.message, variant: 'destructive' })
      throw error
    }
  }

  const updateCanvas = async (canvasContent) => {
    if (!selectedProject) return
    try {
      await authFetch(`/api/projects/${selectedProject.id}/canvas`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ canvas_content: canvasContent })
      })
      setCanvas(canvasContent)
    } catch (error) {
      console.error('Error updating canvas:', error)
    }
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

  const renderProjectGrid = () => {
    const cards = projects.filter(p => !p.settings?.is_core)

    const modes = [
      { key: 'fullstack', label: 'Full Stack App', icon: Monitor },
      { key: 'mobile', label: 'Mobile App', icon: Smartphone },
      { key: 'landing', label: 'Landing Page', icon: FileText },
    ]

    return (
      <div className="flex-1 overflow-auto relative z-5">
        {/* ── Hero: headline + creative brief ── */}
        <div className="pt-16 pb-8 px-8">
          <div className="max-w-3xl mx-auto text-center mb-8">
            <h1
              className="text-3xl sm:text-4xl font-semibold em-gradient-text tracking-tight leading-tight"
              data-testid="dynamic-headline"
            >
              {headline}
            </h1>
          </div>

          <InlineBrief
            isOwner={isOwner}
            onStartBuilding={async (displayMessage, fullInstruction, briefData, attachments) => {
              setHeroSubmitting(true)
              try {
                pendingHeroPromptRef.current = { displayMessage, fullInstruction, attachments }
                const projectName = briefData?.project_name || briefData?.elevator_pitch?.slice(0, 40) || 'New Project'
                // Chat title should summarize the request, not duplicate the project name
                const chatTitle = briefData?.elevator_pitch?.slice(0, 50) || displayMessage?.slice(0, 50) || 'Initial Build'
                importChatTitleRef.current = chatTitle
                await createProject(projectName, projectMode === 'sandbox' ? 'sandbox' : 'app')
                aurora.triggerEnergyFlow?.()
                setActivityLevel(1)
              } catch (error) {
                pendingHeroPromptRef.current = null
              } finally {
                setHeroSubmitting(false)
              }
            }}
          />
        </div>

        {/* ── Project / Core System toggles + grid ── */}
        <div className="px-8 pb-12">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-1.5 p-0.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] backdrop-blur-sm" data-testid="projects-nav-tabs">
                <button
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-[rgba(0,229,255,0.12)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.25)] shadow-[0_0_8px_rgba(0,229,255,0.10)] transition-all duration-200"
                  data-testid="projects-tab-btn"
                >
                  <LayoutGrid className="w-3 h-3" />
                  Projects
                </button>
                {isOwner && (
                  <button
                    onClick={async () => {
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
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] border border-transparent hover:border-[rgba(255,255,255,0.15)] transition-all duration-200"
                    data-testid="core-system-btn"
                  >
                    Core System
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="project-grid">
              {cards.map((item) => (
                <div
                  key={item.id}
                  className="group relative rounded-xl em-glass hover:border-[rgba(255,255,255,0.24)] hover:shadow-[0_20px_70px_rgba(0,0,0,0.35),0_0_20px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.30)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden cursor-pointer"
                  onClick={() => {
                    hubEntryRef.current = true
                    setBuilderMode('app')
                    setSelectedChat(null)
                    setMessages([])
                    openProjectWorkspace(item)
                  }}
                  onMouseEnter={aurora.onTyping}
                  data-testid={`project-card-${item.id}`}
                >
                  {/* Delete button — top right corner */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirmProject(item)
                    }}
                    className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-lg bg-[rgba(0,0,0,0.5)] border border-[rgba(255,255,255,0.08)] text-[var(--em-text-secondary)] opacity-0 group-hover:opacity-100 hover:bg-[rgba(255,60,60,0.3)] hover:border-[rgba(255,60,60,0.4)] hover:text-red-400 transition-all duration-200 backdrop-blur-sm"
                    data-testid={`delete-project-btn-${item.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {/* Thumbnail — live preview snapshot */}
                  <ProjectThumbnail projectId={item.id} projectName={item.name} />
                  {/* Info */}
                  <div className="px-3.5 py-3 relative z-[2]">
                    <div className="text-sm font-medium em-text-primary truncate">{item.name}</div>
                    <div className="text-[11px] em-text-secondary mt-0.5">{item.type || 'project'}</div>
                  </div>
                </div>
              ))}

              {/* New project card */}
              <button
                onClick={() => setShowNewProjectModal(true)}
                className="rounded-xl border border-dashed border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.06)] backdrop-blur-sm transition-all duration-200 flex flex-col items-center justify-center min-h-[180px] group"
                data-testid="add-project-card"
              >
                <div className="w-10 h-10 rounded-lg border border-[rgba(255,255,255,0.10)] group-hover:border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.04)] flex items-center justify-center mb-2 transition-all">
                  <span className="text-xl text-[var(--em-text-secondary)] group-hover:text-white transition-colors">+</span>
                </div>
                <span className="text-xs text-[var(--em-text-secondary)] group-hover:text-white transition-colors">New Project</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── New Project Modal with Templates ── */}
        {showNewProjectModal && (
          <NewProjectModal
            showNewProjectModal={showNewProjectModal}
            setShowNewProjectModal={setShowNewProjectModal}
            newProjectName={newProjectName}
            setNewProjectName={setNewProjectName}
            newProjectType={newProjectType}
            setNewProjectType={setNewProjectType}
            selectedTemplate={selectedTemplate}
            setSelectedTemplate={setSelectedTemplate}
            createProject={createProject}
            selectedProject={selectedProject}
            addLog={addLog}
            toast={toast}
          />
        )}

        {/* ── Credits Modal ── */}
        {showCreditsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="em-glass rounded-2xl p-6 w-[420px] border border-[rgba(255,255,255,0.15)]" data-testid="credits-modal">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm font-semibold em-text-primary flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-[var(--em-cyan)]" />
                  Credits
                </h2>
                <button onClick={() => setShowCreditsModal(false)} className="em-text-muted hover:text-[var(--em-text-primary)] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="em-glass rounded-xl p-4 mb-5" data-testid="credits-balance">
                <div className="text-2xl font-bold em-gradient-text mb-1">
                  {creditsBalance !== null ? creditsBalance.toFixed(2) : '—'}
                </div>
                <div className="text-xs em-text-secondary">Available credits</div>
              </div>

              <div className="space-y-2 mb-5">
                <p className="text-[10px] em-text-muted font-medium uppercase tracking-wider mb-2">Cost per action</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(creditsCosts).map(([action, cost]) => (
                    <div key={action} className="flex items-center justify-between text-[11px] px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.03)]">
                      <span className="em-text-secondary capitalize">{action.replace(/_/g, ' ')}</span>
                      <span className="em-text-primary font-medium">{cost}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2" data-testid="credits-purchase-options">
                {[
                  { packageId: 'starter', amount: 100, price: '$10' },
                  { packageId: 'pro', amount: 500, price: '$45' },
                  { packageId: 'ultra', amount: 1000, price: '$80' },
                ].map(({ packageId, amount, price }) => (
                  <button
                    key={packageId}
                    onClick={() => handleBuyCredits(packageId)}
                    disabled={creditsLoading}
                    className="py-3 rounded-xl border border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200 text-center disabled:opacity-50"
                    data-testid={`buy-credits-${packageId}`}
                  >
                    <div className="text-sm font-semibold em-text-primary">{amount}</div>
                    <div className="text-[11px] em-text-secondary">{price}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

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
        renderProjectGrid()
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
                  onApplySuccess={(filesWritten) => {
                    // After Apply to Live succeeds in Core System, auto-send follow-up
                    if (selectedProject?.settings?.is_core) {
                      setTimeout(() => {
                        sendMessage('Applied successfully. Please proceed to the next step on the checklist.')
                      }, 500)
                    }
                  }}
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
