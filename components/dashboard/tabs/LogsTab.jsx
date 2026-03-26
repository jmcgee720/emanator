'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Terminal, Trash2, Info, AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react'

const logIcons = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle
}

const logColors = {
  info: 'text-blue-400',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400'
}

export default function LogsTab({ logs }) {
  return (
    <div className="h-full flex flex-col" data-testid="logs-tab">
      {/* Toolbar */}
      <div className="h-10 border-b border-border/40 flex items-center justify-between px-4" data-testid="logs-toolbar">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground" data-testid="logs-title">Activity Logs</span>
              {logs.length > 0 && <span className="text-[10px] text-muted-foreground/60 font-mono ml-1" data-testid="logs-count">({logs.length})</span>}
        </div>
        <Button size="sm" variant="ghost" data-testid="logs-clear-btn" title="Clear all logs">
          <Trash2 className="w-4 h-4 mr-2" />
          Clear
        </Button>
      </div>

      {/* Logs */}
      <ScrollArea className="flex-1 bg-background" data-testid="logs-scroll-area">
        <div className="p-4 font-mono text-sm">
          {logs.length === 0 ? (
            <div className="text-center py-8" data-testid="logs-empty-state">
                <Terminal className="w-8 h-8 mx-auto text-muted-foreground/15 mb-2" />
                <p className="text-sm text-muted-foreground">No activity yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Logs appear here as you build, execute plans, and apply changes</p>
              </div>
          ) : (
            logs.map((log, index) => {
              const Icon = logIcons[log.type] || Info
              const colorClass = logColors[log.type] || 'text-muted-foreground'
              
              return (
                <div key={index} className="flex items-start gap-3 py-1" data-testid={`log-entry-${index}`}>
                  <span className="text-xs text-muted-foreground min-w-[80px]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <Icon className={`w-4 h-4 mt-0.5 ${colorClass}`} />
                  <span className="text-foreground">{log.message}</span>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
