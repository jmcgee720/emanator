'use client'

import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Send, Paperclip, Loader2, Layers, Globe, Image as ImageIcon, FileText,
  X, File, FileCode, FileImage, Sparkles, Camera, GitCompare
} from 'lucide-react'
import ModelSelector from './ModelSelector'
import RecipeSelector from './RecipeSelector'
import ScopeSelector from './ScopeSelector'
import VoiceInputButton from './VoiceInputButton'
import { useToast } from '@/hooks/use-toast'
import CompareProvidersDialog from './CompareProvidersDialog'

const modeIcons = { app: Layers, website: Globe, image: ImageIcon, document: FileText }
const modeLabels = { app: 'App', website: 'Web', image: 'Image', document: 'Doc' }

const ALLOWED_EXTENSIONS = ['txt','md','json','csv','html','css','js','jsx','ts','tsx','py','sql','pdf','png','jpg','jpeg','webp','svg']
const TEXT_EXTENSIONS = ['txt','md','json','csv','html','css','js','jsx','ts','tsx','py','sql']
const IMAGE_EXTENSIONS = ['png','jpg','jpeg','webp','svg']
const MAX_TEXT_SIZE = 512 * 1024
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_PDF_SIZE = 10 * 1024 * 1024

function getFileCategory(ext) {
  if (TEXT_EXTENSIONS.includes(ext)) return 'text'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'binary'
}

function getFileIcon(ext) {
  if (IMAGE_EXTENSIONS.includes(ext)) return FileImage
  if (TEXT_EXTENSIONS.includes(ext)) return FileCode
  return File
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function validateFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `Unsupported file type: .${ext}` }
  }
  const maxSize = ext === 'pdf' ? MAX_PDF_SIZE : IMAGE_EXTENSIONS.includes(ext) ? MAX_IMAGE_SIZE : MAX_TEXT_SIZE
  if (file.size > maxSize) {
    return { valid: false, error: `File too large (${formatSize(file.size)}, max ${formatSize(maxSize)})` }
  }
  return { valid: true, ext, category: getFileCategory(ext) }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

