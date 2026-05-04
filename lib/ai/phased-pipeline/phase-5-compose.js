/**
 * Phase 5: Compose
 *
 * Input:   plan + copy + design tokens + images
 * Output:  { files: [ { path, content } ] }  — actual JSX written to DB
 *
 * The AI composes all files in ONE tool call. Now that we've already
 * decided structure + copy + tokens + images, Compose is a well-scoped
 * task: "stitch these three givens into JSX files". This makes it
 * reliable and fits comfortably in a 60-90s LLM call.
 */
const COMPOSE_TOOL = [{
  type: 'function',
  function: {
    name: 'create_files',
    description: 'Write all site files at once with their full content.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'file path relative to project root, e.g. "app/page.jsx"' },
              content: { type: 'string', description: 'full file content — 300+ lines of production-quality JSX' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
}]

const SYSTEM_PROMPT = `You are a senior React developer composing production-ready JSX files from a pre-designed plan.

You already have:
- The structure (what sections and files exist)
- The copy (every word written)
- The design tokens (exact Tailwind classes + fonts)
- The images (data URLs you'll inline into src={...})

Your job: write the JSX. No designing, no rewording, no second-guessing. Compose what you're given into beautiful, working code.

## HARD RULES
- Call the \`create_files\` tool ONCE with all files. Do NOT print JSON as text.
- Each page file: 300-500 lines of JSX minimum. Under 300 is lazy.
- Do NOT include \`import React\` or \`import { useState }\` — they are globally available.
- Use ONLY the palette classes from the tokens (e.g. if pageBg is "bg-amber-50", use that — do NOT pick your own bg-gray-950).
- Use the image dataUrls inline: \`<img src="data:image/png;base64,..." alt="..." />\`
- Use fonts via \`style={{ fontFamily: tokens.typography.displayFamily }}\` on h1/h2, body inherits from html.
- Apply radius + shadow tokens consistently.
- Every page section uses multi-column grid for multiple items.
- Every interactive element has a hover state and data-testid.
- Nav links go to /about /menu /contact etc — actual functional navigation.
- Only Tailwind classes (no custom CSS), only React hooks (no libraries).

## PROCESS
For each file in plan.files:
1. Identify which copy sections it contains (page.jsx usually has nav + hero + features + footer)
2. Write real JSX using the provided copy verbatim (don't rewrite it)
3. Apply the palette + typography + radius + shadow tokens
4. Inline image data URLs where the imageManifest roles match
5. Wire navigation hrefs

Do NOT invent new copy. Do NOT reinterpret the plan. Your job is execution, not design.`

export async function* runPhaseCompose(ctx) {
  const { provider, priorResults, db, projectId } = ctx
  const plan = priorResults.plan
  const copy = priorResults.copy?.copy
  const tokens = priorResults.design_tokens?.tokens
  const images = priorResults.images?.images || []
  const phaseStart = Date.now()

  if (!plan || !copy || !tokens) {
    throw new Error('Compose phase requires plan + copy + tokens from prior phases')
  }

  yield { event: 'status', data: { stage: 'compose', detail: `Writing ${plan.files.length} files...` } }

  // Shape the image manifest for the LLM — full data URLs are huge and would
  // blow the token budget. Instead we give it symbolic names, and at SAVE time
  // we rewrite each symbolic name back to the real data URL.
  const imageLookup = {}
  const imageHints = images.map((img, idx) => {
    const symbolicSrc = `{{IMAGE_${img.role.toUpperCase()}}}`
    imageLookup[symbolicSrc] = img.dataUrl
    return `- role: ${img.role}  →  use \`src="${symbolicSrc}"\` in JSX  (subject: ${img.subject.slice(0, 80)})`
  }).join('\n')

  const contextBlock = `
## PLAN
${JSON.stringify({ archetype: plan.archetype, brand: plan.brand, sections: plan.sections, files: plan.files }, null, 2)}

## COPY (use these exact words)
${JSON.stringify(copy, null, 2)}

## DESIGN TOKENS (use these exact classes — do NOT pick others)
${JSON.stringify(tokens, null, 2)}

## IMAGES (use symbolic src values — they will be replaced with real data URLs at save time)
${imageHints || '(none — use bg gradient or SVG placeholder)'}

## FILES TO WRITE
${plan.files.join('\n')}
`

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: contextBlock },
  ]

  let rawFiles = []
  let accumulatedText = ''
  let accumulatedToolArgs = ''
  let toolCallName = null

  async function runStreaming(messagesArg, label) {
    const stream = provider.chatWithToolsStream(messagesArg, COMPOSE_TOOL, {
      temperature: 0.6,
      max_tokens: 12_000,
      tool_choice: { type: 'function', function: { name: 'create_files' } },
    })
    let finalToolCalls = []
    let textChunks = ''
    let argDeltaBytes = 0
    for await (const chunk of stream) {
      if (chunk?.type === 'token' && typeof chunk.content === 'string') {
        textChunks += chunk.content
      } else if (chunk?.type === 'tool_args_delta') {
        argDeltaBytes += (chunk.delta || '').length
        toolCallName = chunk.name || toolCallName
      } else if (chunk?.type === 'tool_calls' && Array.isArray(chunk.tool_calls)) {
        finalToolCalls = chunk.tool_calls
      }
    }
    console.log(`[Compose:${label}] stream done — tool_calls=${finalToolCalls.length}, text=${textChunks.length}b, args_delta=${argDeltaBytes}b`)
    accumulatedText += textChunks
    accumulatedToolArgs += finalToolCalls.map((t) => t.function?.arguments || '').join('')
    const filesHere = []
    for (const tc of finalToolCalls) {
      try {
        const args = JSON.parse(tc.function?.arguments || '{}')
        if (Array.isArray(args.files)) filesHere.push(...args.files)
      } catch (err) {
        console.error(`[Compose:${label}] tool args parse failed:`, err.message, 'raw:', (tc.function?.arguments || '').slice(0, 200))
      }
    }
    return filesHere
  }

  try {
    console.log('[Compose] Starting streaming compose call — 12k max_tokens, tool=create_files')
    rawFiles = await runStreaming(messages, 'attempt-1')

    // If the first attempt returned no files, retry with a stricter directive.
    // Common failure mode: Claude narrates its plan as text instead of calling
    // the tool, or emits a partial tool call that fails JSON parse.
    if (rawFiles.length === 0) {
      console.warn('[Compose] attempt-1 produced 0 files — retrying with strict directive')
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: accumulatedText || 'I was about to respond with a plan, but I must call the create_files tool directly.' },
        { role: 'user', content: `Do NOT explain. Do NOT print JSON as text. Call the \`create_files\` tool RIGHT NOW with every file listed in the plan. Use the exact copy from the context block verbatim — do not rewrite it. Emit all files in a single create_files tool call.` },
      ]
      rawFiles = await runStreaming(retryMessages, 'attempt-2')
    }
  } catch (err) {
    throw new Error(`Compose LLM call failed: ${err.message}`)
  }

  if (rawFiles.length === 0) {
    const diag = accumulatedText.length > 0
      ? `model responded with ${accumulatedText.length} bytes of text instead of calling the tool`
      : 'model returned neither text nor tool call (possible stream truncation)'
    const preview = accumulatedText.slice(0, 160).replace(/\s+/g, ' ')
    throw new Error(`Compose produced 0 files — ${diag}${preview ? ` (preview: "${preview}")` : ''}`)
  }

  // Swap symbolic image src values back to real data URLs
  const saved = []
  for (const file of rawFiles) {
    if (!file.path || typeof file.content !== 'string') continue
    let content = file.content
    for (const [symbolic, realUrl] of Object.entries(imageLookup)) {
      content = content.split(symbolic).join(realUrl)
    }
    try {
      await saveFile(db, projectId, file.path, content)
      saved.push({ path: file.path, size: content.length })
      yield { event: 'file_saved', data: { path: file.path, bytes: content.length } }
    } catch (err) {
      console.error(`[Compose] failed to save ${file.path}:`, err.message)
    }
  }

  return { files: saved, _ms: Date.now() - phaseStart }
}

async function saveFile(db, projectId, path, content) {
  const existing = await db.projectFiles.findByPath(projectId, path)
  if (existing) {
    await db.projectFiles.update(existing.id, { content, updated_at: new Date().toISOString() })
  } else {
    await db.projectFiles.create({
      project_id: projectId,
      path,
      content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }
}
