'use client'

import { useState, useMemo } from 'react'
import { Search, Pin, Archive, Tag, X, Plus, Trash2, Edit2, GitBranch } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

export default function CoreSystemChatList({
  chats,
  selectedChat,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onForkChat,
  onRenameChat,
  toast,
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editingTags, setEditingTags] = useState(null) // { chatId, tags: [] }
  const [tagInput, setTagInput] = useState('')

  // Extract unique tags from all chats
  const allTags = useMemo(() => {
    const tagSet = new Set()
    chats.forEach(chat => {
      const tags = chat.metadata?.tags || []
      tags.forEach(tag => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [chats])

  const [selectedTags, setSelectedTags] = useState([])

  // Filter chats by search query, tags, and archived status
  const filteredChats = useMemo(() => {
    let filtered = chats

    // Filter by archived status
    filtered = filtered.filter(chat => {
      const isArchived = chat.metadata?.archived === true
      return showArchived ? isArchived : !isArchived
    })

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(chat =>
        chat.title?.toLowerCase().includes(query)
      )
    }

    // Filter by selected tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter(chat => {
        const chatTags = chat.metadata?.tags || []
        return selectedTags.some(tag => chatTags.includes(tag))
      })
    }

    // Sort: pinned first, then by updated_at
    return filtered.sort((a, b) => {
      const aPinned = a.metadata?.pinned === true
      const bPinned = b.metadata?.pinned === true
      if (aPinned && !bPinned) return -1
      if (!aPinned && bPinned) return 1
      return new Date(b.updated_at) - new Date(a.updated_at)
    })
  }, [chats, searchQuery, selectedTags, showArchived])

  const togglePin = async (chatId, currentPinned) => {
    try {
      await authFetch(`/api/chats/${chatId}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !currentPinned }),
      })
      // Trigger parent refresh
      if (onSelectChat) onSelectChat(selectedChat)
    } catch (err) {
      toast?.({ title: 'Error', description: 'Failed to pin chat', variant: 'destructive' })
    }
  }

  const toggleArchive = async (chatId, currentArchived) => {
    try {
      await authFetch(`/api/chats/${chatId}/archive`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !currentArchived }),
      })
      // Trigger parent refresh
      if (onSelectChat) onSelectChat(selectedChat)
    } catch (err) {
      toast?.({ title: 'Error', description: 'Failed to archive chat', variant: 'destructive' })
    }
  }

  const saveTags = async (chatId, tags) => {
    try {
      await authFetch(`/api/chats/${chatId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      })
      setEditingTags(null)
      setTagInput('')
      // Trigger parent refresh
      if (onSelectChat) onSelectChat(selectedChat)
    } catch (err) {
      toast?.({ title: 'Error', description: 'Failed to save tags', variant: 'destructive' })
    }
  }

  const addTag = (chatId, currentTags) => {
    const newTag = tagInput.trim()
    if (!newTag) return
    if (currentTags.includes(newTag)) {
      setTagInput('')
      return
    }
    const updatedTags = [...currentTags, newTag]
    setEditingTags({ chatId, tags: updatedTags })
    setTagInput('')
  }

  const removeTag = (chatId, currentTags, tagToRemove) => {
    const updatedTags = currentTags.filter(t => t !== tagToRemove)
    setEditingTags({ chatId, tags: updatedTags })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-3 border-b border-[rgba(255,255,255,0.08)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--em-text-muted)]" />
          <input
            type="text"
            placeholder="Search Core System chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded-lg text-xs bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)] focus:border-[rgba(0,229,255,0.4)] focus:outline-none transition-colors placeholder:text-[var(--em-text-muted)]"
          />
        </div>
      </div>

      {/* Tag filter pills */}
      {allTags.length > 0 && (
        <div className="px-4 py-2 border-b border-[rgba(255,255,255,0.08)]">
          <div className="flex flex-wrap gap-1.5">
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => {
                  setSelectedTags(prev =>
                    prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                  )
                }}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                  selectedTags.includes(tag)
                    ? 'bg-[rgba(0,229,255,0.15)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.3)]'
                    : 'bg-[rgba(255,255,255,0.04)] text-[var(--em-text-secondary)] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)]'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Archive toggle */}
      <div className="px-4 py-2 border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between">
        <button
          onClick={() => setShowArchived(!showArchived)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.06)] transition-all"
        >
          <Archive className="w-3 h-3" />
          {showArchived ? 'Show Active' : 'Show Archived'}
        </button>
        <span className="text-[10px] text-[var(--em-text-muted)]">
          {filteredChats.length} chat{filteredChats.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--em-text-muted)]">
            {searchQuery || selectedTags.length > 0 ? 'No chats match your filters' : showArchived ? 'No archived chats' : 'No active chats'}
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {filteredChats.map(chat => {
              const isPinned = chat.metadata?.pinned === true
              const isArchived = chat.metadata?.archived === true
              const tags = chat.metadata?.tags || []
              const isEditing = editingTags?.chatId === chat.id
              const isSelected = selectedChat?.id === chat.id

              return (
                <div
                  key={chat.id}
                  className={`group relative rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-[rgba(0,229,255,0.08)] border-[rgba(0,229,255,0.25)]'
                      : 'bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.12)]'
                  }`}
                >
                  <div
                    onClick={() => onSelectChat(chat)}
                    className="px-3 py-2 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {isPinned && <Pin className="w-3 h-3 text-[var(--em-cyan)] flex-shrink-0" />}
                          <span className="text-xs font-medium text-white truncate">
                            {chat.title?.replace('⚙ Self-Edit: ', '') || 'Untitled'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePin(chat.id, isPinned)
                          }}
                          className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                          title={isPinned ? 'Unpin' : 'Pin'}
                        >
                          <Pin className={`w-3 h-3 ${isPinned ? 'text-[var(--em-cyan)]' : 'text-[var(--em-text-muted)]'}`} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingTags({ chatId: chat.id, tags })
                          }}
                          className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                          title="Edit tags"
                        >
                          <Tag className="w-3 h-3 text-[var(--em-text-muted)]" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleArchive(chat.id, isArchived)
                          }}
                          className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                          title={isArchived ? 'Unarchive' : 'Archive'}
                        >
                          <Archive className={`w-3 h-3 ${isArchived ? 'text-orange-400' : 'text-[var(--em-text-muted)]'}`} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onForkChat(chat.id)
                          }}
                          className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                          title="Fork chat"
                        >
                          <GitBranch className="w-3 h-3 text-[var(--em-text-muted)]" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const newTitle = window.prompt('Rename chat:', chat.title)
                            if (newTitle?.trim()) onRenameChat(chat.id, newTitle.trim())
                          }}
                          className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                          title="Rename"
                        >
                          <Edit2 className="w-3 h-3 text-[var(--em-text-muted)]" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm('Delete this chat?')) onDeleteChat(chat.id)
                          }}
                          className="p-1 rounded hover:bg-[rgba(255,60,60,0.2)] transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </button>
                      </div>
                    </div>

                    {/* Tags display */}
                    {!isEditing && tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tags.map(tag => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[rgba(0,229,255,0.1)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.2)]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Tag editor */}
                    {isEditing && (
                      <div className="mt-2 p-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.1)]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {editingTags.tags.map(tag => (
                            <span
                              key={tag}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[rgba(0,229,255,0.15)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.25)]"
                            >
                              {tag}
                              <button
                                onClick={() => removeTag(chat.id, editingTags.tags, tag)}
                                className="hover:text-red-400 transition-colors"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <input
                            type="text"
                            placeholder="Add tag..."
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                addTag(chat.id, editingTags.tags)
                              }
                            }}
                            className="flex-1 px-2 py-1 rounded text-[10px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)] focus:border-[rgba(0,229,255,0.4)] focus:outline-none"
                          />
                          <button
                            onClick={() => addTag(chat.id, editingTags.tags)}
                            className="px-2 py-1 rounded text-[10px] font-medium bg-[rgba(0,229,255,0.15)] text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.25)] transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex gap-1 mt-2">
                          <button
                            onClick={() => saveTags(chat.id, editingTags.tags)}
                            className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-[rgba(0,229,255,0.15)] text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.25)] transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingTags(null)
                              setTagInput('')
                            }}
                            className="flex-1 px-2 py-1 rounded text-[10px] font-medium text-[var(--em-text-secondary)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* New chat button */}
      <div className="p-3 border-t border-[rgba(255,255,255,0.08)]">
        <button
          onClick={onCreateChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-[rgba(0,229,255,0.12)] text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.2)] border border-[rgba(0,229,255,0.25)] transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          New Core System Chat
        </button>
      </div>
    </div>
  )
}
