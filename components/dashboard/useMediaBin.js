import { useState, useCallback } from 'react'
import { authFetch } from '@/lib/auth-fetch'

/**
 * Hook for media bin operations: load, upload, delete assets.
 * Extracted from Dashboard.jsx.
 */
export function useMediaBin({ selectedProject, setFiles, uploadFiles, toast }) {
  const [mediaBinFiles, setMediaBinFiles] = useState([])

  const loadMediaBin = useCallback(async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/attachments`)
      if (res.ok) {
        const data = await res.json()
        const items = Array.isArray(data) ? data : []
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
  }, [])

  const handleMediaBinUpload = useCallback(async (fileList) => {
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
        const filesRes = await authFetch(`/api/projects/${selectedProject.id}/files`)
        if (filesRes.ok) { const d = await filesRes.json(); setFiles(Array.isArray(d) ? d : []) }
      }
    }
  }, [selectedProject, uploadFiles, setFiles, toast])

  const handleMediaBinDelete = useCallback(async (fileId) => {
    if (!selectedProject) return
    try {
      const res = await authFetch(`/api/projects/${selectedProject.id}/files/${fileId}`, { method: 'DELETE' })
      if (res.ok) {
        setMediaBinFiles(prev => prev.filter(f => f.id !== fileId))
        const filesRes = await authFetch(`/api/projects/${selectedProject.id}/files`)
        if (filesRes.ok) { const d = await filesRes.json(); setFiles(Array.isArray(d) ? d : []) }
      }
    } catch (error) {
      console.error('Error deleting media file:', error)
    }
  }, [selectedProject, setFiles])

  return {
    mediaBinFiles, setMediaBinFiles,
    loadMediaBin,
    handleMediaBinUpload,
    handleMediaBinDelete,
  }
}
