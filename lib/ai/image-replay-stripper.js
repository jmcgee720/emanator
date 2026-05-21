/**
 * Image-replay stripper — drops image bytes from chat history once
 * the agent has already produced a structured inventory of them via
 * submit_screenshot_inventory.
 *
 * Why this saves tokens:
 *   Anthropic counts each image at ~1500 tokens. Without stripping,
 *   the same screenshot is replayed on EVERY subsequent turn of the
 *   chat — turn 5 has the image, turn 6 replays it, turn 7 replays
 *   it, … On a debugging chat with 10 screenshots this is 15K
 *   wasted tokens per turn after the screenshots stop arriving.
 *
 * Why it is safe to drop:
 *   We only strip images that were followed by a
 *   submit_screenshot_inventory tool call in the next assistant
 *   turn. That tool produces a structured text inventory (visible
 *   elements, text quotes, cropped regions, layout notes, verdict)
 *   that is strictly more useful than re-viewing the image. The
 *   inventory tool_use and the resulting tool_result are both
 *   preserved in the history, so the agent has full access to the
 *   analysis. Only the raw pixels go.
 *
 *   Images NOT followed by an inventory call are left intact — they
 *   may be the user's most recent screenshot the agent has not yet
 *   processed, or a non-debug attachment (e.g. an example design
 *   reference) the agent may want to look at again.
 *
 * Why this is a separate module:
 *   Stream-handler concerns: routing, prompt assembly, billing.
 *   Token-saving transformations like this one are independently
 *   testable and composable. Compaction (lib/ai/context-compactor)
 *   handles the bulk-summary path; this handles the per-image fine
 *   path. They run sequentially.
 */

const PLACEHOLDER_TEXT = '[image attached here was analyzed via submit_screenshot_inventory in the next turn. The structured inventory (visible elements, text quotes, cropped regions, verdict) is in that tool_use call and its tool_result — read those for the contents. Raw image bytes were dropped to keep this chat under the 200K token ceiling. If you genuinely need to re-examine pixels, ask the user to re-upload the screenshot.]'

/**
 * Walk the messages array and return a new array where any image
 * blocks in a user message immediately followed by an assistant
 * submit_screenshot_inventory tool call are replaced with a text
 * placeholder. All other content is untouched.
 *
 * Returns { messages, droppedImages, freedTokensEstimate }.
 *   - droppedImages: total image blocks replaced
 *   - freedTokensEstimate: rough token savings (1500 per image)
 */
export function stripInventoriedImages(messages) {
  if (!Array.isArray(messages)) return { messages, droppedImages: 0, freedTokensEstimate: 0 }

  let dropped = 0
  const out = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (
      m?.role === 'user' &&
      Array.isArray(m.content) &&
      m.content.some((b) => b?.type === 'image')
    ) {
      // Check if the very next assistant message contains a
      // submit_screenshot_inventory tool_use block. If yes, the
      // image is inventoried — safe to strip.
      const nextAssistant = messages[i + 1]
      const inventoried =
        nextAssistant?.role === 'assistant' &&
        Array.isArray(nextAssistant.content) &&
        nextAssistant.content.some(
          (b) => b?.type === 'tool_use' && b?.name === 'submit_screenshot_inventory',
        )
      if (inventoried) {
        const newContent = m.content.map((b) => {
          if (b?.type === 'image') {
            dropped++
            return { type: 'text', text: PLACEHOLDER_TEXT }
          }
          return b
        })
        out.push({ ...m, content: newContent })
        continue
      }
    }
    out.push(m)
  }

  return {
    messages: out,
    droppedImages: dropped,
    freedTokensEstimate: dropped * 1500,
  }
}

/**
 * Convenience export used by tests + a future "show me what I stripped"
 * debugging tool.
 */
export const INVENTORIED_IMAGE_PLACEHOLDER = PLACEHOLDER_TEXT
