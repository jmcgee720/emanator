/**
 * Stream Handler v2 — Emergent-style agent loop.
 *
 * Wires /lib/ai/agent-core.js to the existing SSE/credit/persistence
 * infrastructure. No modes, no policing, no detectors. The model uses
 * tools when it decides to and emits a text-only response when done.
 *
 * Feature flag: this is a SEPARATE endpoint
 * (POST /api/chats/:chatId/messages/stream-v2). The legacy v1 endpoint
 * remains unchanged. Frontend opts in by hitting this URL.
 *
 * SCOPE (Phase 1):
 *   - Self-edit chats: scoped to /app with sensible excludes (Core System).
 *   - Project chats: NOT YET — returns 501. Migration in Step 4.
 */

import { NextResponse } from 'next/server'
import { runAgent } from '@/lib/ai/agent-core'
import { buildDefaultToolset } from '@/lib/ai/agent-tools-v2'
import { detectCodebaseRoot } from '@/lib/ai/codebase-root'
import { buildGithubWriter, buildGithubReader, buildMissingConfigWriter } from '@/lib/ai/github-writer'
import { buildProjectFs } from '@/lib/ai/project-fs'
import { createProvider } from '@/lib/ai/providers/index'
import { SELF_EDIT_PREFIX, getUserRole, hasPermission, isMonitored } from '@/lib/constants'
import { creditsDb, estimateRequestCost } from '@/lib/credits/service'
import { notifyPreviewOfFileChange } from '@/lib/fly/notify-preview'

function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

