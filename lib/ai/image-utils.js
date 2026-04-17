/**
 * Image utilities for Creative Brief art direction.
 * Prepares uploaded images for GPT-4o vision input.
 * 
 * Uses detail: 'low' which costs a fixed 85 tokens per image regardless of size.
 * This means we don't need to resize — GPT gets a 512x512 thumbnail automatically.
 */

const MAX_BASE64_LENGTH = 500000 // ~375KB — skip images larger than this

/**
 * Prepare art direction images for GPT-4o vision input.
 * Returns an array of { type: "image_url", image_url: { url, detail } } objects.
 * Limits to 2 images max to control token usage.
 */
export async function prepareVisionImages(attachments) {
  if (!attachments?.length) return []

  const imageAttachments = attachments
    .filter(a => a.type === 'image' && a.data && typeof a.data === 'string')
    .filter(a => a.data.startsWith('data:image/'))
    .filter(a => a.data.length <= MAX_BASE64_LENGTH) // Skip very large images
    .slice(0, 2) // Max 2 images

  return imageAttachments.map(att => ({
    type: 'image_url',
    image_url: {
      url: att.data,
      detail: 'low' // Fixed 85 tokens per image — GPT auto-thumbnails to 512x512
    }
  }))
}
