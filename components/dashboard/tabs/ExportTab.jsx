'use client'

import { useState, useEffect } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Globe,
  Smartphone,
  Apple,
  Archive,
  FileJson,
  Download,
  Loader2,
  CheckCircle,
  Clock
} from 'lucide-react'
import { EXPORT_TARGETS } from '@/lib/constants'

const exportIcons = {
  web: Globe,
  pwa: Smartphone,
  ios: Apple,
  android: Smartphone,
  zip: Archive,
  manifest: FileJson
}

export default function ExportTab({ project, addLog }) {
  const [exports, setExports] = useState([])
  const [exporting, setExporting] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadExports()
  }, [project.id])

  const loadExports = async () => {
    try {
      const response = await authFetch(`/api/projects/${project.id}/exports`)
      const data = await response.json()
      setExports(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error loading exports:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (exportType) => {
    setExporting(exportType)
    try {
      const response = await authFetch(`/api/projects/${project.id}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ export_type: exportType })
      })
      
      const data = await response.json()
      setExports([data, ...exports])
      
      // Handle download for completed exports
      if (data.status === 'completed' && data.artifact_data) {
        if (exportType === 'zip' && data.artifact_data.zip_base64) {
          // Download ZIP
          const link = document.createElement('a')
          link.href = `data:application/zip;base64,${data.artifact_data.zip_base64}`
          link.download = data.artifact_data.filename || `${project.name}.zip`
          link.click()
          addLog('success', `Downloaded ${data.artifact_data.filename}`)
        } else if (exportType === 'manifest') {
          // Download manifest JSON
          const blob = new Blob([JSON.stringify(data.artifact_data, null, 2)], { type: 'application/json' })
          const link = document.createElement('a')
          link.href = URL.createObjectURL(blob)
          link.download = `${project.name}-manifest.json`
          link.click()
          addLog('success', `Downloaded project manifest`)
        }
      }
      
      addLog('success', `Export ${exportType} completed`)
    } catch (error) {
      addLog('error', `Export ${exportType} failed`)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-10 border-b border-border/40 flex items-center px-4">
        <span className="text-sm text-muted-foreground">Export Project</span>
      </div>

      <ScrollArea className="flex-1 p-4">
        {/* Export Targets */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {EXPORT_TARGETS.map((target) => {
            const Icon = exportIcons[target.id] || Download
            const isExporting = exporting === target.id
            const isImplemented = target.id === 'zip' || target.id === 'manifest'
            
            return (
              <Card key={target.id} className={`relative ${!isImplemented ? 'opacity-60' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{target.name}</CardTitle>
                      <CardDescription className="text-xs">{target.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={() => handleExport(target.id)}
                    disabled={isExporting || !isImplemented}
                  >
                    {isExporting ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Exporting...</>
                    ) : isImplemented ? (
                      <><Download className="w-4 h-4 mr-2" /> Export</>
                    ) : (
                      'Coming Soon'
                    )}
                  </Button>
                </CardContent>
                {!isImplemented && (
                  <div className="absolute top-2 right-2 text-xs bg-muted px-2 py-0.5 rounded">
                    Phase 2
                  </div>
                )}
              </Card>
            )
          })}
        </div>

        {/* Export History */}
        <div>
          <h3 className="text-sm font-medium mb-3">Export History</h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : exports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exports yet</p>
          ) : (
            <div className="space-y-2">
              {exports.map((exp) => (
                <div key={exp.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/40">
                  <div className="flex items-center gap-3">
                    {exp.status === 'completed' ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Clock className="w-4 h-4 text-yellow-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium capitalize">{exp.export_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(exp.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    exp.status === 'completed' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                  }`}>
                    {exp.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