/** Project-mode system prompt — for editing user project files (not the Auroraly source). */
function buildProjectSystemPrompt(env) {
  return [
    `You are Auroraly's project agent. You are working inside the user's project "${env.projectName || env.projectId}".`,
    '',
    `READS / WRITES: All file operations target the project's files in the database. read_file / write_file / edit_file / delete_file / list_files / search_files operate on this project ONLY. Changes appear in the live preview within a few seconds.`,
    '',
    'Tools available:',
    '  • read_file       — read a project file (returns line-numbered content)',
    '  • write_file      — create a new file or completely overwrite an existing one',
    '  • edit_file       — replace exact unique text in an existing file (preferred for surgical edits)',
    '  • delete_file     — permanently remove a file from the project (use for unwanted files like a crashing middleware.js)',
    '  • search_files    — search the project for a pattern',
    '  • list_files      — find project files by name pattern',
    '',
    'Use tools whenever you need real information. If the user reports a bug or error, READ the relevant files first to understand the actual code before proposing changes. Make targeted edits with edit_file using exact text that is unique in the file.',
    '',
    'WHEN THE USER ASKS TO SEE A FILE: After calling read_file, the full file contents are ALREADY rendered to the user inline (verbatim, with line numbers). You do NOT need to re-paste them. Just answer the user\'s question about the file (e.g. "yes, tailwindcss is missing from devDependencies" or "the import on line 12 is what\'s causing the crash"). If they only asked to see it with no follow-up question, a one-sentence acknowledgement is fine ("Above is package.json — let me know what you\'d like to change."). Never end your turn with empty text after a read_file call — always produce SOME response.',
    '',
    'WHEN THE USER ATTACHES IMAGES: You CAN see them — they are passed to you as native vision blocks (claude vision). Before doing anything else with attached images, you MUST:',
    '  1. INVENTORY FIRST. For every image attached, describe what you actually see in plain language (subject, pose/expression, dominant colors, distinctive features, approximate dimensions if obvious, whether the background is transparent). Use the user\'s filename as a label ("attachment 1: mama_happy.png — short Italian grandma in red apron, arms raised, smiling, white background"). Number them in order.',
    '  2. CONFIRM, DO NOT GUESS. If the user has assigned a slot/label to an image ("this is mama_win"), confirm whether what you see actually matches that role before saving. If the visual evidence contradicts the user\'s label, say so explicitly and ask which to trust. If the user did NOT label an image, propose a slot based on what you see and ASK before saving — never silently substitute or invent metadata.',
    '  3. NEVER FABRICATE. Do not reference details, characters, colors, or filenames that are not in the inventory you just produced. If an image is blurry, cropped, or you cannot identify it, say "I cannot identify this image clearly" and ask the user for the intended slot.',
    '  4. ONLY THEN ACT. After the inventory + confirmation step, proceed with file saves / code edits. When the user has uploaded BINARY files (images, PDFs, sprites, audio, etc.), you MUST use the `save_attachment_to_path` tool — NOT `write_file`. `write_file` only accepts text strings and will silently truncate a PNG to a few useless bytes (the model used to fail by writing "I cannot save binary" as the file content). `save_attachment_to_path` takes an attachment_index (or attachment_filename) plus a destination path; it routes the base64-encoded binary straight into the project file store, and the Fly preview runner decodes it back to disk during the next sync. After saving, mention the saved path so the user can verify.',
    '',
    'ABSOLUTE PROHIBITION: NEVER tell the user "I cannot save binary files" or "the write_file tool only accepts text". That response is OBSOLETE — the platform now ships a binary-safe tool called `save_attachment_to_path`. If you do not see it in your tool list, list your tools out loud and proceed with what you have. If you see it, USE IT for every binary the user has attached. Do not suggest "manual upload" or "FTP/SSH access" as a workaround — those are dead ends and frustrate the user.',
    'This rule exists because the agent can otherwise hallucinate filenames, save the wrong art to the wrong slot, and silently break the user\'s preview. Visible-pixels-only is non-negotiable.',
    '',
    'HARD RULES (violating these is a security incident — do not):',
    '  1. NEVER touch the Auroraly source code (anything under /app, lib/, components/, package.json, supabase/, etc.). You operate ONLY on this user project. If the user asks you to edit Auroraly itself, tell them to open a Core System chat — you cannot do it here.',
    '  2. NEVER run `curl`, `wget`, `fetch`, or any other HTTP client against GitHub, Supabase, Vercel, Anthropic, OpenAI, or any other API. You do not have a `run_command` tool in project mode — your file tools are the only way to make changes, and they already use server-side credentials.',
    '  3. NEVER write, log, or echo any credential, API key, access token, service-role key, or `Authorization` header into a file, response, or shell. Treat every secret as classified.',
    '',
    'Respond with text only when you are finished. The user wants short, concrete answers (specific file paths, line numbers, what you changed and why). Do NOT ask the user questions you can answer yourself by reading the files.',
  ].join('\n')
}

