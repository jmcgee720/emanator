'use client'

import { useState, useEffect } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Rocket,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react'

export default function DeployTab({ project, addLog }) {
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDeployments()
  }, [project.id])

  const loadDeployments = async () => {
    try {
      const response = await authFetch(`/api/projects/${project.id}/deployments`)
      const data = await response.json()
      setDeployments(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error loading deployments:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeploy = async (platform) => {
    addLog('info', `Deployment to ${platform} is not yet available. Coming in Phase 2.`)
  }

  const statusIcon = (status) => {
    switch (status) {
      case 'completed':
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'pending':
      case 'building':
        return <Clock className="w-4 h-4 text-yellow-500" />
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-10 border-b border-border/40 flex items-center px-4">
        <span className="text-sm text-muted-foreground">Deploy Project</span>
      </div>

      <ScrollArea className="flex-1 p-4">
        {/* Deploy Targets */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 76 65" fill="currentColor">
                    <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">Vercel</CardTitle>
                  <CardDescription className="text-xs">Deploy to Vercel</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                disabled
              >
                <Rocket className="w-4 h-4 mr-2" /> Not Yet Available
              </Button>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Integration coming in Phase 2
              </p>
            </CardContent>
          </Card>

          <Card className="opacity-50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">Netlify</CardTitle>
                  <CardDescription className="text-xs">Deploy to Netlify</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" disabled>
                Coming Soon
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Deployment History */}
        <div>
          <h3 className="text-sm font-medium mb-3">Deployment History</h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : deployments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deployments yet</p>
          ) : (
            <div className="space-y-2">
              {deployments.map((deployment) => (
                <div key={deployment.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/40">
                  <div className="flex items-center gap-3">
                    {statusIcon(deployment.status)}
                    <div>
                      <p className="text-sm font-medium capitalize">{deployment.platform}</p>
                      <p className="text-xs text-muted-foreground">
                        {deployment.created_at ? new Date(deployment.created_at).toLocaleString() : 'Unknown date'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {deployment.url && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={deployment.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </Button>
                    )}
                    <span className={`text-xs px-2 py-1 rounded ${
                      deployment.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                      deployment.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                      'bg-yellow-500/10 text-yellow-500'
                    }`}>
                      {deployment.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
