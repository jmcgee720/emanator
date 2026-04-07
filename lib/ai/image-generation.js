/**
 * Image generation pipeline — detect intent, parse opts, emit events.
 * Extracted from service.js to reduce file size.
 */

import { parseSpriteOpts, parseIconOpts } from './tool-executor.js'
import { db } from '@/lib/supabase/db'

/**
 * Process image generation — detect intent, parse opts, close stream fast.
 * Actual image generation is done by the frontend calling POST /api/projects/{id}/generate-image.
 * This avoids the ~60s proxy timeout killing the SSE stream.
 */
export async function* processImageGeneration({ projectId, chatId, userMessage, userId, intent, workflow, runId, startTime, providerName }) {
  try {
    // Hard guard: block image generation if prompt contains explicit BUILD intent or code/architecture signals
    const buildIntentGuard = /\bINTENT:\s*BUILD\b/i
    const codeSignals = /\.(js|jsx|ts|tsx|mjs)\b|\b(route\.js|Dashboard\.jsx|server\.js|constants\.js|intents\.js|service\.js)\b|\b(lib|app|src|components|api|hooks|services)\s*[/\\]|\b(router|handler|validator|planner|changelog|file_actions|middleware|endpoint|pipeline|rollback|snapshot|sandbox|promote|diff)\b/i
    if (buildIntentGuard.test(userMessage) || codeSignals.test(userMessage)) {
      console.warn('[AIService] Image generation blocked — BUILD intent or code/architecture prompt detected')
      yield { event: 'token', data: { content: userMessage } }
      yield { event: 'done', data: { content: userMessage, toolMode: 'build', intent: 'build', runId, provider: providerName, model: 'n/a' } }
      return
    }

    // Determine mode and parse sprite opts from message
    let mode = workflow.imageMode || 'image'
    let spriteOpts = null
    let prompt = userMessage

    if (intent === 'sprite_generation' || /\bsprite\b/i.test(userMessage)) {
      mode = 'sprite'
      spriteOpts = parseSpriteOpts(userMessage)
    } else if (userMessage.match(/icon/i)) {
      mode = 'icon'
      spriteOpts = parseIconOpts(userMessage)
    } else if (userMessage.match(/background|scene|environment|landscape/i)) {
      mode = 'background'
    } else if (userMessage.match(/prop|item|object|weapon|tool/i)) {
      mode = 'props'
    }

    // Follow-up / variation detection — enhanced for natural language follow-ups
    const variationPatterns = [
      /\b(variation|variant|same\s+style|similar|like\s+(the\s+)?last|another|redo|again|modify|tweak|adjust)\b/i,
      /\bdifferent\s+(pose|color|action|style|angle|view|background)\b/i,
      /\buse\s+the\s+(last|previous|uploaded|reference)\b/i,
      /\bsame\s+(character|style|look|design|outfit)\b/i,
      /\bpreserve\s+(the\s+)?(style|character|look|design|palette)\b/i,
      /\b(pose|state)\s+variations?\b/i,
      /\b(idle|walk|run|jump|attack|hurt|celebrate|crouch)\s+(version|state|animation|pose)\b/i,
      /\bmake\s+\d+\s+(pose|style|color)\s+variations?\b/i,
      /\bcreate\s+(idle|walk|run|jump|attack).*\b(versions?|states?)\b/i,
    ]
    const isVariation = variationPatterns.some(p => p.test(userMessage))

    let variationContext = null
    if (isVariation && projectId) {
      try {
        const allFiles = await db.projectFiles.findByProjectId(projectId)
        const generatedImages = allFiles
          .filter(f => f.path?.startsWith('_generated/'))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        // Check if user mentions "uploaded" reference
        const wantsUploadedRef = /\b(uploaded|upload)\s*(reference|image|ref)\b/i.test(userMessage)
        let refImage = null
        if (wantsUploadedRef) {
          refImage = allFiles.find(f => f.path?.startsWith('_uploads/') && f.file_type === 'image')
        }
        if (!refImage && generatedImages.length > 0) {
          refImage = generatedImages[0]
        }

        if (refImage) {
          const refName = refImage.path.replace(/^_(?:generated|uploads)\//, '')
          prompt = `${userMessage}\n\n[REFERENCE: This is a follow-up/variation request. The reference image is "${refName}" at path "${refImage.path}". Maintain similar style, color palette, and composition unless explicitly asked to change.]`

          variationContext = {
            variationType: /\bpose\b/i.test(userMessage) ? 'pose_variation'
              : /\baction|state\b/i.test(userMessage) ? 'action_variation'
              : /\bstyle\b/i.test(userMessage) ? 'style_variation'
              : /\bcolor|palette\b/i.test(userMessage) ? 'color_variation'
              : /\bicon\b/i.test(userMessage) ? 'icon_variant'
              : /\bsprite|idle|walk|run|jump\b/i.test(userMessage) ? 'sprite_states'
              : /\bbackground|scene\b/i.test(userMessage) ? 'background_variation'
              : 'pose_variation',
            sourceImage: { id: refImage.id, path: refImage.path },
            references: [{ id: refImage.id, path: refImage.path, role: 'character' }],
            locks: ['preserve_style'],
          }
        }
      } catch {}
    }

    // Emit intent with all info the frontend needs to call generate-image endpoint
    yield { event: 'image_intent', data: {
      projectId,
      chatId,
      prompt,
      mode,
      spriteOpts,
      size: '1024x1024',
      intent,
      variation: variationContext || undefined,
    }}

    // Close stream immediately — content placeholder
    const content = `Generating ${mode}...`
    yield { event: 'token', data: { content } }
    yield { event: 'done', data: {
      content,
      toolMode: 'image_gen',
      intent,
      runId,
      provider: 'openai',
      model: process.env.OPENAI_MODEL_IMAGE || 'gpt-image-1',
      imageGenerationPending: true,
    }}
  } catch (error) {
    console.error('[AIService] Image intent error:', error)
    yield { event: 'error', data: {
      message: error.message || 'Image generation failed',
      error_type: 'image_generation_error',
      provider: 'openai',
    }}
  }
}