/** Build a clean, minimal system prompt — NO policing, NO forbidden patterns. */
function buildSelfEditSystemPrompt(env) {
  const fsSummary = env.readerKind === 'github'
    ? `READS: read_file / list_files / search_files all operate on the live GitHub repo ${env.repo}@${env.branch}. The serverless filesystem at ${env.root} contains only a tree-shaken bundle and is NOT the source — always use the tools (never trust raw paths under /var/task).`
    : `READS: read_file / list_files / search_files operate on the local filesystem rooted at ${env.root}.`
  const writeMode = env.writerKind === 'github'
    ? `WRITES: write_file, edit_file, and delete_file commit directly to ${env.repo}@${env.branch} via GitHub. Each edit triggers a Vercel redeploy (~2 minutes).`
    : env.writerKind === 'missing-config'
      ? 'WRITES: this environment requires GitHub-backed writes but GITHUB_TOKEN / GITHUB_REPO are not configured. Calls to write_file / edit_file / delete_file will return setup instructions. Reads still work.'
      : 'WRITES: write_file, edit_file, and delete_file modify the local filesystem at the codebase root.'
  return [
    'You are Auroraly\'s self-edit agent ("Core System mode"). You can read, search, edit, and run commands on the Auroraly source tree.',
    '',
    fsSummary,
    writeMode,
    '',
    'Tools available:',
    '  • read_file       — read a file (returns line-numbered content)',
    '  • write_file      — create a new file or completely overwrite an existing one',
    '  • edit_file       — replace exact unique text in an existing file',
    '  • run_command     — run a shell command on the runtime (NOT the source tree on serverless)',
    '  • search_files    — search the codebase for a pattern',
    '  • list_files      — find files by name pattern',
    '',
    'Use tools whenever you need real information. If you do not know where a file lives, call list_files or search_files. If you need to see code before changing it, call read_file. Edit using edit_file with unique exact text.',
    '',
    'HARD RULES (violating these is a security incident — do not):',
    '  1. SCOPE: You operate ONLY on the Auroraly source tree. You CANNOT and MUST NOT read or write files in any user project (Nexsara, Mangia Mama, etc.) — those live in a separate Supabase database and have their own chat sessions. If the user asks you to fix something in their project, tell them to open the chat for that project.',
    '  2. NO RAW HTTP: NEVER run `curl`, `wget`, or any other HTTP client against GitHub, Supabase, Vercel, Anthropic, OpenAI, or any other API. Your read_file / write_file / edit_file / search_files tools already use server-side credentials. Calling these APIs by hand is wrong, slow, and exposes secrets to the chat transcript.',
    '  3. NO CREDENTIALS IN COMMANDS: NEVER paste a GitHub PAT, Supabase service-role key, API key, JWT, or `Authorization: Bearer …` value into a `run_command` invocation, a file, or your text response. The runtime auto-rejects commands containing token-shaped strings; getting blocked by the guard means you tried to leak a secret.',
    '',
    'Respond with text only when you are finished — when there is no further tool call to make. The user is technical and prefers short, concrete answers (specific file paths, line numbers, what you changed and why).',
  ].join('\n')
}

function buildSelfEditScope(root) {
  return {
    rootDirs: [root],
    excludePaths: [
      root + '/node_modules',
      root + '/.next',
      root + '/.git',
      root + '/.emergent',
      root + '/.vercel',
    ],
    maxFileBytes: 200 * 1024,
    execTimeoutMs: 20_000,
  }
}

/**
 * Cap inlined attachment text so a single upload can't blow the context
 * window. ~30k chars ≈ 7.5k tokens worst case — well within budget per file.
 */
const ATTACHMENT_TEXT_CHAR_CAP = 30_000

/**
 * Convert a single attachment record into an Anthropic content block.
 * Returns null when the attachment can't be represented (e.g. missing data).
 * Supports image (vision), text/code (inline), and pdf (extracted text).
 */
function attachmentToContentBlock(att, tag = 'StreamV2') {
  if (!att) return null
  const isImage =
    att.file_category === 'image' ||
    att.type?.startsWith('image/') ||
    att.mime_type?.startsWith('image/')
  if (isImage) {
    const imageData = att.preview_data || att.data
    if (!imageData) return null
    const m = imageData.match(/^data:image\/([^;]+);base64,(.+)$/)
    if (!m) {
      console.warn(`[${tag}] attachment image not a data URL:`, att.filename)
      return null
    }
    return {
      type: 'image',
      source: { type: 'base64', media_type: `image/${m[1]}`, data: m[2] },
    }
  }
  // Text / code attachments — inline the file content as a text block.
  if (att.file_category === 'text' || att.mime_type?.startsWith('text/')) {
    const body = att.content || att.extracted_text
    if (!body) return null
    const trimmed = String(body).slice(0, ATTACHMENT_TEXT_CHAR_CAP)
    const note = body.length > ATTACHMENT_TEXT_CHAR_CAP ? `\n\n[…truncated at ${ATTACHMENT_TEXT_CHAR_CAP} chars]` : ''
    return {
      type: 'text',
      text: `### Uploaded file: ${att.filename || att.path || 'attachment'} (${att.mime_type || 'text'})\n\`\`\`\n${trimmed}${note}\n\`\`\``,
    }
  }
  // PDF — use server-extracted text if available.
  if (att.file_category === 'pdf') {
    const body = att.extracted_text || att.content
    if (!body) return null
    const trimmed = String(body).slice(0, ATTACHMENT_TEXT_CHAR_CAP)
    const note = body.length > ATTACHMENT_TEXT_CHAR_CAP ? `\n\n[…truncated at ${ATTACHMENT_TEXT_CHAR_CAP} chars]` : ''
    return {
      type: 'text',
      text: `### Uploaded PDF: ${att.filename || 'document.pdf'}\nExtracted text:\n${trimmed}${note}`,
    }
  }
  return null
}