const ChatComposer = forwardRef(function ChatComposer({
  onSend,
  disabled,
  sending,
  builderMode,
  aiProvider,
  aiModel,
  onAiProviderChange,
  onAiModelChange,
  providerStatus,
  scope,
  onScopeChange,
  onUploadFiles,
  visualMode = 'stock',
  onVisualModeChange,
  placeholder = 'Describe what you want to build...'
}, ref) {
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const { toast } = useToast()

  const appendTranscript = useCallback((text) => {
    if (!text) return
    setInput((prev) => prev ? `${prev.replace(/\s+$/, '')} ${text}` : text)
    // Re-focus so the user sees the caret and can continue editing.
    queueMicrotask(() => textareaRef.current?.focus())
  }, [])

  useImperativeHandle(ref, () => ({
    setInput: (text) => setInput(text),
    focus: () => textareaRef.current?.focus(),
    // Exposed so a parent (LeftPanel) can capture drag-and-drop on the
    // entire chat panel — not just the composer footer — and forward
    // the dropped File[] here for validation + base64 read + upload.
    // The previous UX only honoured drops onto the ~80px composer band,
    // so users dropping artwork onto the message scroll area silently
    // hit the browser's default "open file" behaviour, with no attached
    // chips appearing. Image uploads then "didn't work" mysteriously.
    attachFiles: (fileList) => {
      if (fileList && fileList.length > 0) {
        processFiles(Array.from(fileList))
      }
    },
  }))

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [input])

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [disabled])

  const processFiles = useCallback(async (fileList) => {
    const newFiles = []
    for (const file of fileList) {
      const validation = validateFile(file)
      if (!validation.valid) {
        newFiles.push({ file, name: file.name, size: file.size, error: validation.error })
        continue
      }

      try {
        let data = null
        let content = null
        let preview = null

        if (validation.category === 'text') {
          content = await readFileAsText(file)
          data = null // text sent as content, not base64
        } else {
          data = await readFileAsDataUrl(file)
          if (validation.category === 'image') {
            preview = data
          }
        }

        newFiles.push({
          file,
          name: file.name,
          size: file.size,
          ext: validation.ext,
          category: validation.category,
          mime_type: file.type,
          data,
          content,
          preview,
          error: null,
        })
      } catch {
        newFiles.push({ file, name: file.name, size: file.size, error: 'Failed to read file' })
      }
    }
    setAttachedFiles(prev => [...prev, ...newFiles])
  }, [])

  const handleFileSelect = (e) => {
    if (e.target.files?.length) {
      processFiles(Array.from(e.target.files))
    }
    e.target.value = ''
  }

  const removeFile = (index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    const hasContent = input.trim()
    const hasFiles = attachedFiles.filter(f => !f.error).length > 0
    if ((!hasContent && !hasFiles) || sending || disabled || uploading) return

    // Upload files first if any
    let uploadedAttachments = []
    if (hasFiles) {
      setUploading(true)
      try {
        const validFiles = attachedFiles.filter(f => !f.error)
        const uploadPayload = validFiles.map(f => ({
          filename: f.name,
          mime_type: f.mime_type || 'application/octet-stream',
          data: f.data || null,
          content: f.content || null,
        }))

        const result = await onUploadFiles?.(uploadPayload)
        if (result?.uploads) {
          // Merge upload server results with local file data (content, preview)
          const serverUploads = result.uploads.filter(u => u.success)
          uploadedAttachments = serverUploads.map(serverAtt => {
            const localFile = validFiles.find(f => f.name === serverAtt.filename)
            return {
              ...serverAtt,
              content: serverAtt.content || localFile?.content || null,
              preview_data: serverAtt.preview_data || localFile?.data || null,
            }
          })
        }
      } catch (err) {
        console.error('Upload failed:', err)
      } finally {
        setUploading(false)
      }
    }

    const messageText = hasContent ? input.trim() : `[Uploaded ${uploadedAttachments.length} file(s)]`
    onSend(messageText, uploadedAttachments.length > 0 ? uploadedAttachments : undefined)
    setInput('')
    setAttachedFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleRecipeSelect = (prompt) => {
    setInput(prompt)
    textareaRef.current?.focus()
  }

  // Drag-and-drop is now handled at the LeftPanel level (panel-wide drop
  // zone) and forwarded into this component via the imperative ref's
  // attachFiles() method. The previous composer-scoped onDrop/onDragOver
  // handlers called e.stopPropagation(), which prevented LeftPanel's
  // parent listener from ever seeing the drop event — leaving the
  // panel-wide "Drop to attach" overlay stuck visible forever after a
  // successful drop. Single owner = no event-bubbling fights.

  const ModeIcon = modeIcons[builderMode] || Layers
  const validFileCount = attachedFiles.filter(f => !f.error).length

  return (
    <div
      className="border-t border-[hsl(270_70%_55%/0.12)] bg-[hsl(var(--em-sidebar))] p-3"
      data-testid="chat-composer"
    >
      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2" data-testid="attached-files">
          {attachedFiles.map((f, i) => {
            const Icon = f.ext ? getFileIcon(f.ext) : File
            return (
              <div
                key={i}
                className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-xs border ${
                  f.error
                    ? 'border-red-500/20 bg-red-500/8 text-red-400'
                    : 'border-border/40 bg-muted/30 text-foreground'
                }`}
                data-testid={`attached-file-${i}`}
              >
                {f.preview ? (
                  <img src={f.preview} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                ) : (
                  <Icon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="truncate max-w-[120px]">{f.name}</span>
                <span className="text-[10px] text-muted-foreground">{formatSize(f.size)}</span>
                {f.error && <span className="text-[10px] text-red-400 truncate max-w-[100px]">{f.error}</span>}
                <button
                  onClick={() => removeFile(i)}
                  className="ml-0.5 p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                  data-testid={`remove-file-${i}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Pills bar */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Badge variant="secondary" className="text-xs gap-1 px-2 py-0.5">
          <ModeIcon className="w-3 h-3" />
          {modeLabels[builderMode] || 'App'}
        </Badge>

        <ModelSelector
          provider={aiProvider}
          model={aiModel}
          onProviderChange={onAiProviderChange}
          onModelChange={onAiModelChange}
          providerStatus={providerStatus}
        />

        <button
          onClick={() => setCompareOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50 hover:text-foreground transition-all cursor-pointer"
          title="Compare providers side-by-side on the same prompt"
          data-testid="ab-compare-trigger"
        >
          <GitCompare className="w-3 h-3" /> Compare
        </button>

        <RecipeSelector onSelectRecipe={handleRecipeSelect} />
        <ScopeSelector scope={scope} onScopeChange={onScopeChange} />

        {/* Visual Mode Toggle */}
        <button
          onClick={() => onVisualModeChange?.(visualMode === 'stock' ? 'custom' : 'stock')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
            visualMode === 'custom'
              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
              : 'bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50 hover:text-foreground'
          }`}
          title={visualMode === 'custom' ? 'Custom AI images (3x credits)' : 'Stock photos (included)'}
          data-testid="visual-mode-toggle"
        >
          {visualMode === 'custom' ? <Sparkles className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
          {visualMode === 'custom' ? 'Custom' : 'Stock'}
        </button>

        {(sending || uploading) && (
          <Badge variant="outline" className="text-xs gap-1 px-2 py-0.5 text-amber-400 border-amber-400/30">
            <Loader2 className="w-3 h-3 animate-spin" />
            {uploading ? 'Uploading...' : 'Generating...'}
          </Badge>
        )}
      </div>

      {/* Input area */}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.map(e => `.${e}`).join(',')}
          className="hidden"
          onChange={handleFileSelect}
          data-testid="file-input"
        />
        <Button
          size="icon" variant="ghost"
          className="flex-shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
          data-testid="attach-btn"
        >
          <Paperclip className="w-4 h-4" />
        </Button>

        <VoiceInputButton
          onTranscript={appendTranscript}
          onError={(msg) => toast({ title: 'Voice input', description: msg, variant: 'destructive' })}
          disabled={disabled || sending || uploading}
        />

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Create or select a project to start...' : (attachedFiles.length > 0 ? 'Add a message about the uploaded files...' : placeholder)}
            disabled={disabled || sending || uploading}
            rows={1}
            className="em-input w-full resize-none px-3.5 py-2.5 text-sm placeholder:text-muted-foreground/40 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="chat-input"
          />
        </div>

        <Button
          size="icon" onClick={handleSubmit}
          disabled={(!input.trim() && validFileCount === 0) || sending || disabled || uploading}
          className="flex-shrink-0 h-9 w-9 rounded-md em-btn-brand"
          data-testid="send-btn"
        >
          {(sending || uploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
        Enter to send · Shift+Enter for new line · Drop files to attach
      </p>

      <CompareProvidersDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        initialPrompt={input}
        onApplyLane={({ provider, model }) => {
          onAiProviderChange?.(provider)
          onAiModelChange?.(model)
        }}
      />
    </div>
  )
})

export default ChatComposer
