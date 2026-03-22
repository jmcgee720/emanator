import { OpenAIProvider } from './providers/openai.js'
import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'

/**
 * Sprite generation prompt templates
 */
const SPRITE_TEMPLATES = {
  character: (opts) => `Create a pixel-art sprite sheet for a character named "${opts.name || 'Hero'}".
States: ${(opts.states || ['idle', 'walk', 'jump', 'attack']).join(', ')}.
${opts.frameCount ? `${opts.frameCount} frames per state.` : '4 frames per state.'}
Style: ${opts.style || 'pixel art, 16-bit era, clean outlines'}.
REQUIREMENTS: Transparent background. Each frame in a clear grid cell with safe margins. No bleed outside frame boundaries. Readable at small sizes (32x32 to 64x64). Consistent proportions across all states.`,

  icons: (opts) => `Create a set of ${opts.count || 6} game UI icons.
Icons: ${(opts.items || ['health', 'mana', 'attack', 'defense', 'speed', 'coin']).join(', ')}.
Style: ${opts.style || 'clean flat design, consistent stroke weight, game-ready'}.
REQUIREMENTS: Transparent background. Each icon in its own cell. Safe margins. No bleed. Readable at 32x32 pixels. Consistent style across all icons.`,

  props: (opts) => `Create game prop assets: ${(opts.items || ['chest', 'potion', 'sword', 'shield']).join(', ')}.
Style: ${opts.style || 'pixel art, vibrant colors, game-ready'}.
REQUIREMENTS: Transparent background. Each item separate. Clean edges. No bleed. Consistent scale and style.`,

  background: (opts) => `Create a game background: ${opts.description || 'a fantasy forest scene'}.
Style: ${opts.style || 'painted, atmospheric, parallax-ready layers'}.
Dimensions: ${opts.dimensions || '1024x512'}.
REQUIREMENTS: Seamless edges if tileable. Rich detail. Game-ready.`,
}

/**
 * Image generation modes
 */
export const IMAGE_MODES = {
  image: { label: 'Image', description: 'Generate any image from a text prompt' },
  sprite: { label: 'Sprite Sheet', description: 'Character sprites with animation states' },
  icon: { label: 'Icons', description: 'UI icons and game icons' },
  props: { label: 'Props', description: 'Game props and objects' },
  background: { label: 'Background', description: 'Scene backgrounds and environments' },
  ui: { label: 'UI Elements', description: 'Buttons, panels, frames, UI components' },
}

/**
 * Build prompt modifiers from variation params
 */