/**
 * Format a user message + its attachments as Anthropic content. Returns a
 * string when there are no attachments, otherwise an array of content blocks.
 */
function buildUserContent(textContent, attachments, tag = 'StreamV2') {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return textContent
  }
  const blocks = []
  for (const att of attachments) {
    const b = attachmentToContentBlock(att, tag)
    if (b) blocks.push(b)
  }
  // No attachments produced usable blocks → just send the original text.
  // Wrapping a single text block in an array works but adds noise to the
  // wire format and to history, so prefer plain string when possible.
  if (blocks.length === 0) return textContent
  if (textContent && textContent.length > 0) {
    blocks.push({ type: 'text', text: textContent })
  }
  return blocks
}

/**
 * Build prior messages from the chat history for the agent.
 * Strips assistant tool-call metadata since v2 reconstructs its own.
 * Converts image / text / pdf attachments into Anthropic content blocks.
 */
async function loadPriorMessages(db, chatId, currentUserMessageId) {
  try {
    const rows = await db.messages.findByChatId(chatId)
    const prior = (rows || [])
      .filter((m) => m.id !== currentUserMessageId)
      .filter((m) => !m.metadata?.silent)
      .slice(-40) // last 40 turns for better memory retention
      .map((m) => {
        const textContent = typeof m.content === 'string' ? m.content : String(m.content || '')

        // User messages with attachments → content blocks (image + text + pdf)
        if (m.role === 'user' && m.metadata?.attachments && Array.isArray(m.metadata.attachments) && m.metadata.attachments.length > 0) {
          const content = buildUserContent(textContent, m.metadata.attachments, 'StreamV2/history')
          if (Array.isArray(content) && content.length > 0) {
            return { role: 'user', content }
          }
        }

        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: textContent,
        }
      })
      .filter((m) => {
        if (Array.isArray(m.content)) return m.content.length > 0
        return m.content && m.content.length > 0
      })
    return prior
  } catch (e) {
    // Loud failure so future regressions appear in Vercel logs immediately.
    console.error('[StreamV2] loadPriorMessages FAILED — agent will run with no memory:', e?.message, e?.stack)
    return []
  }
}

/**
 * Main handler. Mirrors v1's auth/credit shell but delegates the actual
 * agent loop to /lib/ai/agent-core.js.
 */
