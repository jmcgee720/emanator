/**
 * screenshot_preview — Agent tool that captures the live rendered state
 * of the project's Fly preview and returns it as a vision content block
 * the model can SEE.
 *
 * This closes the #1 hardest agent failure mode in Auroraly: the model
 * confidently editing the wrong file because its only ground truth was
 * grep results + filenames. With this tool, the model can:
 *   1. Take a "before" screenshot to verify which screen the user is
 *      actually looking at (vs guessing from keywords).
 *   2. Make its edit.
 *   3. Take an "after" screenshot to verify the change actually shows
 *      up in the rendered output.
 *   4. If the after-screenshot doesn't show the intended change, retry
 *      or ask the user — not declare success based on grep alone.
 *
 * The actual capture happens server-side via /api/screenshots/capture
 * which forwards to ScreenshotOne. See lib/api/routes/screenshots.js
 * for the rationale on using a hosted service vs self-hosted Playwright.
 *
 * The tool result returns Anthropic content blocks (a tagged-text block
 * + an image block). agent-core's existing tool_result handling already
 * passes arrays-of-blocks through to the model verbatim, so the model
 * gets BOTH the metadata (URL, dimensions, capture time) AND the pixels
 * in its next turn.
 *
 * The `appBaseUrl` argument is the deployment's own origin (e.g.
 * https://www.auroraly.co) — required because the tool runs inside the
 * agent loop which has no Request object, so it can't use a relative
 * fetch.
 */
export function screenshotPreviewTool(projectId, appBaseUrl, authHeaders = {}) {
  return {
    name: 'screenshot_preview',
    description: [
      "Capture a live screenshot of the project's running preview and SEE the rendered pixels. Use this BEFORE editing UI to confirm which screen the user is looking at, and AFTER editing to verify your change is visible in the rendered output.",
      'When to call:',
      '  • The user references something they SEE ("the gold background", "the inventory screen", "the loading image"). Screenshot first to ground-truth which screen they mean — do NOT guess from filenames.',
      "  • After ANY change to JSX, TSX, CSS, Tailwind classes, image references, or anything that affects rendered output. Screenshot to verify your edit is actually in the rendered output before declaring success.",
      '  • The user says "it still looks wrong" or "nothing changed". Screenshot to see what they see.',
      'When NOT to call:',
      '  • Pure backend / config / non-UI edits (package.json, .env, server logic).',
      '  • Inside a tight loop — the user pays per screenshot. Once before, once after, is enough for most tasks.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: "One-line reason for this capture (e.g. 'before edit - locate inventory screen' or 'after edit - verify kitchen scene renders'). Helps the user audit your visual reasoning in the chat transcript.",
        },
        wait_for: {
          type: 'string',
          description: 'Optional CSS selector to wait for before capturing (useful for canvases or async-mounted components). Example: "canvas" or "[data-screen=\'worldmap\']".',
        },
        viewport_width: {
          type: 'number',
          description: 'Optional viewport width in CSS pixels. Defaults to 400 to match the Auroraly preview iframe.',
        },
        viewport_height: {
          type: 'number',
          description: 'Optional viewport height in CSS pixels. Defaults to 700 to match the Auroraly preview iframe.',
        },
        full_page: {
          type: 'boolean',
          description: 'If true, capture the full scrollable page instead of just the viewport. Default false (matches what the user sees).',
        },
      },
      required: ['reason'],
    },
    async execute({ reason, wait_for, viewport_width, viewport_height, full_page }) {
      if (!projectId) {
        return 'screenshot_preview unavailable: this tool only works in project chats with a running preview. (Self-edit / Core System chats do not have a Fly preview URL to capture.)'
      }
      if (!appBaseUrl) {
        return 'screenshot_preview unavailable: app base URL not configured. Contact platform owner.'
      }

      try {
        const res = await fetch(`${appBaseUrl}/api/screenshots/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            projectId,
            waitFor: wait_for,
            viewportWidth: viewport_width,
            viewportHeight: viewport_height,
            fullPage: full_page,
          }),
        })

        if (!res.ok) {
          let detail = ''
          try {
            const j = await res.json()
            // Surface the action_required hint verbatim so the user sees
            // the exact setup step (env var, sign-up URL).
            detail = j.action_required || j.error || JSON.stringify(j)
          } catch {
            detail = await res.text().catch(() => `HTTP ${res.status}`)
          }
          return `screenshot_preview failed (${res.status}): ${detail}`
        }

        const { url, captured_at, mime_type, bytes, base64 } = await res.json()

        // Anthropic multi-block tool result: text describing what was
        // captured + the image itself. The model reads both blocks on
        // its next turn — text gives provenance, image gives pixels.
        // agent-core's tool_result handler passes content arrays straight
        // through to messages, so the model receives the vision block
        // exactly like a user-uploaded image attachment.
        return [
          {
            type: 'text',
            text: [
              `📸 Screenshot captured (${reason || 'no reason given'})`,
              `URL: ${url}`,
              `Captured: ${captured_at}`,
              `Size: ${(bytes / 1024).toFixed(1)} KB`,
              '',
              'NEXT STEP: actually LOOK at this image. Describe what you see in 1-2 sentences before proceeding. Do NOT skip this — visual grounding is the entire point of this tool.',
            ].join('\n'),
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mime_type || 'image/png',
              data: base64,
            },
          },
        ]
      } catch (err) {
        return `screenshot_preview error: ${err?.message || 'network failure'}`
      }
    },
  }
}
