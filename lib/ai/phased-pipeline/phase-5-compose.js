/**
 * Phase 5: Compose
 *
 * Input:   plan + copy + design tokens + images
 * Output:  { files: [ { path, content } ] }  — actual JSX written to DB
 *
 * STRATEGY: per-file compose loop. Each file gets its own LLM call with
 * the full plan/copy/tokens/images context plus a "write THIS one file"
 * directive. This keeps each call's output well under 12k tokens (a
 * single 300-500 line JSX file is ~10-15KB), eliminating the failure
 * mode where a multi-file tool_args payload would get truncated mid-JSON
 * and produce zero parsable files.
 *
 * Files are saved as they complete, so a failure on file 4 still leaves
 * files 1-3 written. Progress events stream back to the wizard UI.
 */
const COMPOSE_FILE_TOOL = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Write a single file with its full content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'file path relative to project root, e.g. "app/page.jsx"' },
        content: { type: 'string', description: 'full file content — production-quality JSX, 300+ lines for a page' },
      },
      required: ['path', 'content'],
    },
  },
}]

const SYSTEM_PROMPT = `You are a senior React developer composing production-ready JSX files from a pre-designed plan.

You have:
- The structure (what sections and files exist)
- The copy (every word written)
- The design tokens (exact Tailwind classes + fonts)
- The images (data URLs you'll inline into src={...})

Your job: write the JSX. No designing, no rewording, no second-guessing. Compose what you're given into beautiful, working code.

## HARD RULES
- Call the \`write_file\` tool ONCE with this single file's path + content. Do NOT print JSON as text.
- Page files: 300-500 lines of JSX minimum. Under 300 is lazy.
- Component files (e.g. components/Header.jsx): 50-150 lines.
- Do NOT include \`import React\` or \`import { useState }\` — they are globally available.
- Use ONLY the palette classes from the tokens (e.g. if pageBg is "bg-amber-50", use that — do NOT pick your own bg-gray-950).
- Use the image dataUrls inline: \`<img src="data:image/png;base64,..." alt="..." />\`
- Use fonts via \`style={{ fontFamily: tokens.typography.displayFamily }}\` on h1/h2.
- Apply radius + shadow tokens consistently.
- Every page section uses multi-column grid for multiple items.
- Every interactive element has a hover state and data-testid.
- Nav links go to /about /menu /contact etc — actual functional navigation.
- Only Tailwind classes (no custom CSS), only React hooks (no libraries).

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

  const filesToWrite = Array.isArray(plan.files) ? plan.files : []
  if (filesToWrite.length === 0) {
    throw new Error('Compose phase has no files to write — plan.files is empty')
  }

  yield { event: 'status', data: { stage: 'compose', detail: `Writing ${filesToWrite.length} files in parallel...` } }

  // Shape the image manifest for the LLM — full data URLs are huge and would
  // blow the token budget. We give symbolic names that get rewritten back to
  // the real data URL at SAVE time.
  const imageLookup = {}
  const imageHints = images.map((img) => {
    const symbolicSrc = `{{IMAGE_${img.role.toUpperCase()}}}`
    imageLookup[symbolicSrc] = img.dataUrl
    return `- role: ${img.role}  →  use \`src="${symbolicSrc}"\` in JSX  (subject: ${(img.subject || '').slice(0, 80)})`
  }).join('\n')

  // The static context block — same for every file in this run.
  const isFullstack = plan.archetype === 'fullstack_app' && plan.dataModel
  const fullstackBlock = isFullstack ? `
## DATA MODEL (this is a fullstack_app — generate API routes that match)
${JSON.stringify(plan.dataModel, null, 2)}

## FULLSTACK FILE RULES
- For \`app/api/<entity>/route.js\` files: implement GET (list) + POST (create)
  using the Supabase admin client from \`@/lib/db.js\`. Always prefix routes
  with /api. Always exclude \`_id\` / \`createdAt\` from selects when listing.
  Use Pydantic-style validation in JS by checking required fields on POST.
- For \`app/api/<entity>/[id]/route.js\` files: implement GET (one) + PATCH
  (update) + DELETE.
- For \`lib/db.js\`: export a default Supabase client built from
  \`process.env.NEXT_PUBLIC_SUPABASE_URL\` + \`process.env.SUPABASE_SERVICE_ROLE_KEY\`.
  Tiny — under 30 lines. Do NOT crash on missing env (warn + return null client).
- For \`lib/auth.js\` (only when dataModel.auth !== "none"): export
  \`getCurrentUser(request)\` that reads the supabase session cookie. Stub
  to return \`{ id: 'dev-user' }\` if SUPABASE keys missing so the preview
  still works in zero-config mode.
- For \`app/dashboard/page.jsx\`: a real working dashboard that calls
  \`/api/<entity>\` to list rows + a form to create one. Include loading
  + error states. Use \`useEffect\` + \`useState\` (globally available).
- API ROUTES MUST RETURN \`NextResponse.json(...)\` — never plain Response.
- API routes MUST handle the case where lib/db.js client is null (no Supabase
  configured): return mock in-memory data so the preview is never broken.
` : ''

  const sharedContext = `
## PLAN
${JSON.stringify({ archetype: plan.archetype, brand: plan.brand, sections: plan.sections }, null, 2)}
${fullstackBlock}
## COPY (use these exact words verbatim)
${JSON.stringify(copy, null, 2)}

## DESIGN TOKENS (use these exact classes — do NOT pick others)
${JSON.stringify(tokens, null, 2)}

## IMAGES (use symbolic src values — they will be replaced with real data URLs at save time)
${imageHints || '(none — use bg gradient or SVG placeholder)'}
`

  // Compose all files IN PARALLEL. Each file is independent (no cross-file
  // references that would force ordering) so this just slashes wall time
  // from N×60s sequential to ≈max(60s) parallel — well under Vercel's 300s
  // function cap even for 6+ files.
  //
  // Promise.allSettled so a single failed file doesn't kill the whole run.
  const composeOne = async (filePath, idx) => {
    const isPage = /^app\/.*page\.(jsx|tsx)$/.test(filePath) || filePath === 'app/page.jsx'
    const isApiRoute = /^app\/api\/.*\/route\.(js|ts)$/.test(filePath)
    const isLibFile = /^lib\/.*\.(js|ts)$/.test(filePath)
    // API routes + lib helpers are intentionally short — over-padding
    // them with comments makes them harder to debug, not better.
    const minLines = isPage ? 300 : isApiRoute ? 30 : isLibFile ? 20 : 60

    const fileTypeHint = isApiRoute
      ? `\n\n## THIS IS AN API ROUTE — Next.js app-router\nExport \`async function GET(request)\`, \`POST(request)\`, \`PATCH(request, { params })\`, etc. Always return \`NextResponse.json(...)\` (import from \`next/server\`). Read body via \`await request.json()\`. Read query via \`request.nextUrl.searchParams\`. Use the Supabase client from \`@/lib/db.js\`. NEVER export default — only named HTTP-method exports.`
      : isLibFile
      ? `\n\n## THIS IS A LIB FILE — small focused module\nNo JSX. Tiny exports only. Be defensive about missing env vars — return null/stub instead of throwing so the preview boots.`
      : ''

    const fileMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${sharedContext}

## YOUR TASK
Write THIS one file: \`${filePath}\`

Minimum length: ${minLines} lines.${fileTypeHint}

Call the \`write_file\` tool ONCE with this file's full content. Do NOT print JSON as text. Do NOT explain.`,
      },
    ]

    let fileContent = null
    let lastError = null
    for (let attempt = 1; attempt <= 2 && !fileContent; attempt++) {
      try {
        if (attempt === 1) {
          fileContent = await streamSingleFile(provider, fileMessages, filePath)
        } else {
          fileContent = await nonStreamSingleFile(provider, fileMessages, filePath)
        }
      } catch (err) {
        lastError = err
        console.error(`[Compose:${filePath}] attempt ${attempt} failed:`, err.message)
      }
    }
    return { filePath, fileContent, lastError, idx }
  }

  const settled = await Promise.allSettled(filesToWrite.map((p, i) => composeOne(p, i)))
  const saved = []
  const failed = []

  for (const s of settled) {
    if (s.status !== 'fulfilled') {
      failed.push({ path: 'unknown', error: s.reason?.message || 'unknown rejection' })
      continue
    }
    const { filePath, fileContent, lastError } = s.value
    if (!fileContent) {
      failed.push({ path: filePath, error: lastError?.message || 'unknown' })
      continue
    }

    // Substitute symbolic image refs with the real base64 data URLs
    let resolved = fileContent
    for (const [symbolic, realUrl] of Object.entries(imageLookup)) {
      resolved = resolved.split(symbolic).join(realUrl)
    }

    try {
      await saveFile(db, projectId, filePath, resolved)
      saved.push({ path: filePath, size: resolved.length })
    } catch (err) {
      console.error(`[Compose] failed to save ${filePath}:`, err.message)
      failed.push({ path: filePath, error: `save failed: ${err.message}` })
    }
  }

  // Emit one summary event after all files settle
  yield { event: 'compose_done', data: { saved: saved.length, failed: failed.length } }

  if (saved.length === 0) {
    const summary = failed.length > 0
      ? failed.map((f) => `${f.path}: ${f.error}`).slice(0, 3).join(' | ')
      : 'no files attempted'
    throw new Error(`Compose produced 0 files — ${summary}`)
  }

  return {
    files: saved,
    failed: failed.length > 0 ? failed : undefined,
    _ms: Date.now() - phaseStart,
  }
}

