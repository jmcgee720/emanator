'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  X,
  Search,
  FolderKanban,
  MessageSquare,
  File,
  BookOpen,
  Loader2
} from 'lucide-react'

const contentTypes = [
  { id: 'projects', name: 'Projects', icon: FolderKanban },
  { id: 'chats', name: 'Chats', icon: MessageSquare },
  { id: 'messages', name: 'Messages', icon: MessageSquare },
  { id: 'files', name: 'Files', icon: File },
]

export default function SearchPanel({ onClose, onSelectProject, onSelectChat }) {
  const [query, setQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState(['projects', 'chats', 'messages', 'files'])
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)

  const handleSearch = async () => {
    if (!query.trim() || query.length < 2) return
    
    setSearching(true)
    try {
      const response = await authFetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          content_types: selectedTypes
        })
      })
      
      const data = await response.json()
      setResults(data)
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setSearching(false)
    }
  }

  const toggleType = (typeId) => {
    if (selectedTypes.includes(typeId)) {
      setSelectedTypes(selectedTypes.filter(t => t !== typeId))
    } else {
      setSelectedTypes([...selectedTypes, typeId])
    }
  }

  const totalResults = results ? 
    (results.projects?.length || 0) + 
    (results.chats?.length || 0) + 
    (results.messages?.length || 0) + 
    (results.files?.length || 0) : 0

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-x-0 top-0 bg-background border-b border-border/50 shadow-xl shadow-black/20 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <Search className="w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search projects, chats, files..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 bg-muted/50"
              autoFocus
            />
            <Button onClick={handleSearch} disabled={searching || query.length < 2}>
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4 mt-3">
            <span className="text-sm text-muted-foreground">Search in:</span>
            {contentTypes.map((type) => (
              <label key={type.id} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedTypes.includes(type.id)}
                  onCheckedChange={() => toggleType(type.id)}
                />
                <type.icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{type.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="flex-1 max-h-[60vh]">
          <div className="p-4">
            {!results ? (
              <div className="text-center py-8">
                <Search className="w-10 h-10 mx-auto text-muted-foreground/20 mb-3" />
                <p className="text-muted-foreground">Enter a search query to find content</p>
              </div>
            ) : totalResults === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No results found for "{query}"</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Projects */}
                {results.projects?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <FolderKanban className="w-4 h-4" />
                      Projects ({results.projects.length})
                    </h3>
                    <div className="space-y-2">
                      {results.projects.map((project) => (
                        <div
                          key={project.id}
                          className="p-3 rounded-lg bg-muted/20 hover:bg-muted/35 cursor-pointer transition-colors"
                          data-testid={`search-project-${project.id}`}
                          onClick={() => onSelectProject(project)}
                        >
                          <p className="font-medium">{project.name}</p>
                          <p className="text-sm text-muted-foreground truncate">{project.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chats */}
                {results.chats?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Chats ({results.chats.length})
                    </h3>
                    <div className="space-y-2">
                      {results.chats.map((chat) => {
                        const proj = results.project_map?.[chat.project_id]
                        return (
                          <div
                            key={chat.id}
                            className="p-3 rounded-lg bg-muted/20 hover:bg-muted/35 cursor-pointer transition-colors"
                            data-testid={`search-chat-${chat.id}`}
                            onClick={() => onSelectChat?.(chat, proj)}
                          >
                            <p className="font-medium">{chat.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {proj && (
                                <button
                                  data-testid={`search-chat-project-${chat.id}`}
                                  className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                  onClick={(e) => { e.stopPropagation(); onSelectProject(proj) }}
                                >
                                  <FolderKanban className="w-3 h-3 inline mr-1" />
                                  {proj.name}
                                </button>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {new Date(chat.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Messages */}
                {results.messages?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Messages ({results.messages.length})
                    </h3>
                    <div className="space-y-2">
                      {results.messages.map((message) => {
                        const proj = results.project_map?.[message.project_id]
                        return (
                          <div
                            key={message.id}
                            className="p-3 rounded-lg bg-muted/20 hover:bg-muted/35 cursor-pointer transition-colors"
                            data-testid={`search-message-${message.id}`}
                            onClick={() => proj && onSelectProject(proj)}
                          >
                            <p className="text-sm truncate">{message.content}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {proj && (
                                <button
                                  data-testid={`search-msg-project-${message.id}`}
                                  className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                  onClick={(e) => { e.stopPropagation(); onSelectProject(proj) }}
                                >
                                  <FolderKanban className="w-3 h-3 inline mr-1" />
                                  {proj.name}
                                </button>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {message.role} • {new Date(message.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Files */}
                {results.files?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <File className="w-4 h-4" />
                      Files ({results.files.length})
                    </h3>
                    <div className="space-y-2">
                      {results.files.map((file) => {
                        const proj = results.project_map?.[file.project_id]
                        return (
                          <div
                            key={file.id}
                            className="p-3 rounded-lg bg-muted/20 hover:bg-muted/35 cursor-pointer transition-colors"
                            data-testid={`search-file-${file.id}`}
                            onClick={() => proj && onSelectProject(proj)}
                          >
                            <p className="font-medium font-mono text-sm">{file.path}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {proj && (
                                <button
                                  data-testid={`search-file-project-${file.id}`}
                                  className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                  onClick={(e) => { e.stopPropagation(); onSelectProject(proj) }}
                                >
                                  <FolderKanban className="w-3 h-3 inline mr-1" />
                                  {proj.name}
                                </button>
                              )}
                              <span className="text-xs text-muted-foreground">
                                Version {file.version} • {new Date(file.updated_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
