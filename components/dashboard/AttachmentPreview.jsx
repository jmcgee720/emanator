'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { FileCode, FileImage, File, FileText, X, Maximize2 } from 'lucide-react'

const EXT_ICONS = {
  text: FileCode,
  code: FileCode,
  image: FileImage,
  pdf: FileText,
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ImagePreviewModal({ src, filename, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      data-testid="image-preview-modal"
    >
      <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white z-10"
          data-testid="close-image-preview"
        >
          <X className="w-4 h-4" />
        </button>
        <img src={src} alt={filename} className="max-w-full max-h-[85vh] rounded-lg object-contain" />
        <p className="text-center text-xs text-zinc-400 mt-2">{filename}</p>
      </div>
    </div>
  )
}

function TextPreviewModal({ content, filename, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      data-testid="text-preview-modal"
    >
      <div className="relative w-[80vw] max-w-3xl max-h-[80vh] bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800 border-b border-zinc-700">
          <span className="text-sm font-mono text-foreground">{filename}</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white"
            data-testid="close-text-preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <pre className="p-4 text-xs font-mono text-zinc-300 overflow-auto max-h-[70vh] whitespace-pre-wrap">
          {content}
        </pre>
      </div>
    </div>
  )
}

export function AttachmentChips({ attachments }) {
  const [previewImage, setPreviewImage] = useState(null)
  const [previewText, setPreviewText] = useState(null)

  if (!attachments?.length) return null

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mt-2" data-testid="message-attachments">
        {attachments.map((att, i) => {
          const Icon = EXT_ICONS[att.file_category] || File
          const isImage = att.file_category === 'image'

          return (
            <div
              key={i}
              className="group flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => {
                if (isImage && att.preview_data) {
                  setPreviewImage({ src: att.preview_data, filename: att.filename })
                } else if (att.content) {
                  setPreviewText({ content: att.content, filename: att.filename })
                }
              }}
              data-testid={`message-attachment-${i}`}
            >
              {isImage && att.preview_data ? (
                <img src={att.preview_data} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" />
              ) : (
                <Icon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
              )}
              <span className="text-[11px] text-foreground/80 truncate max-w-[120px]">{att.filename}</span>
              {att.size && <span className="text-[9px] text-muted-foreground">{formatSize(att.size)}</span>}
              <Maximize2 className="w-2.5 h-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
            </div>
          )
        })}
      </div>

      {previewImage && (
        <ImagePreviewModal
          src={previewImage.src}
          filename={previewImage.filename}
          onClose={() => setPreviewImage(null)}
        />
      )}

      {previewText && (
        <TextPreviewModal
          content={previewText.content}
          filename={previewText.filename}
          onClose={() => setPreviewText(null)}
        />
      )}
    </>
  )
}

export default AttachmentChips
