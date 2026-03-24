'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useToast } from '@/hooks/use-toast'
import { streamMessage } from '@/lib/stream-client'
import TopBar from './TopBar'
import LeftPanel from './LeftPanel'
import RightPanel from './RightPanel'
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
  const [canvas, setCanvas] = useState(null)

  const [showAdmin, setShowAdmin] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showCanvas, setShowCanvas] = useState(false)
  const [showDesign, setShowDesign] = useState(false)

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

  const streamAbortRef = useRef(null)
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
    setOpenProjectTabs(prev => {
      const nextTabs = prev.filter(p => p.id !== projectId)

      if (selectedProject?.id === projectId) {
        if (nextTabs.length > 0) {
          setSelectedProject(nextTabs[nextTabs.length - 1])
        } else {
          setSelectedProject(null)
          setChats([])
          setSelectedChat(null)
          setMessages([])
          setFiles([])
          setCanvas(null)
        }
      }

      return nextTabs
    })
  }, [selectedProject])

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
      loadProjectData(selectedProject.id)
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

  const loadProjectData = async (projectId) => {
    try {
      const chatsResponse = await authFetch(`/api/projects/${projectId}/chats`)
      const chatsData = await chatsResponse.json()
      const chatList = Array.isArray(chatsData) ? chatsData : []
      setChats(chatList)

      if (chatList.length > 0) {
        setSelectedChat(chatList[0])
      } else {
        await autoCreateChat(projectId)
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

  const autoCreateChat = async (projectId) => {
    try {
      const response = await authFetch(`/api/projects/${projectId}/chats`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: 'New Conversation' })
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

    const placeholderAssistant = {
      id: streamingAssistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      created_at: new Date().toISOString()
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
          const capturedMsgId = streamingAssistantId
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
                      setImageGenProgress(prev => ({
                        ...prev,
                        stage: eventData.stage,
                        progress: eventData.progress,
                        label: eventData.label,
                      }))
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
                if (m.id === capturedMsgId) {
                  realMsgId = m.id
                  return { ...m, content, streaming: false, metadata: { ...m.metadata, generatedImage: genImage } }
                }
                return m
              })
              if (!realMsgId) {
                return prev.map(m => {
                  if (!realMsgId && m.role === 'assistant' && m.metadata?.toolMode === 'image_gen' && !m.metadata?.generatedImage) {
                    realMsgId = m.id
                    return { ...m, content, streaming: false, metadata: { ...m.metadata, generatedImage: genImage } }
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
              (m.id === capturedMsgId || (m.role === 'assistant' && m.metadata?.toolMode === 'image_gen' && !m.metadata?.generatedImage))
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
    if (!selectedProject || applyingDiffs) return

    setApplyingDiffs(true)
    addLog('info', `Applying ${approvedFiles.length} approved file(s)...`)

    try {
      const pendingMsg = messages.find(m => m.id === diffMessageId && m.metadata?.diffStatus === 'pending')
      const planId = pendingMsg?.metadata?.planId || null
      const diffId = pendingMsg?.metadata?.diffId || null

      const response = await authFetch(`/api/projects/${selectedProject.id}/apply-diffs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedFiles,
          planData: diffPlanData,
          chatId: selectedChat?.id,
          planId,
          diffId,
          provider: aiProvider,
        }),
      })

      const result = await response.json()

      if (result.success) {
        if (diffMessageId) {
          setMessages(prev => prev.map(m =>
            m.id === diffMessageId
              ? { ...m, metadata: { ...m.metadata, diffStatus: 'applied' } }
              : m
          ))
        }

        if (result.snapshot) {
          addLog('info', `Snapshot created: ${result.snapshot.name}`)
        }
        addLog('success', `Applied ${result.written.length} file(s)${result.deleted.length > 0 ? `, deleted ${result.deleted.length}` : ''}`)

        if (result.errors.length > 0) {
          for (const err of result.errors) {
            addLog('error', `Failed: ${err.path} — ${err.error}`)
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

        toast({ title: 'Changes Applied', description: `${result.written.length} file(s) written. Snapshot saved.` })
      } else {
        addLog('error', `Apply failed: ${result.error}`)
        toast({ title: 'Apply Failed', description: result.error, variant: 'destructive' })
      }
    } catch (err) {
      addLog('error', `Apply error: ${err.message}`)
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setApplyingDiffs(false)
      setPendingDiffs([])
      setDiffMessageId(null)
      setDiffPlanData(null)
      setPendingPlan(null)
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

  const deleteProject = async (projectId) => {
    try {
      const response = await authFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete project')

      const remaining = projects.filter(p => p.id !== projectId)
      setProjects(remaining)
      setOpenProjectTabs(prev => prev.filter(p => p.id !== projectId))

      if (selectedProject?.id === projectId) {
        if (openProjectTabs.length > 1) {
          const fallback = openProjectTabs.filter(p => p.id !== projectId)
          setSelectedProject(fallback[fallback.length - 1] || null)
        } else {
          setSelectedProject(null)
          setChats([])
          setSelectedChat(null)
          setMessages([])
          setFiles([])
          setCanvas(null)
        }
      }

      addLog('info', 'Project deleted')
      toast({ title: 'Project deleted' })
    } catch (error) {
      console.error('Error deleting project:', error)
      toast({ title: 'Error', description: 'Failed to delete project', variant: 'destructive' })
    }
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

  const renderProjectGrid = () => {
    const cards = projects.filter(p => p.type !== 'core')

    return (
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="mx-auto max-w-7xl border border-border bg-card/20 min-h-[calc(100vh-8rem)] rounded-2xl p-8">
<div className="flex items-center justify-between mb-10">
  <div className="flex items-center gap-4">
    <div className="flex flex-col">
      <h1 className="text-2xl font-semibold text-foreground tracking-tight">
        Project Bin
      </h1>
      <span className="text-xs text-muted-foreground mt-1">
        Your projects and workspaces
      </span>
    </div>

  </div>

  <div className="flex items-center gap-2">
    {isOwner && (
      <button
        onClick={() => {
          setBuilderMode('core')
          if (projects.length > 0) {
            openProjectWorkspace(projects[0])
          }
        }}
        className="px-3 py-1.5 rounded-md text-xs border border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
      >
        Core System
      </button>
    )}

    <button
      onClick={() => setShowNewProjectModal(true)}
      className="px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90"
    >
      New Project
    </button>

    <button
      onClick={() => setShowSearch(true)}
      className="px-3 py-1.5 rounded-md text-xs border border-border hover:bg-muted"
    >
      Search
    </button>
  </div>
</div>

{/* Center: optional subtle divider */}
<div className="flex justify-center mb-12">
  <div className="h-px w-32 bg-border opacity-50" />
</div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8 max-w-5xl mx-auto">
            {cards.map((item) => {
              const isCoreCard = item.id === '__core_system__'

              return (
                <button
                  key={item.id}
                  onClick={() => {setBuilderMode('app')
                    openProjectWorkspace(item)
                  }}
                  className="aspect-square rounded-xl border border-border bg-background/40 hover:border-primary hover:bg-background/70 transition-all flex flex-col items-center justify-center p-4 text-center"
                >
                  <div className="w-16 h-16 rounded-lg border border-border mb-4 flex items-center justify-center text-sm">
                    {isCoreCard ? '⚙' : '□'}
                  </div>
                  <div className="text-sm font-medium text-foreground">{item.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {isCoreCard ? 'Owner only' : item.type || 'project'}
                  </div>
                </button>
              )
            })}

            <button
              onClick={() => setShowNewProjectModal(true)}
              className="aspect-square rounded-xl border border-dashed border-border bg-background/20 hover:border-primary hover:bg-background/50 transition-all flex items-center justify-center text-3xl text-muted-foreground"
            >
              +
            </button>
          </div>
        </div>
      {showNewProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-lg p-6 w-[400px]">

            <h2 className="text-sm font-semibold mb-4">Create Project</h2>

            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="w-full mb-3 px-3 py-2 text-sm border border-border rounded-md bg-background"
            />

            <select
              value={newProjectType}
              onChange={(e) => setNewProjectType(e.target.value)}
              className="w-full mb-4 px-3 py-2 text-sm border border-border rounded-md bg-background"
            >
              <option value="app">App Builder</option>
              <option value="core">Core System</option>
            </select>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewProjectModal(false)}
                className="px-3 py-1.5 text-xs border border-border rounded-md"
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  if (!newProjectName.trim()) return
                  createProject(newProjectName, newProjectType)
                  setShowNewProjectModal(false)
                  setNewProjectName('')
                  setNewProjectType('app')
                }}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md"
              >
                Create
              </button>
            </div>

          </div>
        </div>
      )}
      </div>
    )
  }

  const renderWorkspaceTabs = () => (
    <div className="h-12 border-b border-border flex items-center gap-2 px-3 overflow-x-auto">
      <button
        onClick={() => {
          setSelectedProject(null)
          setChats([])
          setSelectedChat(null)
          setMessages([])
          setFiles([])
          setCanvas(null)
        }}
        className="shrink-0 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted transition-colors"
      >
        ← Projects
      </button>

      <div className="w-px h-6 bg-border shrink-0" />

      {openProjectTabs.map((project) => {
        const isActive = selectedProject?.id === project.id
        return (
          <div
            key={project.id}
            className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
              isActive ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-muted-foreground'
            }`}
          >
            <button onClick={() => openProjectWorkspace(project)} className="truncate max-w-[180px] text-left">
              {project.name}
            </button>
            <button
              onClick={() => closeProjectWorkspaceTab(project.id)}
              className="text-xs opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )

  `}
          >
            Builder
          </button>

          {isOwner && (
            <button
              onClick={() => setBuilderMode('core')}
              className={`px-3 py-1 rounded-md text-xs ${
                builderMode === 'core'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              Core System
            </button>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          {builderMode === 'core'
            ? 'Core System chats are owner-only and modify Emanator itself'
            : 'Builder chats create and edit user projects'}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background relative" data-testid="dashboard">
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
        isOwner={isOwner}
        isMonitored={isMonitored}
      />

      {!selectedProject ? (
        renderProjectGrid()
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

              <ResizableHandle className="w-px bg-[hsl(270_70%_55%/0.15)] hover:bg-[hsl(190_100%_50%/0.3)] transition-colors" />

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
    </div>
  )
}