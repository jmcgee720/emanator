// ══════════════════════════════════════════════════════════════════════
// ── ART DIRECTION ANALYZER ──
// When the user uploads reference images with a Creative Brief, run them
// through GPT-4o Vision once (before planning) to extract a tight aesthetic
// summary the planner and builder can ground against.
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize a data URL or raw base64 to a full data URL OpenAI Vision accepts.
 */
function toDataUrl(data, name = '') {
  if (!data) return null
  if (data.startsWith('data:')) return data
  // Guess mime from filename extension; default to png
  const ext = (name.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/png'
  return `data:${mime};base64,${data}`
}

/**
 * Ask GPT-4o Vision to describe the reference images in terms a downstream
 * planner / builder can act on.
 *
 * Returns a plain string (1 paragraph + bullet list). Non-blocking on
 * provider failure — we return null and the pipeline continues as if no
 * images were attached.
 *
 * @param {{name?:string, type:string, data:string}[]} attachments
 * @param {{chat: Function}} provider — OpenAI-compatible
 * @returns {Promise<string|null>}
 */
export async function analyzeArtDirection(attachments, provider) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null
  const images = attachments
    .filter((a) => a?.type === 'image' && a?.data)
    .slice(0, 4) // cap at 4 refs so we don't blow up token budget

  if (images.length === 0) return null

  const systemPrompt = `You are an art director. You'll receive 1-4 reference images the user wants the generated app to look like. Produce a TIGHT aesthetic brief the downstream builder will ground against.

Output format (plain text, no JSON):
Aesthetic: <one sentence — e.g. "Dark, high-contrast editorial with sharp serif headlines and oversized whitespace.">
Palette: <3-6 concrete hex-like color names — e.g. "Near-black #0a0a0a base, bone white #f5f1ea text, accent coral #ff5a4e, muted graphite #1f1f1f cards">
Typography: <serif vs sans, weight, implied font references — e.g. "Sans-serif geometric (Inter / Söhne vibe), semibold 600 for display, regular 400 for body">
Layout: <composition cues — e.g. "Asymmetric left-aligned hero, generous 120px+ vertical rhythm, card grid with sharp corners">
Motion: <any motion cues visible — e.g. "Minimal motion; static marketing look">
AVOID: <what this aesthetic is NOT — e.g. "No purple/violet gradients, no rounded-2xl, no shadcn-default styling">

Be specific. Be decisive. Do NOT say "depends" or "could be".`

  const userContent = [
    { type: 'text', text: `Analyze ${images.length} reference image${images.length > 1 ? 's' : ''}:` },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: toDataUrl(img.data, img.name), detail: 'low' },
    })),
  ]

  try {
    const raw = await provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.3, max_tokens: 400 }
    )
    const trimmed = (raw || '').trim()
    return trimmed.length > 20 ? trimmed : null
  } catch (err) {
    console.warn('[ArtDirection] Vision call failed:', err?.message || err)
    return null
  }
}
