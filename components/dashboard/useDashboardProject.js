'use client'

/**
 * useDashboardProject — Project/Chat CRUD operations
 * 
 * Extracted from Dashboard.jsx to keep the main component manageable.
 * All project, chat, file, and canvas operations live here.
 */

import { authFetch } from '@/lib/auth-fetch'
import { selfEditTitle, getChatType } from '@/lib/constants'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function useDashboardProject(ctx) {
  const {
    setProjects, setSelectedProject, setOpenProjectTabs, selectedProject, openProjectTabs,
    setChats, chats, setSelectedChat, selectedChat, setMessages, setFiles, setCanvas, setLoading,
    setMessagesReadyTick, setSelfEditTarget,
    isOwner, addLog, toast, openProjectWorkspace,
    coreProjectIdRef, importChatTitleRef,
  } = ctx

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

  const loadProjectData = async (projectId, skipChatSelect = false, chatTitle = 'New Conversation', restoreChatId = null) => {
    try {
      const chatsResponse = await authFetch(`/api/projects/${projectId}/chats`)
      const chatsText = await chatsResponse.text()
      let chatsData
      try { chatsData = JSON.parse(chatsText) } catch { chatsData = [] }
      const chatList = Array.isArray(chatsData) ? chatsData : []
      setChats(chatList)

      // Only restore a specific chat if explicitly requested (e.g., tab switching)
      // Never auto-select the first chat - let user choose from ProjectHub
      if (restoreChatId) {
        const restored = chatList.find(c => c.id === restoreChatId)
        if (restored) {
          setSelectedChat(restored)
        }
      }
      // Removed auto-selection logic - users now explicitly choose from conversation list
    } catch (error) {
      console.error('Error loading chats:', error)
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
      const canvasResponse = await authFetch(`/api/projects/${projectId}/canvas`)
      if (canvasResponse.ok) {
        const canvasData = await canvasResponse.json()
        setCanvas(canvasData.canvas_content || null)
      } else {
        setCanvas(null)
      }
    } catch {
      setCanvas(null)
    }
  }

  const loadMessages = async (chatId) => {
    try {
      const response = await authFetch(`/api/chats/${chatId}/messages`)
      const text = await response.text()
      let data
      try { data = JSON.parse(text) } catch { data = [] }
      setMessages(Array.isArray(data) ? data.filter(m => {
        if (m.metadata?.silent) return false
        if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[SYSTEM:')) return false
        return true
      }) : [])
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
      try { openProjectWorkspace(newProject) } catch (e) { console.warn('[createProject] openProjectWorkspace failed:', e.message) }

      if (initialChat) {
        setChats([initialChat])
        setSelectedChat(initialChat)
        setMessages([])
      }

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

  const createChat = async (title = 'New Chat') => {
    if (!selectedProject) return

    // Auto-convert to self-edit chat if in Core System project
    const isCoreProject = selectedProject.settings?.is_core === true
    const isSelfEditTitle = title.startsWith('\u2699 Self-Edit: ')
    
    if (isCoreProject && !isSelfEditTitle && isOwner) {
      // Core System project: force self-edit chat
      return createSelfEditChat(title === 'New Chat' ? 'Internal Improvement' : title)
    }
    
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

  const uploadFiles = async (fileList) => {
    if (!selectedProject) return null
    try {
      const response = await authFetch(`/api/projects/${selectedProject.id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileList, chatId: selectedChat?.id }),
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

  const forkChat = async (chatId) => {
    try {
      const response = await authFetch(`/api/chats/${chatId}/fork`, { method: 'POST' })
      if (!response.ok) throw new Error('Failed to fork chat')
      const text = await response.text()
      const data = JSON.parse(text)
      const newChat = { id: data.id, title: data.title, project_id: data.project_id, chat_type: getChatType({ title: data.title }) }
      setChats(prev => [newChat, ...prev])
      setSelectedChat(newChat)
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

  return {
    loadProjects, loadProjectData, autoCreateChat, loadMessages,
    createProject, createChat, createSelfEditChat, uploadFiles,
    forkChat, deleteChat, renameChat, renameProject, deleteProject,
    importProject, updateCanvas,
  }
}
