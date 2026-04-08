import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { creditsDb, CREDIT_COSTS } from '@/lib/credits/service'

export async function handle(route, method, path, request) {
  // ============ IMAGE GENERATION (SSE) ============

  if (route.match(/^\/projects\/[^/]+\/generate-image$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    try {
      const { ImageService } = await import('@/lib/ai/image-service')
      const body = await request.json()
      const { prompt, mode, spriteOpts, size, chatId, variation } = body

      if (!prompt && !spriteOpts) {
        return handleCORS(NextResponse.json({ error: 'Prompt required' }, { status: 400 }))
      }

      // Credit pre-check before image generation
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }
      try {
        const creditBalance = await creditsDb.getBalance(dbUser.id)
        const requiredCredits = CREDIT_COSTS.image_generation || 5.0
        if (creditBalance.balance < requiredCredits) {
          return handleCORS(NextResponse.json({
            error: `You're out of credits. You need at least ${requiredCredits} credits for image generation (current balance: ${creditBalance.balance.toFixed(2)}). Tap Buy Credits to top up.`,
            credits_exhausted: true,
            balance: creditBalance.balance,
            required: requiredCredits,
          }, { status: 402 }))
        }
      } catch (creditErr) {
        console.warn('[Credits] Image credit check failed, proceeding:', creditErr.message)
      }

      const imageService = new ImageService()

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          let closed = false
          const send = (event, data) => {
            if (closed) return
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            } catch { closed = true }
          }

          try {
            const generator = imageService.generateWithProgress({
              projectId,
              prompt: prompt || '',
              mode: mode || 'image',
              spriteOpts,
              size,
              userId: authUser.id,
              chatId,
              variation: variation || undefined,
            })

            for await (const evt of generator) {
              if (evt.type === 'stage') {
                send('image_stage', { stage: evt.stage, progress: evt.progress, label: evt.label })
              } else if (evt.type === 'complete') {
                const asset = evt.asset || {}
                // Deduct credits after successful image generation
                creditsDb.deductCredits(dbUser.id, 'image_generation').catch(e =>
                  console.warn('[Credits] Post-image deduct failed:', e.message)
                )
                send('image_complete', {
                  asset: {
                    id: asset.id || null,
                    path: asset.path || null,
                    filename: asset.filename || null,
                    prompt: asset.prompt || null,
                    mode: asset.mode || null,
                    size: asset.size || null,
                    revisedPrompt: asset.revisedPrompt || null,
                    duration: asset.duration || null,
                    createdAt: asset.createdAt || null,
                    variationType: asset.variationType || null,
                    sourceAssetId: asset.sourceAssetId || null,
                    sourceAssetPath: asset.sourceAssetPath || null,
                    stateName: asset.stateName || null,
                    characterName: asset.characterName || null,
                  },
                  progress: 100,
                })
              }
            }
          } catch (err) {
            console.error('[ImageGen] Error:', err)
            // Translate raw provider errors to safe messages
            const rawMsg = (err.message || '').toLowerCase()
            let safeError = 'Image generation failed. Please try again.'
            if (rawMsg.includes('billing') || rawMsg.includes('budget') || rawMsg.includes('credit') || rawMsg.includes('quota')) {
              safeError = "You're out of credits. Tap Buy Credits to top up and keep building."
            } else if (rawMsg.includes('rate limit') || rawMsg.includes('too many')) {
              safeError = 'The AI is busy right now. Please wait a moment and try again.'
            }
            send('image_error', {
              error: safeError,
              error_type: err.error_type || 'generation_error',
            })
          }

          if (!closed) controller.close()
        }
      })

      // IMPORTANT: Raw Response with manual CORS headers — NOT handleCORS()
      const sseResponse = new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': process.env.CORS_ORIGINS || '*',
          'Access-Control-Allow-Credentials': 'true',
        }
      })
      return sseResponse
    } catch (err) {
      console.error('[ImageGen] Error:', err)
      // Never expose raw provider error messages
      const rawMsg = (err.message || '').toLowerCase()
      let safeError = 'Image generation failed. Please try again.'
      if (rawMsg.includes('billing') || rawMsg.includes('budget') || rawMsg.includes('credit') || rawMsg.includes('quota')) {
        safeError = "You're out of credits. Tap Buy Credits to top up and keep building."
      }
      return handleCORS(NextResponse.json({
        error: safeError,
        error_type: err.error_type || 'generation_error'
      }, { status: 500 }))
    }
  }

  // Get project assets
  if (route.match(/^\/projects\/[^/]+\/assets$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const files = await db.projectFiles.findByProjectId(projectId)
    const assets = files
      .filter(f => f.path?.startsWith('_generated/') || (f.path?.startsWith('_uploads/') && f.file_type === 'image'))
      .map(f => {
        const rawName = f.path.replace(/^_(?:generated|uploads)\//, '')
        const cleanName = rawName.replace(/_\d{13}\.png$/, '.png').replace(/_/g, ' ')
        return {
          id: f.id,
          path: f.path,
          filename: cleanName || rawName,
          type: f.path.startsWith('_generated/') ? 'generated' : 'uploaded',
          file_type: f.file_type,
          created_at: f.created_at,
          category: f.path.includes('sprite') ? 'sprite' :
            f.path.includes('icon') ? 'icon' :
            f.path.includes('background') || f.path.includes('bg') ? 'background' :
            f.path.includes('ui') ? 'ui' : 'image',
        }
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    return handleCORS(NextResponse.json(assets))
  }

  // Get asset relationships
  if (route.match(/^\/projects\/[^/]+\/asset-relationships$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    try {
      const file = await db.projectFiles.findByPath(projectId, '_meta/asset_relationships.json')
      const data = file?.content ? JSON.parse(file.content) : { relationships: [], characters: {} }
      return handleCORS(NextResponse.json(data))
    } catch {
      return handleCORS(NextResponse.json({ relationships: [], characters: {} }))
    }
  }

  // Get asset content
  if (route.match(/^\/projects\/[^/]+\/asset-content$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath) {
      return handleCORS(NextResponse.json({ error: 'Path required' }, { status: 400 }))
    }

    const file = await db.projectFiles.findByPath(projectId, filePath)
    if (!file) {
      return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    }

    return handleCORS(NextResponse.json({ content: file.content, path: file.path }))
  }

  // Upload files to a project
  if (route.match(/^\/projects\/[^/]+\/upload$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    try {
      const body = await request.json()
      const { files, chatId } = body

      if (!files || !Array.isArray(files) || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files provided' }, { status: 400 }))
      }

      const ALLOWED_EXTENSIONS = ['txt','md','json','csv','html','css','js','jsx','ts','tsx','py','sql','pdf','png','jpg','jpeg','webp','svg']
      const TEXT_EXTENSIONS = ['txt','md','json','csv','html','css','js','jsx','ts','tsx','py','sql']
      const IMAGE_EXTENSIONS = ['png','jpg','jpeg','webp','svg']
      const MAX_TEXT_SIZE = 512 * 1024
      const MAX_IMAGE_SIZE = 5 * 1024 * 1024
      const MAX_PDF_SIZE = 10 * 1024 * 1024

      const results = []

      for (const file of files) {
        const ext = file.filename.split('.').pop()?.toLowerCase()
        if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
          results.push({ filename: file.filename, error: `Unsupported file type: .${ext}` })
          continue
        }

        const dataSize = file.data ? Buffer.from(file.data.split(',').pop() || file.data, 'base64').length : (file.content?.length || 0)
        const maxSize = ext === 'pdf' ? MAX_PDF_SIZE : IMAGE_EXTENSIONS.includes(ext) ? MAX_IMAGE_SIZE : MAX_TEXT_SIZE
        if (dataSize > maxSize) {
          results.push({ filename: file.filename, error: `File too large (${(dataSize / 1024 / 1024).toFixed(1)}MB, max ${(maxSize / 1024 / 1024).toFixed(0)}MB)` })
          continue
        }

        const isText = TEXT_EXTENSIONS.includes(ext)
        const isImage = IMAGE_EXTENSIONS.includes(ext)
        const isPdf = ext === 'pdf'

        const storagePath = `_uploads/${Date.now()}_${file.filename}`
        let textContent = null
        let extractedText = null

        if (isText && file.content) {
          textContent = file.content
        } else if (isText && file.data) {
          const buff = Buffer.from(file.data.split(',').pop() || file.data, 'base64')
          textContent = buff.toString('utf-8')
        }

        if (isPdf && file.data) {
          try {
            const buff = Buffer.from(file.data.split(',').pop() || file.data, 'base64')
            const text = buff.toString('utf-8')
            const matches = text.match(/\(([^)]+)\)/g)
            if (matches) {
              extractedText = matches.map(m => m.slice(1, -1)).join(' ').slice(0, 50000)
            }
            if (!extractedText || extractedText.length < 20) {
              extractedText = '[PDF text extraction limited \u2014 binary PDF content]'
            }
          } catch {
            extractedText = '[PDF text could not be extracted]'
          }
        }

        const fileType = isImage ? 'image' : isPdf ? 'document' : 'code'
        const storeContent = isText ? textContent : (isImage ? file.data : (extractedText || file.data))

        const saved = await db.projectFiles.upsert(projectId, storagePath, storeContent || '', fileType)

        const attachment = {
          id: saved.id,
          filename: file.filename,
          path: storagePath,
          mime_type: file.mime_type || 'application/octet-stream',
          size: dataSize,
          file_category: isText ? 'text' : isImage ? 'image' : isPdf ? 'pdf' : 'binary',
          content: isText ? textContent : null,
          extracted_text: extractedText,
          preview_data: isImage ? file.data : null,
          has_content: !!textContent,
          uploaded_by: authUser.id,
          created_at: new Date().toISOString(),
        }

        results.push({ ...attachment, success: true })
      }

      return handleCORS(NextResponse.json({ uploads: results }))
    } catch (err) {
      console.error('[Upload] Error:', err)
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  // Get attachments for a project
  if (route.match(/^\/projects\/[^/]+\/attachments$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const files = await db.projectFiles.findByProjectId(projectId)
    const uploads = files.filter(f => f.path?.startsWith('_uploads/'))
    return handleCORS(NextResponse.json(uploads.map(f => ({
      id: f.id,
      filename: f.path.replace(/^_uploads\/\d+_/, ''),
      path: f.path,
      file_type: f.file_type,
      size: f.content?.length || 0,
      created_at: f.created_at,
    }))))
  }

  // Get attachment content by path
  if (route.match(/^\/projects\/[^/]+\/attachment-content$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath || !filePath.startsWith('_uploads/')) {
      return handleCORS(NextResponse.json({ error: 'Invalid path' }, { status: 400 }))
    }

    const file = await db.projectFiles.findByPath(projectId, filePath)
    if (!file) {
      return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    }

    return handleCORS(NextResponse.json({
      id: file.id,
      path: file.path,
      content: file.content,
      file_type: file.file_type,
    }))
  }

  return null
}