function buildVariationPromptModifiers({ variationType, sourceImage, references, locks, styleLevel, targetStyle, outputSettings, characterName, customPrompt, states }) {
  const parts = []
  const isStyleChange = styleLevel === 'major' || styleLevel === 'replace'
  const isModerateStyleChange = styleLevel === 'moderate'

  // Source image context — when replacing style, describe only the SUBJECT, not the style
  if (sourceImage?.prompt) {
    if (isStyleChange) {
      parts.push(`[SOURCE CHARACTER/SUBJECT: The original image depicted: "${sourceImage.prompt}". Extract ONLY the subject/character description (ignore any art style, rendering, or medium descriptions from the original). Mode: ${sourceImage.mode || 'image'}.`)
    } else {
      parts.push(`[SOURCE IMAGE CONTEXT: The original image was generated with prompt: "${sourceImage.prompt}". Mode: ${sourceImage.mode || 'image'}.`)
    }
    if (characterName) parts.push(`Character name: "${characterName}".`)
    parts.push(']')
  }

  // Style control — injected BEFORE variation type so it takes priority
  if (isStyleChange && targetStyle) {
    parts.push(`[STYLE OVERRIDE — ${styleLevel === 'replace' ? 'COMPLETE REPLACEMENT' : 'MAJOR CHANGE'}:
IGNORE the original art style entirely. Render the subject/character in this NEW style: ${targetStyle}.
The character identity, pose, and composition should be preserved, but the rendering style, line work, coloring technique, and visual aesthetic MUST match the target style described above. Do NOT retain any pixel-art, retro, or original-medium qualities unless the target style specifically calls for them.]`)
  } else if (isModerateStyleChange && targetStyle) {
    parts.push(`[STYLE DIRECTION — MODERATE REFINEMENT:
Use the target style "${targetStyle}" as a direction to evolve the original style. Blend elements of both — keep the spirit of the original but shift noticeably toward the target aesthetic.]`)
  }

  // Variation type instructions — adjusted for style changes
  const typeInstructions = {
    pose_variation: 'Generate the SAME character/subject in a DIFFERENT pose. Maintain identity, outfit, and style.',
    action_variation: 'Generate the SAME character performing a DIFFERENT action/state. Preserve character identity.',
    style_variation: isStyleChange
      ? 'Reinterpret the subject in the specified NEW art style. Preserve subject identity but fully adopt the new rendering style.'
      : 'Generate the SAME subject in a DIFFERENT art style. Keep composition and subject identical.',
    color_variation: 'Generate the SAME design with a DIFFERENT color palette. Keep all other aspects identical.',
    icon_variant: 'Create an icon variant of this design. Optimize for small sizes, clear silhouette, minimal detail.',
    sprite_states: 'Generate animation states for this character. Each state should be clearly distinct but maintain character identity.',
    background_variation: 'Generate a variation of this background/scene. Maintain mood and composition style.',
  }
  if (variationType && typeInstructions[variationType]) {
    parts.push(`[VARIATION TYPE: ${typeInstructions[variationType]}]`)
  }

  // Reference images context
  if (references?.length > 0) {
    const refParts = references.map(ref => {
      const rolePrefixes = {
        style: 'Use the art style from',
        character: 'Preserve the character identity from',
        pose: 'Use the pose/position from',
        color: 'Use the color palette from',
      }
      return `${rolePrefixes[ref.role] || 'Reference'}: "${ref.prompt || ref.path}" (${ref.mode || 'image'})`
    })
    parts.push(`[REFERENCES:\n${refParts.join('\n')}\n]`)
  }

  // Consistency locks — filter out style preservation when style is being changed
  if (locks?.length > 0) {
    const lockMap = {
      preserve_face: 'MUST preserve facial features and expression style',
      preserve_outfit: 'MUST preserve clothing/outfit design exactly',
      preserve_proportions: 'MUST maintain body proportions and size ratios',
      preserve_palette: 'MUST use the exact same color palette',
      preserve_silhouette: 'MUST maintain the overall silhouette/outline shape',
      preserve_style: 'MUST maintain the exact same art style, rendering technique, and visual quality',
    }
    // When replacing style, automatically exclude preserve_style lock
    const effectiveLocks = isStyleChange
      ? locks.filter(l => l !== 'preserve_style')
      : locks
    const activeFlags = effectiveLocks.filter(l => lockMap[l]).map(l => lockMap[l])
    if (activeFlags.length > 0) {
      parts.push(`[CONSISTENCY REQUIREMENTS:\n${activeFlags.map(f => `- ${f}`).join('\n')}\n]`)
    }
  }

  // Output settings
  if (outputSettings?.length > 0) {
    const settingMap = {
      transparent_bg: 'Transparent background (PNG)',
      safe_margins: 'Safe margins — minimum 2px padding from edges',
      no_bleed: 'No bleed — content must not touch frame edges',
      readable_small: 'Must be readable/recognizable at small sizes (32x32)',
      icon_ready: 'Icon-ready — clear silhouette, minimal detail, bold shapes',
      game_ready: 'Game-ready — optimized for real-time rendering, clean edges',
    }
    const activeSettings = outputSettings.filter(s => settingMap[s]).map(s => settingMap[s])
    if (activeSettings.length > 0) {
      parts.push(`[OUTPUT REQUIREMENTS:\n${activeSettings.map(s => `- ${s}`).join('\n')}\n]`)
    }
  }

  // Custom prompt
  if (customPrompt) {
    parts.push(`[ADDITIONAL INSTRUCTIONS: ${customPrompt}]`)
  }

  return parts.join('\n')
}

/**
 * Load and save asset relationships JSON from project files
 */
async function loadRelationships(projectId) {
  try {
    const file = await db.projectFiles.findByPath(projectId, '_meta/asset_relationships.json')
    if (file?.content) return JSON.parse(file.content)
  } catch {}
  return { relationships: [], characters: {} }
}

async function saveRelationships(projectId, data) {
  await db.projectFiles.upsert(projectId, '_meta/asset_relationships.json', JSON.stringify(data, null, 2), 'json')
}

