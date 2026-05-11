// ── Read Files Follow-up Directive ──
//
// Given the toolResult string returned by handleReadFiles, decide which
// system directive to inject into the agent loop as the next user message.
//
// Critical for breaking the "I'll search the codebase" → narrate-forever
// failure mode: when read_files returns FILE NOT FOUND, the AI must be
// told (deterministically, not via prompt) to call exec_command next.
//
// Pure function. No I/O. Safe to unit-test.

/**
 * Pick the next-iteration system directive based on a read_files tool result.
 * @param {string} toolResult — what handleReadFiles returned
 * @param {number} agentLoopCount — current agent loop iteration count
 * @returns {string | null} — content for a new user message, or null for none
 */
export function pickReadFilesDirective(toolResult, agentLoopCount) {
  const text = typeof toolResult === 'string' ? toolResult : ''
  // A file was successfully read iff we see " lines)" followed by a fenced code block
  // OR an "auto-recovered" marker (we transparently loaded a same-basename match)
  const someSucceeded = / lines\)/.test(text) && /```/.test(text)
  const someFailed = /FILE NOT FOUND/.test(text)
  const hasCandidates = /Candidates with same filename/.test(text)
  const autoRecovered = /auto-recovered/.test(text)

  // Case A: every requested path failed AND no candidate list — force exec_command
  if (someFailed && !hasCandidates && !someSucceeded && !autoRecovered) {
    return '[SYSTEM: Your read_files call returned FILE NOT FOUND for every requested path — the paths you guessed do not exist. Do NOT stop. Do NOT ask the user. Do NOT narrate again. Call `exec_command` RIGHT NOW with `find /app -type f -name "*<keyword>*" -not -path "*/node_modules/*" 2>/dev/null | head -10` (or `grep -rln "<unique-string>" /app/lib /app/app /app/components 2>/dev/null | head -10`) to locate the real path. After exec_command returns, call read_files again with the real path. Then respond with concrete findings.]'
  }

  // Case B: candidate list returned — force a precise retry
  if (hasCandidates) {
    return '[SYSTEM: read_files returned multiple candidate paths. Pick the most likely one based on the user\'s request and call read_files again with that exact path. Do NOT ask the user — choose based on context.]'
  }

  // Case C: mixed result — some succeeded, some failed
  if (someFailed && (someSucceeded || autoRecovered) && agentLoopCount >= 1) {
    return '[SYSTEM: Some files in your last read_files call returned FILE NOT FOUND. For any successfully-read files, use `search_replace` to make changes (copy EXACT text as old_str). For the not-found files, use `exec_command` to locate them, then read_files again. Do NOT narrate intent — call the tools now.]'
  }

  // Case D: full success — default search_replace nudge (only after loop iteration >= 1)
  if (agentLoopCount >= 1 && (someSucceeded || autoRecovered)) {
    return '[SYSTEM: You have now read the file contents with line numbers. Use `search_replace` to make changes — copy the EXACT text to change as old_str and write the replacement as new_str. This is the safest method. Match indentation exactly. Do NOT describe what you will do — call the tool now.]'
  }

  // First-iteration success: no nudge yet, let the AI decide
  return null
}