export async function handleStreamMessageV2(request, { chatId, authUser: _authUser, dbUser, db }) {
  const body = await request.json()
  const { content, metadata = {} } = body
  const isSilent = metadata.silent === true

  if (!content) {
    return handleCORS(NextResponse.json({ error: 'Content required' }, { status: 400 }))
  }

  const chat = await db.chats.findById(chatId)
  if (!chat) {
    return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
  }

  // Conversation lock
  if (metadata.projectId && metadata.projectId !== chat.project_id) {
    return handleCORS(NextResponse.json({ error: 'Chat belongs to a different project. Confirm project context.' }, { status: 403 }))
  }

  // Permission gates (mirror v1)
  if (isMonitored(getUserRole(dbUser)) && chat.title?.startsWith(SELF_EDIT_PREFIX)) {
    return handleCORS(NextResponse.json({ error: 'Monitored accounts cannot use self-edit chats' }, { status: 403 }))
  }
  const isSelfEdit = chat.title?.startsWith(SELF_EDIT_PREFIX)
  if (isSelfEdit && !hasPermission(getUserRole(dbUser), 'self_edit')) {
    return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
  }

  // For project chats, ensure we actually have a project to operate on.
  let project = null
  if (!isSelfEdit) {
    if (!chat.project_id) {
      return handleCORS(NextResponse.json({ error: 'Chat is not linked to a project' }, { status: 400 }))
    }
    project = await db.projects.findById(chat.project_id)
    if (!project) {
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }
  }

  // Persist the user message before streaming (mirrors v1)
  const userMessage = await db.messages.create({
    chat_id: chatId,
    project_id: chat.project_id,
    role: 'user',
    content: metadata.displayContent || content,
    metadata: { ...metadata, ...(isSilent ? { silent: true, full_content: content } : {}), agent_version: 'v2' },
  })
  await db.chats.update(chatId, { updated_at: new Date().toISOString() })

  // Pick provider + model — default to Claude Sonnet 4.5 for self-edit
  const providerName = metadata.provider || 'anthropic'
  const modelName = metadata.model || (providerName === 'anthropic' ? 'claude-sonnet-4-5-20250929' : 'gpt-4o')
  const apiKey = providerName === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : providerName === 'openai'
      ? process.env.OPENAI_API_KEY
      : (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)

  if (!apiKey) {
    return handleCORS(NextResponse.json({
      error: `No API key configured for provider "${providerName}"`,
    }, { status: 500 }))
  }

  // Credit pre-check
  const estimatedCost = estimateRequestCost(modelName, metadata.visualMode)
  let creditBalance = null
  try {
    creditBalance = await creditsDb.getBalance(dbUser.id)
  } catch (e) {
    console.warn('[StreamV2] balance check failed, proceeding:', e?.message)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: keepalive\ndata: {}\n\n`))
        } catch {
          closed = true
          clearInterval(heartbeat)
        }
      }, 8000)

      const send = (event, data) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      const finish = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        try { controller.close() } catch {}
      }

      // Surface user message immediately (mirrors v1 UX)
      if (!isSilent) {
        send('user_message', { id: userMessage.id, content: userMessage.content, created_at: userMessage.created_at })
      }

      // Credit exhaustion: short-circuit
      if (creditBalance && creditBalance.balance < estimatedCost && !isSilent) {
        const upsellContent = `I'd love to help, but you're out of credits. You need at least **${estimatedCost}** credits for this request (current balance: **${creditBalance.balance.toFixed(2)}**).\n\nTap **Buy Credits** to top up and keep building!`
        const upsellMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: upsellContent,
          metadata: { credits_exhausted: true, required: estimatedCost, balance: creditBalance.balance, streamed: true, agent_version: 'v2' },
        })
        send('token', { content: upsellContent })
        send('credits_exhausted', { balance: creditBalance.balance, required: estimatedCost, messageId: upsellMessage.id })
        send('done', { content: upsellContent, messageId: upsellMessage.id, credits_exhausted: true })
        send('message_saved', { id: upsellMessage.id, credits_exhausted: true })
        return finish()
      }

      send('status', { stage: 'agent_starting', detail: 'Starting v2 agent…' })

      let scope, writer, reader, writerKind, systemPrompt
      const detected = detectCodebaseRoot()

      if (isSelfEdit) {
        // ── Self-edit (Core System) — operates on Auroraly's own source ──
        scope = buildSelfEditScope(detected.root)
        writer = null
        reader = null
        writerKind = 'fs'
        if (!detected.isPersistent) {
          const ghWriter = buildGithubWriter()
          const ghReader = buildGithubReader()
          if (ghWriter && ghReader) {
            writer = ghWriter
            reader = ghReader
            writerKind = 'github'
          } else {
            const missing = []
            if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN')
            if (!process.env.GITHUB_REPO) missing.push('GITHUB_REPO')
            writer = buildMissingConfigWriter(missing)
            reader = null
            writerKind = 'missing-config'
          }
        }
        systemPrompt = buildSelfEditSystemPrompt({
          root: detected.root,
          writerKind,
          readerKind: reader ? 'github' : 'fs',
          repo: writer?.repo || reader?.repo,
          branch: writer?.branch || reader?.branch,
        })
        console.log('[StreamV2] mode=self-edit env:', { root: detected.root, source: detected.source, isPersistent: detected.isPersistent, writerKind })
        send('status', {
          stage: 'env_detected',
          detail: `Mode: self-edit · Root: ${detected.root} · reads: ${reader ? `${reader.repo}@${reader.branch} via GitHub` : 'local filesystem'} · writes: ${writerKind === 'fs' ? 'local filesystem' : writerKind === 'github' ? `${writer.repo}@${writer.branch} via GitHub` : 'NOT CONFIGURED (read-only)'}`,
        })
      } else {
        // ── Project mode — operates on user-project files in Supabase ──
        const projectFs = buildProjectFs({ db, projectId: chat.project_id, projectName: project?.name })
        if (!projectFs) {
          send('error', { message: 'Failed to initialize project file adapter', error_type: 'project_fs_init' })
          return finish()
        }
        // Scope is nominal (we never touch the disk in project mode) but tools
        // expect a scope object — use the project root as a sentinel.
        scope = { rootDirs: ['/project-' + chat.project_id], excludePaths: [] }
        writer = projectFs
        reader = projectFs
        writerKind = 'project-fs'
        systemPrompt = buildProjectSystemPrompt({
          projectId: chat.project_id,
          projectName: project?.name,
        })
        console.log('[StreamV2] mode=project env:', { projectId: chat.project_id, projectName: project?.name })
        send('status', {
          stage: 'env_detected',
          detail: `Mode: project "${project?.name || chat.project_id}" · all reads/writes go to project files`,
        })
      }

      // Build provider + tools
      let provider
      try {
        provider = createProvider(providerName, apiKey, modelName, {})
      } catch (e) {
        send('error', { message: 'Provider init failed: ' + (e?.message || 'unknown'), error_type: 'provider_init' })
        return finish()
      }
      const tools = buildDefaultToolset(scope, writer, reader, metadata.attachments)
      // Surface in Vercel logs so we can confirm save_attachment_to_path
      // is actually being exposed to the model on attachment turns. If
      // the user reports "agent says it can't save binaries" but this
      // log shows save_attachment_to_path=true, the model is ignoring
      // the tool and we need a stricter system prompt (not a wiring fix).
      console.log('[StreamV2] tools exposed:', {
        count: tools.length,
        names: tools.map((t) => t.name),
        hasAttachments: Array.isArray(metadata.attachments) ? metadata.attachments.length : 0,
        saveAttachmentToolPresent: tools.some((t) => t.name === 'save_attachment_to_path'),
      })
      // Project mode: run_command is not meaningful (no shell on the project
      // files in the DB). Filter it out so the model can't waste turns.
      const effectiveTools = isSelfEdit ? tools : tools.filter((t) => t.name !== 'run_command')
      const priorMessages = await loadPriorMessages(db, chatId, userMessage.id)

      // Format current user message with attachments (if any) for vision +
      // text/pdf support. Shared helper keeps history + current path in sync.
      let currentUserMessage = content
      if (metadata.attachments && Array.isArray(metadata.attachments) && metadata.attachments.length > 0) {
        const built = buildUserContent(content, metadata.attachments, 'StreamV2/current')
        if (Array.isArray(built)) {
          const imageCount = built.filter((b) => b.type === 'image').length
          const textBlockCount = built.filter((b) => b.type === 'text').length
          console.log('[StreamV2] attachments → content blocks:', { total: metadata.attachments.length, images: imageCount, textBlocks: textBlockCount })
          currentUserMessage = built
        } else {
          console.warn('[StreamV2] attachments present but no content blocks produced. Filenames:', metadata.attachments.map((a) => a.filename))
        }
      }

      // Stream the agent loop
      let fullContent = ''
      let toolEventCount = 0
      let errored = false

      // Format tool arguments for inline visibility — keep it compact,
      // NEVER fall back to raw JSON (which feels like the AI is dumping code
      // at the user). Unknown args render as just an arg count.
      const summarizeArgs = (args) => {
        try {
          if (!args || typeof args !== 'object') return ''
          if (args.path) return ` ${args.path}`
          if (args.name_pattern) return ` "${args.name_pattern}"`
          if (args.pattern) return ` "${args.pattern}"`
          if (args.command) return ` ${String(args.command).slice(0, 80)}`
          if (args.old_str) return ' (edit)'
          const keys = Object.keys(args)
          if (keys.length === 0) return ''
          return ` (${keys.length} arg${keys.length === 1 ? '' : 's'})`
        } catch { return '' }
      }
      const summarizeResult = (content) => {
        const s = typeof content === 'string' ? content : String(content || '')
        const firstLine = s.split('\n').find((l) => l.trim().length > 0) || ''
        const trimmed = firstLine.slice(0, 120)
        const total = s.length
        return total > trimmed.length ? `${trimmed} … (${total} chars)` : trimmed
      }

      // Track tool_use args by id so we can pair them with their
      // tool_result (used to emit files_saved after successful project
      // writes — which is what makes the preview iframe refresh).
      const pendingToolArgs = new Map()

      try {
        for await (const ev of runAgent({
          provider,
          systemPrompt,
          userMessage: currentUserMessage,
          priorMessages,
          tools: effectiveTools,
          maxIterations: 25,
        })) {
          if (closed) break
          if (ev.type === 'text_delta') {
            fullContent += ev.content
            send('token', { content: ev.content })
          } else if (ev.type === 'tool_use') {
            toolEventCount++
            pendingToolArgs.set(ev.id, { name: ev.name, args: ev.args })
            // Make tool calls VISIBLE inline as markdown blockquotes so the
            // user can see what the agent is actually doing instead of
            // staring at disconnected narration.
            const inline = `\n\n> 🔧 **${ev.name}**${summarizeArgs(ev.args)}\n\n`
            fullContent += inline
            send('token', { content: inline })
            send('status', { stage: 'tool_use', detail: `${ev.name}${summarizeArgs(ev.args)}` })
            send('tool_use', { name: ev.name, id: ev.id, args: ev.args })
          } else if (ev.type === 'tool_result') {
            // For read_file: render the FULL file content inline so the
            // user can actually see it (Emergent-style). Without this,
            // Claude saw the file via the tool result, assumed the user
            // saw it too (they didn't — UI was showing only the summary),
            // and ended the turn without re-pasting. Showing the full
            // content here removes the ambiguity entirely.
            //
            // For all other tools, keep the compact summary so the chat
            // isn't spammed with raw command output.
            const pendingForResult = pendingToolArgs.get(ev.id)
            const isReadFile = pendingForResult?.name === 'read_file'
            const inline = isReadFile
              ? `> ↳ ${pendingForResult?.args?.path || 'file'}\n\n${ev.content}\n\n`
              : `> ↳ ${summarizeResult(ev.content)}\n\n`
            fullContent += inline
            send('token', { content: inline })
            send('tool_result', { name: ev.name, id: ev.id, content: ev.content })

            // Preview-refresh hook: when the agent successfully writes,
            // edits, or deletes a PROJECT file, emit files_saved so the
            // dashboard re-fetches files and reloads the iframe. Without
            // this, edits persist to Supabase but the preview keeps
            // showing the stale version — which makes it look like the
            // edit silently failed.
            if (!isSelfEdit && (ev.name === 'write_file' || ev.name === 'edit_file' || ev.name === 'delete_file')) {
              const resultStr = typeof ev.content === 'string' ? ev.content : String(ev.content || '')
              const looksSuccessful = !resultStr.startsWith('Error') && !resultStr.includes('Error executing')
              if (looksSuccessful) {
                const pending = pendingToolArgs.get(ev.id)
                const filePath = pending?.args?.path
                const action = ev.name === 'write_file' ? 'write'
                  : ev.name === 'edit_file' ? 'edit'
                  : 'delete'
                send('files_saved', {
                  paths: filePath ? [filePath] : [],
                  action,
                  agent_version: 'v2',
                })
                // ── Poke the Fly preview runner ────────────────────────
                // The runner has its own on-disk copy of the project. We
                // ping /sync-from-supabase so it re-pulls the just-edited
                // file and Vite HMR shows the change. Fire-and-forget:
                // never block the chat stream on preview infra latency.
                notifyPreviewOfFileChange(chat.project_id, {
                  changedPaths: filePath ? [filePath] : [],
                })
                  .then((r) => {
                    if (r.notified) {
                      console.log(`[StreamV2] preview synced for project ${chat.project_id} (machine ${r.machineId})`)
                      send('status', { stage: 'preview_synced', detail: `Preview hot-reloaded (machine ${r.machineId?.slice(0, 8)})` })
                    } else {
                      console.log(`[StreamV2] preview not synced for project ${chat.project_id}: ${r.reason}`)
                    }
                    if (r.requiresRestart) {
                      // package.json changed → the runner only runs
                      // `npm install` on cold boot, so a hot sync alone
                      // won't pick up newly added dependencies. Surface
                      // this loudly to the user so they don't waste a
                      // minute debugging "why isn't my new package
                      // working" — the answer is always "click Hard
                      // Reset → Start Preview".
                      send('status', {
                        stage: 'deps_changed',
                        detail: '📦 package.json changed — click Hard Reset → Start Preview to install new dependencies.',
                      })
                    }
                  })
                  .catch((err) => console.warn('[StreamV2] preview notify crashed:', err?.message))
              }
            }
            pendingToolArgs.delete(ev.id)
          } else if (ev.type === 'done') {
            send('status', { stage: 'complete', detail: 'Done.' })
          } else if (ev.type === 'error') {
            errored = true
            const inline = `\n\n> ⚠️ ${ev.message}\n`
            fullContent += inline
            send('token', { content: inline })
            send('error', { message: ev.message, error_type: 'agent_error' })
          }
        }
      } catch (e) {
        errored = true
        send('error', { message: 'Agent loop crashed: ' + (e?.message || 'unknown'), error_type: 'agent_crash' })
      }

      // Empty-response fallback — never persist a literally-empty assistant
      // turn. Surface what happened so the user sees a real message.
      if (!fullContent.trim()) {
        fullContent = errored
          ? '_(the agent encountered an error before producing a response — see above)_'
          : '_(the agent finished without producing a text response — try rephrasing or asking a more specific question)_'
        send('token', { content: fullContent })
      }

      // Persist the assistant message
      try {
        if (!errored || fullContent) {
          const assistantMessage = await db.messages.create({
            chat_id: chatId,
            project_id: chat.project_id,
            role: 'assistant',
            content: fullContent || '(no response)',
            metadata: {
              streamed: true,
              agent_version: 'v2',
              provider: providerName,
              model: modelName,
              toolCalls: toolEventCount,
            },
          })
          send('done', { content: fullContent, messageId: assistantMessage.id })
          send('message_saved', { id: assistantMessage.id, generatedFiles: [] })

          // Deduct credits (fire-and-forget)
          creditsDb.deductCredits(dbUser.id, 'chat_message', { model: modelName }).then((result) => {
            if (!result.error) {
              send('credits_update', { balance: result.balance, cost: result.cost, model: modelName })
            }
          }).catch((e) => console.warn('[StreamV2] credit deduct failed:', e?.message))
        }
      } catch (e) {
        console.error('[StreamV2] persist failed:', e)
        send('error', { message: 'Failed to save assistant message: ' + (e?.message || 'unknown'), error_type: 'persist_failed' })
      }

      finish()
    },
  })

  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
  return handleCORS(response)
}
