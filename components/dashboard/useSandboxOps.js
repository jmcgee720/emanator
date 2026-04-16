import { useState, useCallback } from 'react'
import { authFetch } from '@/lib/auth-fetch'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * Hook for sandbox operations: create, test, promote, diff, rollback.
 * Extracted from Dashboard.jsx to keep file sizes manageable.
 */
export function useSandboxOps({ selectedProject, setSelectedProject, setProjects, openProjectWorkspace, setChats, setSelectedChat, setMessages, setFiles, setCanvas, addLog, pendingDiffs, toast }) {
  const [sandboxTestResult, setSandboxTestResult] = useState(null)
  const [sandboxTesting, setSandboxTesting] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [showPromoteConfirm, setShowPromoteConfirm] = useState(false)
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [sandboxDiff, setSandboxDiff] = useState(null)
  const [showSandboxDiff, setShowSandboxDiff] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)

  const createSandbox = useCallback(async (projectId) => {
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
  }, [addLog, setProjects, openProjectWorkspace, setChats, setSelectedChat, setMessages, setFiles, setCanvas, toast])

  const testBeforeApply = useCallback(async () => {
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
  }, [selectedProject, sandboxTesting, addLog, pendingDiffs, setSelectedProject, toast])

  const promoteSandbox = useCallback(async () => {
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
  }, [selectedProject, promoting, addLog, setSelectedProject, toast])

  const loadSandboxDiff = useCallback(async () => {
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
  }, [selectedProject, loadingDiff, toast])

  const rollbackSandbox = useCallback(async () => {
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
  }, [selectedProject, rollingBack, addLog, setSelectedProject, toast])

  return {
    sandboxTestResult, setSandboxTestResult,
    sandboxTesting,
    promoting,
    showPromoteConfirm, setShowPromoteConfirm,
    showRollbackConfirm, setShowRollbackConfirm,
    rollingBack,
    sandboxDiff, setSandboxDiff,
    showSandboxDiff, setShowSandboxDiff,
    loadingDiff,
    createSandbox,
    testBeforeApply,
    promoteSandbox,
    loadSandboxDiff,
    rollbackSandbox,
  }
}