export class ImageService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
    this.provider = new OpenAIProvider(apiKey)
  }

  /**
   * Generate an image and store it as a project asset
   */
  async generate({ projectId, prompt, mode, spriteOpts, size, userId, chatId, variation }) {
    const result = { asset: null }
    for await (const evt of this.generateWithProgress({ projectId, prompt, mode, spriteOpts, size, userId, chatId, variation })) {
      if (evt.type === 'complete') result.asset = evt.asset
    }
    return result.asset
  }

  /**
   * Generate an image with progress events (async generator).
   * Yields: { type: 'stage', stage, progress, label } and { type: 'complete', asset, progress: 100 }
   */
  async *generateWithProgress({ projectId, prompt, mode, spriteOpts, size, userId, chatId, variation }) {
    const startTime = Date.now()
    const VALID_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto'])
    const validatedSize = VALID_SIZES.has(size) ? size : '1024x1024'

    // Stage 1: Preparing request
    yield { type: 'stage', stage: 'preparing', progress: 5, label: 'Preparing request' }

    // Build the final prompt
    let finalPrompt = prompt
    if (mode === 'sprite' && spriteOpts) {
      const template = SPRITE_TEMPLATES.character
      finalPrompt = template(spriteOpts) + (prompt ? `\nAdditional notes: ${prompt}` : '')
    } else if (mode === 'icon' && spriteOpts) {
      finalPrompt = SPRITE_TEMPLATES.icons(spriteOpts) + (prompt ? `\nAdditional notes: ${prompt}` : '')
    } else if (mode === 'props' && spriteOpts) {
      finalPrompt = SPRITE_TEMPLATES.props(spriteOpts) + (prompt ? `\nAdditional notes: ${prompt}` : '')
    } else if (mode === 'background' && spriteOpts) {
      finalPrompt = SPRITE_TEMPLATES.background({ ...spriteOpts, description: prompt }) 
    }

    // Apply variation modifiers if present
    if (variation) {
      const modifiers = buildVariationPromptModifiers(variation)
      if (modifiers) finalPrompt += '\n\n' + modifiers
    }

    // Load project style preferences from canvas
    if (projectId) {
      try {
        const canvas = await db.projectCanvas.findByProjectId(projectId)
        if (canvas?.canvas_content) {
          const styleMatch = canvas.canvas_content.match(/## Image Style[^\n]*\n([\s\S]*?)(?=\n##|\n$)/i)
          if (styleMatch) {
            finalPrompt += `\nProject style guide: ${styleMatch[1].trim()}`
          }
          // Also load character identity from canvas
          if (variation?.characterName) {
            const charMatch = canvas.canvas_content.match(new RegExp(`## Character: ${variation.characterName}[^\n]*\n([\\s\\S]*?)(?=\n##|$)`, 'i'))
            if (charMatch) {
              finalPrompt += `\nCharacter identity: ${charMatch[1].trim()}`
            }
          }
        }
      } catch {}
    }

    // Stage 2: Sending to model
    yield { type: 'stage', stage: 'sending_to_model', progress: 10, label: 'Sending to image model' }

    // Stage 3: Generating (this is the long part — OpenAI API call)
    yield { type: 'stage', stage: 'generating', progress: 20, label: 'Generating image' }

    const result = await this.provider.generateImage(finalPrompt, {
      size: validatedSize,
      quality: 'auto',
    })

    // Stage 4: Processing result
    yield { type: 'stage', stage: 'processing', progress: 90, label: 'Processing result' }

    const timestamp = Date.now()
    const safeName = (prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_') || 'image')
    const stateSuffix = variation?.stateName ? `_${variation.stateName}` : ''
    const filename = `${safeName}${stateSuffix}_${timestamp}.png`
    const storagePath = `_generated/${filename}`

    const imageDataUrl = result.b64_json
      ? `data:image/png;base64,${result.b64_json}`
      : result.url

    // Stage 5: Saving asset
    yield { type: 'stage', stage: 'saving', progress: 95, label: 'Saving asset' }

    const saved = await db.projectFiles.upsert(
      projectId,
      storagePath,
      imageDataUrl,
      'image'
    )

    const asset = {
      id: saved.id,
      path: storagePath,
      filename,
      prompt: prompt,
      finalPrompt,
      mode: mode || 'image',
      size: size || '1024x1024',
      revisedPrompt: result.revised_prompt,
      imageData: imageDataUrl,
      spriteOpts: spriteOpts || null,
      duration: Date.now() - startTime,
      createdAt: new Date().toISOString(),
      // Variation metadata
      variationType: variation?.variationType || null,
      sourceAssetId: variation?.sourceImage?.id || null,
      sourceAssetPath: variation?.sourceImage?.path || null,
      referenceAssetIds: variation?.references?.map(r => r.id).filter(Boolean) || [],
      stateName: variation?.stateName || null,
      characterName: variation?.characterName || null,
      styleLockFlags: variation?.locks || [],
      styleLevel: variation?.styleLevel || null,
      targetStyleUsed: variation?.targetStyle || null,
    }

    // Save asset relationship
    if (projectId && variation?.sourceImage) {
      try {
        const relData = await loadRelationships(projectId)
        relData.relationships.push({
          asset_id: saved.id,
          asset_path: storagePath,
          source_asset_id: variation.sourceImage.id,
          source_asset_path: variation.sourceImage.path,
          variation_type: variation.variationType,
          reference_asset_ids: variation.references?.map(r => r.id).filter(Boolean) || [],
          generation_notes: variation.customPrompt || '',
          state_name: variation.stateName || null,
          character_name: variation.characterName || null,
          style_lock_flags: variation.locks || [],
          created_at: new Date().toISOString(),
        })
        // Track character identity
        if (variation.characterName) {
          relData.characters[variation.characterName] = {
            base_asset_path: variation.sourceImage.path,
            latest_asset_path: storagePath,
            style_locks: variation.locks || [],
          }
        }
        await saveRelationships(projectId, relData)
      } catch {}
    }

    // Update canvas with image generation info + variation constraints
    if (projectId) {
      try {
        await this.updateCanvasWithImageInfo(projectId, asset)
      } catch {}
    }

    // Stage 6: Complete
    yield { type: 'stage', stage: 'rendering', progress: 100, label: 'Rendering preview' }
    yield { type: 'complete', asset, progress: 100 }
  }

  /**
   * Update project canvas with image generation preferences, sprite constraints, and variation info
   */
  async updateCanvasWithImageInfo(projectId, asset) {
    const canvas = await db.projectCanvas.findByProjectId(projectId)
    let content = canvas?.canvas_content || ''

    // Add/update image generation section
    const variationInfo = asset.variationType ? ` [variation: ${asset.variationType}]` : ''
    const stateInfo = asset.stateName ? ` [state: ${asset.stateName}]` : ''
    const imageSection = `\n## Generated Assets\n- Latest: ${asset.filename} (${asset.mode}, ${asset.size})${variationInfo}${stateInfo}\n- Prompt: ${asset.prompt.slice(0, 100)}\n`

    if (content.includes('## Generated Assets')) {
      content = content.replace(/## Generated Assets[\s\S]*?(?=\n##|$)/, imageSection.trim())
    } else {
      content += imageSection
    }

    // Save sprite constraints for reuse
    if (asset.mode === 'sprite' && asset.spriteOpts) {
      const constraintSection = `\n## Sprite Constraints\n- Transparent background (PNG)\n- Safe margins (minimum 2px padding)\n- No bleed between frames\n- Readability at 32x32 to 64x64\n- Style: ${asset.spriteOpts.style || 'pixel art, 16-bit, clean outlines'}\n- States: ${(asset.spriteOpts.states || []).join(', ')}\n- Frames per state: ${asset.spriteOpts.frameCount || 4}\n`
      if (content.includes('## Sprite Constraints')) {
        content = content.replace(/## Sprite Constraints[\s\S]*?(?=\n##|$)/, constraintSection.trim())
      } else {
        content += constraintSection
      }
    }

    // Track style preferences
    if (asset.spriteOpts?.style) {
      const styleSection = `\n## Image Style\n${asset.spriteOpts.style}\n`
      if (!content.includes('## Image Style')) {
        content += styleSection
      }
    }

    // Save character identity to canvas for future reference
    if (asset.characterName) {
      const charSection = `\n## Character: ${asset.characterName}\n- Base asset: ${asset.path}\n- Style locks: ${(asset.styleLockFlags || []).join(', ') || 'none'}\n- Mode: ${asset.mode}\n`
      const charPattern = new RegExp(`## Character: ${asset.characterName}[\\s\\S]*?(?=\\n##|$)`)
      if (charPattern.test(content)) {
        content = content.replace(charPattern, charSection.trim())
      } else {
        content += charSection
      }
    }

    // Save variation preferences
    if (asset.styleLockFlags?.length > 0) {
      const prefSection = `\n## Variation Preferences\n- Consistency locks: ${asset.styleLockFlags.join(', ')}\n- Preferred output: transparent PNG, safe margins, no bleed\n- Readable at small sizes\n`
      if (content.includes('## Variation Preferences')) {
        content = content.replace(/## Variation Preferences[\s\S]*?(?=\n##|$)/, prefSection.trim())
      } else {
        content += prefSection
      }
    }

    await db.projectCanvas.upsert(projectId, content)
  }
}
