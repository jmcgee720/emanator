'use client'

import { useState, useEffect } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import {
  Rocket,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  Download,
  Loader2,
  Key,
  Globe,
  ArrowUpRight,
} from 'lucide-react'

export default function DeployTab({ project, addLog }) {
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [vercelToken, setVercelToken] = useState('')
  const [showVercelSetup, setShowVercelSetup] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const [netlifyToken, setNetlifyToken] = useState('')
  const [showNetlifySetup, setShowNetlifySetup] = useState(false)
  const [netlifyResult, setNetlifyResult] = useState(null)
  const [deployingNetlify, setDeployingNetlify] = useState(false)
  const [pollingIds, setPollingIds] = useState({}) // { dbId: intervalRef }

  useEffect(() => {
    loadDeployments()
    return () => {
      // Clean up polling intervals on unmount
      Object.values(pollingIds).forEach(clearInterval)
    }
  }, [project.id])

  const loadDeployments = async () => {
    try {
      const response = await authFetch(`/api/projects/${project.id}/deployments`)
      const data = await response.json()
      setDeployments(Array.isArray(data) ? data : [])
    } catch {
      setDeployments([])
    } finally {
      setLoading(false)
    }
  }

  const startPolling = (dbId, platformToken) => {
    if (!dbId || pollingIds[dbId]) return
    const interval = setInterval(async () => {
      try {
        const res = await authFetch(`/api/projects/${project.id}/deployments/${dbId}/status?token=${encodeURIComponent(platformToken)}`)
        const data = await res.json()
        if (data.status) {
          // Update the deployment in the list
          setDeployments(prev => prev.map(d => d.id === dbId ? { ...d, status: data.status, url: data.url || d.url } : d))
          // If reached terminal state, stop polling
          const terminal = ['ready', 'completed', 'success', 'error', 'failed', 'cancelled']
          if (terminal.includes((data.status || '').toLowerCase())) {
            clearInterval(interval)
            setPollingIds(prev => { const next = { ...prev }; delete next[dbId]; return next })
            if (['ready', 'completed', 'success'].includes((data.status || '').toLowerCase())) {
              addLog?.('success', `Deployment is live: ${data.url || 'URL available'}`)
            } else {
              addLog?.('error', `Deployment ${data.status}`)
            }
          }
        }
      } catch {
        // Silently retry
      }
    }, 5000) // Poll every 5 seconds
    setPollingIds(prev => ({ ...prev, [dbId]: interval }))
  }

  const handleDownloadZip = async () => {
    setDownloading(true)
    try {
      const res = await authFetch(`/api/projects/${project.id}/download`)
      const data = await res.json()
      if (!res.ok || !data.files) {
        addLog?.('error', data.error || 'No files to download')
        return
      }
      const zip = new JSZip()
      data.files.forEach(f => {
        const path = f.path.startsWith('/') ? f.path.slice(1) : f.path
        zip.file(path, f.content || '')
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      const name = (project.name || 'project').replace(/[^a-zA-Z0-9-_]/g, '-')
      saveAs(blob, `${name}.zip`)
      addLog?.('success', `Downloaded ${data.files.length} files as ZIP`)
    } catch (err) {
      addLog?.('error', `Download failed: ${err.message}`)
    } finally {
      setDownloading(false)
    }
  }

  const handleVercelDeploy = async () => {
    if (!vercelToken.trim()) return
    setDeploying(true)
    setDeployResult(null)
    try {
      const res = await authFetch(`/api/projects/${project.id}/deploy/vercel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: vercelToken, projectName: project.name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDeployResult({ error: data.error || 'Deployment failed' })
        addLog?.('error', `Vercel deploy failed: ${data.error}`)
      } else {
        setDeployResult({ url: data.url, status: data.status })
        addLog?.('success', `Deployed to Vercel: ${data.url}`)
        loadDeployments()
        // Start status polling
        if (data.db_id) startPolling(data.db_id, vercelToken)
      }
    } catch (err) {
      setDeployResult({ error: err.message })
      addLog?.('error', `Deploy error: ${err.message}`)
    } finally {
      setDeploying(false)
    }
  }

  const handleNetlifyDeploy = async () => {
    if (!netlifyToken.trim()) return
    setDeployingNetlify(true)
    setNetlifyResult(null)
    try {
      const res = await authFetch(`/api/projects/${project.id}/deploy/netlify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: netlifyToken, siteName: (project.name || 'project').toLowerCase().replace(/[^a-z0-9-]/g, '-') }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNetlifyResult({ error: data.error || 'Deployment failed' })
        addLog?.('error', `Netlify deploy failed: ${data.error}`)
      } else {
        setNetlifyResult({ url: data.url, status: data.status })
        addLog?.('success', `Deployed to Netlify: ${data.url}`)
        loadDeployments()
        // Start status polling
        if (data.db_id) startPolling(data.db_id, netlifyToken)
      }
    } catch (err) {
      setNetlifyResult({ error: err.message })
      addLog?.('error', `Deploy error: ${err.message}`)
    } finally {
      setDeployingNetlify(false)
    }
  }

  const statusBadge = (status) => {
    const s = (status || '').toLowerCase()
    if (['completed', 'success', 'ready'].includes(s)) return { bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.2)', color: '#34D399', label: 'Live', icon: <CheckCircle className="w-3 h-3" /> }
    if (['failed', 'error', 'cancelled'].includes(s)) return { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', color: '#F87171', label: 'Failed', icon: <AlertCircle className="w-3 h-3" /> }
    if (['building', 'queued', 'initializing', 'uploading', 'uploaded', 'processing'].includes(s)) return { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)', color: '#FBBF24', label: status || 'Building', icon: <Loader2 className="w-3 h-3 animate-spin" /> }
    return { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)', color: '#FBBF24', label: status || 'Pending', icon: <Clock className="w-3 h-3" /> }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="h-10 flex items-center px-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Rocket className="w-3.5 h-3.5 mr-2" style={{ color: 'var(--em-cyan)', opacity: 0.7 }} />
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--em-text-secondary)' }}>Deploy</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Deploy Options Grid */}
        <div className="grid grid-cols-3 gap-4">

          {/* Download ZIP */}
          <div
            className="group rounded-2xl p-5 transition-all duration-300 cursor-pointer hover:scale-[1.01]"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(0,229,255,0.1)',
              backdropFilter: 'blur(12px)',
            }}
            onClick={!downloading ? handleDownloadZip : undefined}
            data-testid="deploy-download-zip"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.15)' }}>
                <Download className="w-5 h-5" style={{ color: 'var(--em-cyan)' }} />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--em-text-primary)' }}>Download ZIP</h3>
                <p className="text-[10px]" style={{ color: 'var(--em-text-muted)' }}>Export all project files</p>
              </div>
            </div>
            <button
              disabled={downloading}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-40"
              style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', color: 'var(--em-cyan)' }}
              data-testid="deploy-zip-btn"
            >
              {downloading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Packaging...</> : <><Download className="w-3.5 h-3.5" /> Download</>}
            </button>
          </div>

          {/* Vercel Deploy */}
          <div
            className="group rounded-2xl p-5 transition-all duration-300"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(12px)',
            }}
            data-testid="deploy-vercel-card"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                <svg className="w-5 h-5" viewBox="0 0 76 65" fill="white"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--em-text-primary)' }}>Vercel</h3>
                <p className="text-[10px]" style={{ color: 'var(--em-text-muted)' }}>Deploy to production</p>
              </div>
            </div>

            {!showVercelSetup ? (
              <button
                onClick={() => setShowVercelSetup(true)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--em-text-secondary)' }}
                data-testid="deploy-vercel-setup-btn"
              >
                <Key className="w-3.5 h-3.5" /> Connect Vercel
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder="Vercel API Token"
                  value={vercelToken}
                  onChange={(e) => setVercelToken(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--em-text-primary)',
                  }}
                  data-testid="deploy-vercel-token-input"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleVercelDeploy}
                    disabled={deploying || !vercelToken.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-30"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'white' }}
                    data-testid="deploy-vercel-go-btn"
                  >
                    {deploying ? <><Loader2 className="w-3 h-3 animate-spin" /> Deploying...</> : <><Rocket className="w-3 h-3" /> Deploy</>}
                  </button>
                  <button
                    onClick={() => { setShowVercelSetup(false); setVercelToken(''); setDeployResult(null) }}
                    className="px-3 py-2 rounded-xl text-xs transition-all duration-200"
                    style={{ color: 'var(--em-text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[9px] leading-relaxed" style={{ color: 'var(--em-text-muted)', opacity: 0.6 }}>
                  Get your token at vercel.com/account/tokens
                </p>
              </div>
            )}

            {deployResult && (
              <div
                className="mt-3 p-2.5 rounded-lg text-[11px]"
                style={{
                  background: deployResult.error ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)',
                  border: deployResult.error ? '1px solid rgba(248,113,113,0.15)' : '1px solid rgba(52,211,153,0.15)',
                  color: deployResult.error ? '#F87171' : '#34D399',
                }}
                data-testid="deploy-result"
              >
                {deployResult.error ? (
                  <span>{deployResult.error}</span>
                ) : (
                  <a href={deployResult.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-medium">
                    <Globe className="w-3 h-3" />
                    {deployResult.url}
                    <ArrowUpRight className="w-3 h-3 ml-auto" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Netlify Deploy */}
          <div
            className="group rounded-2xl p-5 transition-all duration-300"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' }}
            data-testid="deploy-netlify-card"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,210,184,0.08)', border: '1px solid rgba(0,210,184,0.15)' }}>
                <svg className="w-5 h-5" viewBox="0 0 256 256" fill="none"><path d="M128 0L256 128L128 256L0 128L128 0Z" fill="#00D2B8" opacity="0.8" /><path d="M128 40L216 128L128 216L40 128L128 40Z" fill="white" opacity="0.3" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--em-text-primary)' }}>Netlify</h3>
                <p className="text-[10px]" style={{ color: 'var(--em-text-muted)' }}>Static deploy</p>
              </div>
            </div>

            {!showNetlifySetup ? (
              <button
                onClick={() => setShowNetlifySetup(true)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--em-text-secondary)' }}
                data-testid="deploy-netlify-setup-btn"
              >
                <Key className="w-3.5 h-3.5" /> Connect Netlify
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder="Netlify API Token"
                  value={netlifyToken}
                  onChange={(e) => setNetlifyToken(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--em-text-primary)' }}
                  data-testid="deploy-netlify-token-input"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleNetlifyDeploy}
                    disabled={deployingNetlify || !netlifyToken.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-30"
                    style={{ background: 'rgba(0,210,184,0.08)', border: '1px solid rgba(0,210,184,0.2)', color: '#00D2B8' }}
                    data-testid="deploy-netlify-go-btn"
                  >
                    {deployingNetlify ? <><Loader2 className="w-3 h-3 animate-spin" /> Deploying...</> : <><Rocket className="w-3 h-3" /> Deploy</>}
                  </button>
                  <button
                    onClick={() => { setShowNetlifySetup(false); setNetlifyToken(''); setNetlifyResult(null) }}
                    className="px-3 py-2 rounded-xl text-xs transition-all duration-200"
                    style={{ color: 'var(--em-text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[9px] leading-relaxed" style={{ color: 'var(--em-text-muted)', opacity: 0.6 }}>
                  Get your token at app.netlify.com/user/applications
                </p>
              </div>
            )}

            {netlifyResult && (
              <div className="mt-3 p-2.5 rounded-lg text-[11px]" style={{
                background: netlifyResult.error ? 'rgba(248,113,113,0.06)' : 'rgba(0,210,184,0.06)',
                border: netlifyResult.error ? '1px solid rgba(248,113,113,0.15)' : '1px solid rgba(0,210,184,0.15)',
                color: netlifyResult.error ? '#F87171' : '#00D2B8',
              }} data-testid="netlify-deploy-result">
                {netlifyResult.error ? (
                  <span>{netlifyResult.error}</span>
                ) : (
                  <a href={netlifyResult.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-medium">
                    <Globe className="w-3 h-3" />{netlifyResult.url}<ArrowUpRight className="w-3 h-3 ml-auto" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Deployment History */}
        <div>
          <h3 className="text-[11px] uppercase tracking-widest font-bold mb-3" style={{ color: 'var(--em-text-muted)' }}>Deployment History</h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--em-text-muted)', opacity: 0.3 }} />
            </div>
          ) : deployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12" data-testid="deploy-history-empty">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <Rocket className="w-5 h-5" style={{ color: 'var(--em-text-muted)', opacity: 0.25 }} />
              </div>
              <p className="text-xs font-medium" style={{ color: 'var(--em-text-muted)' }}>No deployments yet</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--em-text-muted)', opacity: 0.5 }}>Deploy your project to see it here</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="deploy-history-list">
              {deployments.map((dep) => {
                const badge = statusBadge(dep.status)
                return (
                  <div
                    key={dep.id || dep.deployment_id}
                    className="flex items-center justify-between p-3 rounded-xl transition-all duration-200"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                    data-testid={`deployment-item-${dep.id || dep.deployment_id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: badge.bg, border: `1px solid ${badge.border}` }}>
                        {dep.platform === 'vercel' ? (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 76 65" fill="white"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z" /></svg>
                        ) : (
                          <Download className="w-3.5 h-3.5" style={{ color: badge.color }} />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold capitalize" style={{ color: 'var(--em-text-primary)' }}>{dep.platform}</p>
                        <p className="text-[10px]" style={{ color: 'var(--em-text-muted)', opacity: 0.6 }}>
                          {dep.created_at ? new Date(dep.created_at).toLocaleString() : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {dep.url && (
                        <a
                          href={dep.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all duration-200"
                          style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.12)', color: 'var(--em-cyan)' }}
                          data-testid={`deployment-link-${dep.id || dep.deployment_id}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                          Visit
                        </a>
                      )}
                      <span
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold"
                        style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color }}
                      >
                        {badge.icon} {badge.label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
