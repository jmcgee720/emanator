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
import DesignPanel from './DesignPanel'
import VariationStudio from './VariationStudio'
import PromptLibrary from './PromptLibrary'
import { SavePromptDialog } from './PromptLibrary'
import BuilderMemory from './BuilderMemory'
import { getDefaultDesignPrefs } from '@/lib/ai/design-system'
import { selfEditTitle, getChatType, CHAT_TYPES, SELF_EDIT_TARGETS } from '@/lib/constants'
import { Monitor, Smartphone, FileText, Mic, ChevronDown, ArrowUp, Upload, FolderArchive, GitBranch, X, CreditCard, Zap, Trash2, AlertTriangle, LayoutGrid, Plus } from 'lucide-react'
import { useAuroraState } from '@/hooks/useAuroraState'

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
  const [selectedProject, setSelectedProject] = useState(null)
  const [openProjectTabs, setOpenProjectTabs] = useState([])

  const [chats, setChats] = useState([])
  const [selectedChat, setSelectedChat] = useState(null)
  const [messages, setMessages] = useState([])
  const [files, setFiles] = useState([])
  const [projectFileIndex, setProjectFileIndex] = useState({})
  const [canvas, setCanvas] = useState(null)

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

  const streamAbortRef = useRef(null)
  const hubEntryRef = useRef(false)
  const importChatTitleRef = useRef(null)
  const pendingHeroPromptRef = useRef(null)
  const tabChatStateRef = useRef({})
  const pendingRestoreChatRef = useRef(null)
  const { toast } = useToast()

  const [logs, setLogs] = useState([
    { type: 'info', message: 'Welcome to Emanator', timestamp: new Date().toISOString() },
    { type: 'info', message: 'AI generation engine ready', timestamp: new Date().toISOString() }
  ])

  const addLog = useCallback((type, message) => {
    setLogs(prev => [...prev, { type, message, timestamp: new Date().toISOString() }])
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

  useEffect(() => {
    if (selectedChat) {
      loadMessages(selectedChat.id)
    } else {
      setMessages([])
    }
  }, [selectedChat?.id])

  // Send pending hero prompt AFTER messages finish loading (avoids race condition)
  useEffect(() => {
    if (pendingHeroPromptRef.current && selectedChat && selectedProject && !streamingMessageId) {
      const prompt = pendingHeroPromptRef.current
      pendingHeroPromptRef.current = null
      sendMessage(prompt)
    }
  }, [messagesReadyTick])

  const loadProjects = async () => {
    try {
      const response = await authFetch('/api/projects')
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to load projects')
      }
      const data = await response.json()
      const projectList = Array.isArray(data) ? data : []
      setProjects(projectList)

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
      const chatsData = await chatsResponse.json()
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
      const filesData = await filesResponse.json()
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
        const newChat = await response.json()
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
      const data = await response.json()
      setMessages(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error loading messages:', error)
    }
    setMessagesReadyTick(t => t + 1)
  }

  const createProject = async (name, type = 'app') => {
    try {
      addLog('info', `Creating project: ${name}`)
      const response = await authFetch('/api/projects', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name, type })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to create project')
      }

      const data = await response.json()
      const newProject = data.project || data
      const initialChat = data.initialChat || null

      setProjects(prev => [newProject, ...prev])
      openProjectWorkspace(newProject)

      if (initialChat) {
        setChats([initialChat])
        setSelectedChat(initialChat)
        setMessages([])
      }

      setFiles([])
      setCanvas(null)

      addLog('success', `Project "${name}" created`)
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
        const err = await response.json()
        throw new Error(err.error || 'Failed to create chat')
      }

      const newChat = await response.json()
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
      const newChat = await response.json()
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

  const sendMessage = async (content, attachments) => {
    if (!selectedChat || !content.trim()) return
    if (streamingMessageId) return

    streamAbortRef.current?.abort()

    const streamingAssistantId = `streaming-${Date.now()}`
    const collectedDiffs = []

    const tempUserId = `temp-${Date.now()}`
    const tempUserMessage = {
      id: tempUserId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
      metadata: attachments ? { attachments } : undefined
    }
    setMessages(prev => [...prev, tempUserMessage])

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

    const isSelfEditChat = selectedChat && getChatType(selectedChat) === CHAT_TYPES.SELF_EDIT
    const streamOpts = { provider: aiProvider, model: aiModel, scope, designPrefs, attachments }
    if (isSelfEditChat && selfEditTarget) {
      streamOpts.selfEditTarget = selfEditTarget
    }

    const abortController = streamMessage(
      selectedChat.id,
      content,
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
        },

        onDiffFile: (data) => {
          collectedDiffs.push(data)
          addLog('info', `Diff ready: ${data.action} ${data.path}`)
        },

        onImageGenerated: (data) => {
          setMessages(prev => prev.map(m =>
            m.id === streamingAssistantId
              ? { ...m, metadata: { ...m.metadata, generatedImage: data } }
              : m
          ))
          addLog('success', `Image generated: ${data.filename} (${data.mode})`)
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
              streaming: false,
              clientMessageKey: m.clientMessageKey,  // Preserve stable identity across id swap
              metadata: { ...updatedMeta, generatedImage: existingImage || null }
            }
          }))
          setStreamingMessageId(null)
          setStreamingStatus(null)

          if (data.generatedFiles?.length > 0 && !diffs?.length) {
            const filesResponse = await authFetch(`/api/projects/${selectedProject.id}/files`)
            const filesData = await filesResponse.json()
            setFiles(Array.isArray(filesData) ? filesData : [])
            setActiveTab('preview')
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
          addLog('error', `Provider error: ${data.message}`)

          if (!data.partial) {
            toast({ title: 'Generation Failed', description: data.message, variant: 'destructive' })
          }
        }
      }
    )

    streamAbortRef.current = abortController
  }

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
          toast({ title: 'Generation Failed', description: data.message, variant: 'destructive' })
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
        setActiveTab('preview')

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
      const data = await response.json()
      const newChat = { id: data.id, title: data.title, project_id: data.project_id, chat_type: getChatType({ title: data.title }) }
      setChats(prev => [...prev, newChat])
      setSelectedChat(newChat)
      toast({ title: 'Chat Forked', description: `Created "${data.title}"` })
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
    } catch (error) {
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
        <GrowthPanel onClose={() => setShowGrowth(false)} />
      </div>
    )
  }

  const renderProjectGrid = () => {
    const cards = projects.filter(p => p.name !== 'Emanator Backend')

    const modes = [
      { key: 'fullstack', label: 'Full Stack App', icon: Monitor },
      { key: 'mobile', label: 'Mobile App', icon: Smartphone },
      { key: 'landing', label: 'Landing Page', icon: FileText },
    ]

    return (
      <div className="flex-1 overflow-auto relative z-5">
        {/* ── Hero: headline + prompt ── */}
        <div className="pt-16 pb-12 px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1
              className="text-3xl sm:text-4xl font-semibold em-gradient-text tracking-tight mb-10 leading-tight"
              data-testid="dynamic-headline"
            >
              {headline}
            </h1>

            {/* Mode toggles */}
            <div className="flex items-center justify-center gap-2 mb-5" data-testid="mode-toggles">
              {modes.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setProjectMode(key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border transition-all duration-200 backdrop-blur-sm ${
                    projectMode === key
                      ? 'border-[rgba(255,255,255,0.25)] bg-[rgba(255,255,255,0.10)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_12px_rgba(0,229,255,0.08)]'
                      : 'border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] text-[var(--em-text-secondary)] hover:border-[rgba(255,255,255,0.18)] hover:bg-[rgba(255,255,255,0.07)]'
                  }`}
                  data-testid={`mode-toggle-${key}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Prompt input — elite hero glass */}
            <div
              className="relative rounded-xl overflow-hidden p-1 transition-all duration-200 focus-within:shadow-[0_0_24px_rgba(0,229,255,0.10),0_0_60px_rgba(0,229,255,0.04)]"
              data-testid="prompt-container"
              style={{
                background: 'linear-gradient(170deg, rgba(255,255,255,0.09) 0%, rgba(200,220,255,0.05) 40%, rgba(255,255,255,0.07) 100%)',
                backdropFilter: 'blur(36px) saturate(1.6) brightness(1.08)',
                WebkitBackdropFilter: 'blur(36px) saturate(1.6) brightness(1.08)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 16px 70px rgba(0,0,0,0.28), 0 4px 24px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.30), inset 0 0 60px rgba(255,255,255,0.02)',
              }}
            >
              {/* Top specular */}
              <div className="absolute top-0 left-0 right-0 h-px z-[2]" style={{
                background: 'linear-gradient(90deg, transparent 2%, rgba(255,255,255,0.12) 10%, rgba(255,255,255,0.45) 25%, rgba(255,255,255,0.65) 40%, rgba(0,229,255,0.30) 55%, rgba(255,255,255,0.35) 72%, rgba(255,255,255,0.10) 90%, transparent 98%)',
              }} />
              <div className="relative">
                <textarea
                  value={promptInput}
                  onChange={(e) => { setPromptInput(e.target.value); aurora.onTyping(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleHeroPromptSubmit()
                    }
                  }}
                  placeholder="Build me a dashboard for..."
                  rows={2}
                  className="w-full bg-transparent text-sm text-[var(--em-text-primary)] placeholder:text-[var(--em-text-secondary)] placeholder:opacity-60 outline-none resize-none px-4 py-3"
                  data-testid="project-prompt-input"
                />
              </div>
              {/* Prompt controls row */}
              <div className="flex items-center justify-between px-3 pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[var(--em-text-primary)] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]" data-testid="model-selector-prompt">
                    <span>E-1</span>
                  </div>
                  <div className="w-px h-4 bg-[rgba(255,255,255,0.08)]" />
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[var(--em-cyan)] bg-[rgba(0,229,255,0.06)] border border-[rgba(0,229,255,0.12)]" data-testid="ultra-toggle">
                    <span>Ultra</span>
                  </div>
                  <div className="w-px h-4 bg-[rgba(255,255,255,0.08)]" />
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[var(--em-text-primary)] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]" data-testid="ai-model-selector">
                    <span>Claude 4.5 Opus</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={toggleVoiceDictation}
                    className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-all ${
                      voiceListening
                        ? 'border-red-500/40 bg-red-500/15 text-red-400 animate-pulse'
                        : 'border-[rgba(255,255,255,0.08)] text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)]'
                    }`}
                    data-testid="voice-input-btn"
                  >
                    <Mic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className={`h-7 w-7 flex items-center justify-center rounded-lg transition-all ${
                      promptInput.trim() && !heroSubmitting
                        ? 'bg-[var(--em-cyan)] text-[#0C1018] hover:brightness-110 shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                        : 'bg-[rgba(255,255,255,0.08)] text-[var(--em-text-muted)] cursor-not-allowed'
                    }`}
                    data-testid="prompt-submit-btn"
                    disabled={!promptInput.trim() || heroSubmitting}
                    onClick={handleHeroPromptSubmit}
                  >
                    {heroSubmitting ? (
                      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <ArrowUp className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Project Grid — no outer panel, cards float on aurora ── */}
        <div className="px-8 pb-12">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium em-text-secondary tracking-wide" data-testid="projects-heading">
                Your Projects
              </h2>
              <div className="flex items-center gap-2">
                {isOwner && (
                  <button
                    onClick={async () => {
                      setBuilderMode('core')
                      let coreProject =
                        projects.find(p => p.name === 'Emanator Backend') ||
                        projects.find(p => p.name === 'Emanator') ||
                        projects.find(p => p.type === 'core') ||
                        null
                      if (!coreProject) {
                        coreProject = await createProject('Emanator Backend', 'app')
                        if (!coreProject) return
                      }
                      hubEntryRef.current = true
                      setSelectedChat(null)
                      setMessages([])
                      openProjectWorkspace(coreProject)
                    }}
                    className="px-3.5 py-1.5 rounded-xl text-[11px] font-semibold border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.06)] text-[var(--em-cyan)] hover:bg-[rgba(255,255,255,0.10)] hover:border-[rgba(255,255,255,0.25)] backdrop-blur-sm transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
                    data-testid="core-system-btn"
                  >
                    Core System
                  </button>
                )}
                <button
                  onClick={() => setShowNewProjectModal(true)}
                  className="px-3.5 py-1.5 rounded-xl text-[11px] font-semibold em-btn-brand"
                  data-testid="new-project-btn"
                >
                  New Project
                </button>
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
                  {/* Thumbnail area */}
                  <div className="aspect-[4/3] bg-[rgba(255,255,255,0.03)] border-b border-[rgba(255,255,255,0.06)] flex items-center justify-center">
                    <span className="text-xs em-text-muted font-medium">Project Thumbnail</span>
                  </div>
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

        {/* ── New Project Modal ── */}
        {showNewProjectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="em-glass rounded-2xl p-6 w-[400px] border border-[rgba(255,255,255,0.15)]" data-testid="new-project-modal">
              <h2 className="text-sm font-semibold mb-4 em-text-primary">Create Project</h2>
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full mb-3 px-3 py-2 text-sm em-input"
                data-testid="new-project-name-input"
              />
              <select
                value={newProjectType}
                onChange={(e) => setNewProjectType(e.target.value)}
                className="w-full mb-4 px-3 py-2 text-sm em-input"
                data-testid="new-project-type-select"
              >
                <option value="app">App Builder</option>
                <option value="core">Core System</option>
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowNewProjectModal(false)} className="px-3 py-1.5 text-xs em-btn-ghost" data-testid="cancel-new-project">Cancel</button>
                <button
                  onClick={() => {
                    if (!newProjectName.trim()) return
                    createProject(newProjectName, newProjectType)
                    setShowNewProjectModal(false)
                    setNewProjectName('')
                    setNewProjectType('app')
                  }}
                  className="px-3 py-1.5 text-xs em-btn-brand"
                  data-testid="create-project-submit"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
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

  const renderWorkspaceTabs = () => (
    <div className="h-12 flex items-center gap-2 px-3 overflow-x-auto relative z-10 em-glass-topbar">
      <button
        onClick={() => {
          setSelectedProject(null)
          setChats([])
          setSelectedChat(null)
          setMessages([])
          setFiles([])
          setCanvas(null)
        }}
        className="shrink-0 px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] text-sm em-text-secondary hover:bg-[rgba(255,255,255,0.07)] hover:text-[var(--em-text-primary)] hover:border-[rgba(255,255,255,0.20)] transition-all duration-200"
        data-testid="workspace-back-to-grid"
      >
        ← Projects
      </button>

      <div className="w-px h-6 bg-[rgba(255,255,255,0.10)] shrink-0" />

      {/* Hub link — go back to project hub */}
      <button
        onClick={() => {
          setSelectedChat(null)
          setMessages([])
        }}
        className="shrink-0 px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] text-sm em-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--em-text-primary)] hover:border-[rgba(255,255,255,0.15)] transition-all duration-200"
        data-testid="workspace-back-to-hub"
      >
        {selectedProject?.name || 'Hub'}
      </button>

      <div className="w-px h-6 bg-[rgba(255,255,255,0.10)] shrink-0" />

      {/* Current chat indicator with rename */}
      {selectedChat && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,229,255,0.25)] bg-[rgba(0,229,255,0.06)] text-sm text-[var(--em-text-primary)]">
          <span className="truncate max-w-[200px]">{selectedChat.title || 'Chat'}</span>
          <button
            onClick={() => {
              const newTitle = prompt('Rename conversation:', selectedChat.title)
              if (newTitle?.trim()) renameChat(selectedChat.id, newTitle.trim())
            }}
            className="ml-1 opacity-50 hover:opacity-100 transition-opacity"
            data-testid="workspace-rename-chat"
            title="Rename conversation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>
      )}
    </div>
  )


  return (
    <div className={`h-screen flex flex-col relative ${aurora.auroraClassName}`} style={{ color: 'var(--em-text-primary)' }} data-testid="dashboard">
      {/* Aurora borealis background — contained in center */}
      <div className="em-aurora-containment">
        <div className="em-aurora-veil-1" />
        <div className="em-aurora-veil-2" />
        <div className="em-aurora-veil-3" />
        <div className="em-aurora-veil-4" />
        <div className="em-aurora-veil-5" />
        <div className="em-aurora-veil-6" />
        <div className="em-aurora-horizon" />
      </div>
      <div className="em-aurora-noise" />
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none" data-testid="self-builder-badge">
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
          Self-Builder Active
        </span>
      </div>

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
        onOpenCanvas={() => setShowCanvas(true)}
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

      {/* ── Tab Bar — always visible ── */}
      <div className="h-9 flex items-center px-2 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(12,16,24,0.6)] shrink-0" data-testid="project-tabs-bar">
        {/* Project Bin — permanent, not closable, distinct styling */}
        <button
          onClick={goToProjectsGrid}
          className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-[11px] font-medium transition-all duration-200 shrink-0 ${
            !selectedProject
              ? 'bg-[rgba(0,229,255,0.12)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.25)] shadow-[0_0_8px_rgba(0,229,255,0.12)]'
              : 'em-text-muted hover:text-[var(--em-text-primary)] hover:bg-[rgba(255,255,255,0.06)] border border-transparent'
          }`}
          data-testid="tabs-project-bin"
        >
          <LayoutGrid className="w-3 h-3" />
          Project Bin
        </button>

        {openProjectTabs.length > 0 && (
          <div className="w-px h-4 bg-[rgba(255,255,255,0.08)] mx-1.5 shrink-0" />
        )}

        {/* Scrollable project tabs */}
        <div className="flex-1 min-w-0 overflow-x-auto" style={{ scrollBehavior: 'smooth', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <style>{`[data-testid="project-tabs-bar"] div::-webkit-scrollbar { display: none; }`}</style>
          <div className="flex items-center gap-0.5 w-max">
            {openProjectTabs.map((tab) => {
              const isActive = selectedProject?.id === tab.id
              return (
                <div
                  key={tab.id}
                  className={`group flex items-center h-7 pl-2.5 pr-1 rounded-md text-[11px] font-medium shrink-0 max-w-[180px] transition-all duration-200 ${
                    isActive
                      ? 'bg-[rgba(0,229,255,0.14)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.30)] shadow-[0_0_10px_rgba(0,229,255,0.10)]'
                      : 'em-text-secondary hover:text-[var(--em-text-primary)] hover:bg-[rgba(255,255,255,0.06)] border border-transparent'
                  }`}
                  data-testid={`project-tab-${tab.id}`}
                >
                  <button
                    onClick={() => switchToProjectTab(tab)}
                    className="truncate min-w-0 leading-[28px]"
                    data-testid={`project-tab-activate-${tab.id}`}
                  >
                    {tab.name}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeProjectWorkspaceTab(tab.id) }}
                    className={`ml-1 w-4 h-4 flex items-center justify-center rounded transition-all duration-150 shrink-0 ${
                      isActive
                        ? 'text-[var(--em-cyan)] opacity-70 hover:opacity-100 hover:bg-[rgba(0,229,255,0.20)]'
                        : 'em-text-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-[rgba(255,255,255,0.12)]'
                    }`}
                    data-testid={`project-tab-close-${tab.id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* "+" button — opens Project Bin */}
        <div className="shrink-0 ml-1">
          <button
            onClick={goToProjectsGrid}
            className="w-6 h-6 flex items-center justify-center rounded-md em-text-muted hover:text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.08)] border border-transparent hover:border-[rgba(0,229,255,0.15)] transition-all duration-200"
            title="Open Project Bin"
            data-testid="tabs-add-btn"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!selectedProject ? (
        renderProjectGrid()
      ) : !selectedChat ? (
        <ProjectHub
          project={selectedProject}
          chats={chats}
          files={files}
          mediaBinFiles={mediaBinFiles}
          onSelectChat={(chat) => handleSelectChat(chat)}
          onCreateChat={() => createChat()}
          onBack={goToProjectsGrid}
          onDeleteProject={() => setDeleteConfirmProject(selectedProject)}
          onUploadMediaBin={() => mediaBinInputRef.current?.click()}
          onSyncRepo={handleSyncRepo}
          onRenameChat={renameChat}
          onRenameProject={(newName) => renameProject(selectedProject.id, newName)}
          onDeleteMediaFile={handleMediaBinDelete}
        />
      ) : (
        <>
          {renderWorkspaceTabs()}

          <div className="flex-1 overflow-hidden">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={35} minSize={25} maxSize={50} className="overflow-hidden">
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
                  onCreateChat={createChat}
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
                />
              </ResizablePanel>

              <ResizableHandle className="w-px bg-[rgba(255,255,255,0.10)] hover:bg-[rgba(0,229,255,0.3)] transition-colors duration-200" />

              <ResizablePanel defaultSize={65} className="overflow-hidden">
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
                />
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
          projectId={selectedProject.id}
          canvas={canvas}
          onUpdate={updateCanvas}
          onClose={() => setShowCanvas(false)}
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