/**
 * Stream a single file's tool call. Returns the file content string,
 * or throws if no parseable tool call was emitted.
 */
async function streamSingleFile(provider, messages, label) {
  const stream = provider.chatWithToolsStream(messages, COMPOSE_FILE_TOOL, {
    temperature: 0.5,
    max_tokens: 12_000, // single file: 300-500 lines fits comfortably
    tool_choice: { type: 'function', function: { name: 'write_file' } },
  })
  let textChunks = ''
  let finalToolCalls = []
  for await (const chunk of stream) {
    if (chunk?.type === 'token' && typeof chunk.content === 'string') {
      textChunks += chunk.content
    } else if (chunk?.type === 'tool_calls' && Array.isArray(chunk.tool_calls)) {
      finalToolCalls = chunk.tool_calls
    }
  }
  console.log(`[Compose:${label}] stream done — tool_calls=${finalToolCalls.length}, text=${textChunks.length}b`)
  for (const tc of finalToolCalls) {
    try {
      const args = JSON.parse(tc.function?.arguments || '{}')
      if (typeof args.content === 'string' && args.content.length > 100) {
        return args.content
      }
    } catch (err) {
      console.error(`[Compose:${label}] tool args parse failed:`, err.message, 'raw:', (tc.function?.arguments || '').slice(0, 200))
    }
  }
  throw new Error(textChunks.length > 0 ? `model wrote ${textChunks.length}b of text instead of calling write_file` : 'no tool call emitted (possible stream truncation)')
}

/**
 * Non-streaming fallback. Some provider/SDK combos drop tool args mid-stream;
 * the buffered API call survives those silent stream failures.
 */
async function nonStreamSingleFile(provider, messages, label) {
  if (typeof provider.chatWithTools !== 'function') {
    throw new Error('provider has no non-streaming chatWithTools')
  }
  const resp = await provider.chatWithTools(messages, COMPOSE_FILE_TOOL, {
    temperature: 0.5,
    max_tokens: 12_000,
    tool_choice: { type: 'function', function: { name: 'write_file' } },
  })
  for (const tc of resp.tool_calls || []) {
    try {
      const args = JSON.parse(tc.function?.arguments || '{}')
      if (typeof args.content === 'string' && args.content.length > 100) {
        return args.content
      }
    } catch (err) {
      console.error(`[Compose:${label}:fallback] tool args parse failed:`, err.message)
    }
  }
  throw new Error('non-streaming call returned no parseable tool call')
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
