/**
 * Agent Memory & State Tracking
 * 
 * Persistent memory system to reduce redundant questions and circular debugging.
 * Tracks:
 *   - File locations discovered during the session
 *   - Attempted fixes and their outcomes
 *   - Known project structure facts
 *   - Failed approaches to avoid repeating
 * 
 * Design: memory is stored in message metadata and reconstructed from chat
 * history on each turn. No external state — everything lives in the DB.
 */

/**
 * Extract memory facts from prior messages in the conversation.
 * Returns a structured memory object with:
 *   - files: Map<path, { created_by, last_seen_turn, purpose }>
 *   - attempts: Array<{ symptom, approach, outcome, turn }>
 *   - facts: Map<key, value> — arbitrary project facts
 */
export function extractMemoryFromHistory(messages) {
  const memory = {
    files: new Map(),
    attempts: [],
    facts: new Map(),
    lastTurnNumber: 0,
  }

  if (!Array.isArray(messages)) return memory

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const turn = i + 1
    memory.lastTurnNumber = turn

    // Extract from assistant metadata (where we'll store memory snapshots)
    if (msg.role === 'assistant' && msg.metadata?.memory) {
      const m = msg.metadata.memory
      
      // Merge file discoveries
      if (m.files && typeof m.files === 'object') {
        for (const [path, info] of Object.entries(m.files)) {
          memory.files.set(path, { ...info, last_seen_turn: turn })
        }
      }
      
      // Append attempts (chronological order matters)
      if (Array.isArray(m.attempts)) {
        memory.attempts.push(...m.attempts.map(a => ({ ...a, turn })))
      }
      
      // Merge facts (later values override earlier ones)
      if (m.facts && typeof m.facts === 'object') {
        for (const [k, v] of Object.entries(m.facts)) {
          memory.facts.set(k, v)
        }
      }
    }

    // Infer file operations from tool calls in content
    // (fallback for messages that predate explicit memory tracking)
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      const writeMatch = msg.content.match(/🔧 \*\*write_file\*\* ([^\n]+)/g)
      if (writeMatch) {
        for (const match of writeMatch) {
          const pathMatch = match.match(/write_file\*\* (.+)/)
          if (pathMatch) {
            const path = pathMatch[1].trim()
            if (!memory.files.has(path)) {
              memory.files.set(path, {
                created_by: 'inferred',
                last_seen_turn: turn,
                purpose: 'unknown',
              })
            }
          }
        }
      }
    }
  }

  return memory
}

/**
 * Build a concise memory summary for injection into the system prompt.
 * Returns a markdown string suitable for appending to the prompt.
 */
export function buildMemorySummary(memory) {
  if (!memory) return ''

  const parts = []

  // File registry
  if (memory.files.size > 0) {
    const recentFiles = Array.from(memory.files.entries())
      .sort((a, b) => b[1].last_seen_turn - a[1].last_seen_turn)
      .slice(0, 20) // cap at 20 most recent
    
    parts.push('## SESSION MEMORY — FILES YOU CREATED/DISCOVERED')
    parts.push('')
    parts.push('You have already located or created these files in this conversation:')
    for (const [path, info] of recentFiles) {
      const purpose = info.purpose && info.purpose !== 'unknown' ? ` — ${info.purpose}` : ''
      parts.push(`  • \`${path}\`${purpose}`)
    }
    parts.push('')
    parts.push('**DO NOT ask the user "where should I put this file?" if it already exists in this list.** Read it, edit it, or reference it directly.')
    parts.push('')
  }

  // Attempted fixes
  if (memory.attempts.length > 0) {
    const recentAttempts = memory.attempts.slice(-10) // last 10 attempts
    parts.push('## SESSION MEMORY — WHAT YOU\'VE TRIED')
    parts.push('')
    parts.push('Previous fix attempts in this conversation:')
    for (const attempt of recentAttempts) {
      const outcome = attempt.outcome === 'failed' ? '❌ FAILED' : attempt.outcome === 'success' ? '✅ worked' : '⏳ pending'
      parts.push(`  • **${attempt.symptom}** → tried: ${attempt.approach} → ${outcome}`)
    }
    parts.push('')
    parts.push('**DO NOT repeat failed approaches.** If a fix failed, investigate WHY before trying a variant.')
    parts.push('')
  }

  // Known facts
  if (memory.facts.size > 0) {
    parts.push('## SESSION MEMORY — KNOWN PROJECT FACTS')
    parts.push('')
    for (const [key, value] of memory.facts.entries()) {
      parts.push(`  • **${key}**: ${value}`)
    }
    parts.push('')
  }

  if (parts.length === 0) return ''

  return [
    '',
    '═══════════════════════════════════════════════════════════════════',
    '                         PERSISTENT MEMORY',
    '═══════════════════════════════════════════════════════════════════',
    '',
    ...parts,
    '**CRITICAL**: This memory exists to PREVENT redundant questions. If the answer is in this section, ACT on it — do not ask the user to confirm what you already know.',
    '',
  ].join('\n')
}

/**
 * Record a file operation in memory.
 * Returns an updated memory object (does not mutate the input).
 */
export function recordFileOperation(memory, path, operation, purpose = '') {
  const updated = {
    ...memory,
    files: new Map(memory.files),
  }
  
  updated.files.set(path, {
    created_by: operation, // 'write_file', 'edit_file', 'discovered'
    last_seen_turn: memory.lastTurnNumber + 1,
    purpose: purpose || updated.files.get(path)?.purpose || 'unknown',
  })
  
  return updated
}

/**
 * Record a fix attempt in memory.
 * Returns an updated memory object.
 */
export function recordAttempt(memory, symptom, approach, outcome = 'pending') {
  const updated = {
    ...memory,
    attempts: [...memory.attempts],
  }
  
  updated.attempts.push({
    symptom,
    approach,
    outcome, // 'pending', 'success', 'failed'
    turn: memory.lastTurnNumber + 1,
  })
  
  return updated
}

/**
 * Record a project fact in memory.
 * Returns an updated memory object.
 */
export function recordFact(memory, key, value) {
  const updated = {
    ...memory,
    facts: new Map(memory.facts),
  }
  
  updated.facts.set(key, value)
  return updated
}

/**
 * Serialize memory to a plain object for storage in message metadata.
 */
export function serializeMemory(memory) {
  return {
    files: Object.fromEntries(memory.files),
    attempts: memory.attempts,
    facts: Object.fromEntries(memory.facts),
  }
}

/**
 * Build a turn summary for the assistant to emit at the end of each response.
 * This is a short, structured recap of what was done this turn — helps the
 * model (and the user) track progress and avoid circular debugging.
 */
export function buildTurnSummary(events) {
  const parts = []
  
  const toolCalls = events.filter(e => e.type === 'tool_use')
  const errors = events.filter(e => e.type === 'error')
  
  if (toolCalls.length > 0) {
    const grouped = {}
    for (const tc of toolCalls) {
      grouped[tc.name] = (grouped[tc.name] || 0) + 1
    }
    const summary = Object.entries(grouped)
      .map(([name, count]) => `${name}${count > 1 ? ` (×${count})` : ''}`)
      .join(', ')
    parts.push(`**Actions taken**: ${summary}`)
  }
  
  if (errors.length > 0) {
    parts.push(`**Errors encountered**: ${errors.length}`)
  }
  
  return parts.length > 0 ? `\n\n---\n**Turn summary**: ${parts.join(' · ')}\n` : ''
}

/**
 * ASSUMPTION-FIRST RESPONSE PROTOCOL
 * 
 * Injected into system prompts to encourage the agent to make reasonable
 * assumptions and act, rather than asking the user for information it can
 * discover itself.
 */
export const ASSUMPTION_FIRST_PROTOCOL = [
  'ASSUMPTION-FIRST RESPONSES — REDUCE QUESTION LOOPS:',
  '',
  'Your goal is to SOLVE problems, not to interview the user. When you need information:',
  '',
  '  1. **Check session memory first** — if the file location, project structure, or prior attempt is already recorded, USE IT. Do not ask the user to re-confirm.',
  '  2. **Make reasonable assumptions** — if the user says "fix the login button" and you see a Button.jsx in src/components/, assume that\'s the file. Read it and fix it. Do not ask "which button file?"',
  '  3. **Discover before asking** — use list_files, search_files, read_file to find the answer yourself. Only ask the user when you\'ve exhausted tooling and the answer is genuinely ambiguous.',
  '  4. **Propose, don\'t poll** — instead of "Should I create a new file or edit the existing one?", say "I\'ll edit src/components/Button.jsx to fix the alignment" and do it. If you\'re wrong, the user will correct you — that\'s faster than a question loop.',
  '',
  '**Forbidden question patterns** (these waste the user\'s time):',
  '  ❌ "Where should I create this file?" — check session memory, infer from project structure, or use a sensible default (src/components/ for React components, etc.)',
  '  ❌ "Should I use approach A or B?" — pick the most likely one based on the codebase and context. If it doesn\'t work, try the other.',
  '  ❌ "Can you show me the error?" — if you need to see an error, ask the user to run a specific command or check a specific place (console, network tab, server logs). Be directive.',
  '  ❌ "What framework are you using?" — read package.json or index.html to find out.',
  '',
  '**When to ask questions** (the only valid cases):',
  '  • The user\'s request is genuinely ambiguous AND you cannot infer intent from context (rare)',
  '  • You need external information you cannot access via tools (API keys, user preferences, design decisions)',
  '  • You tried an approach, it failed, and you need runtime data from the user to diagnose (console errors, network logs, etc.)',
  '',
  'Default to ACTION. Questions are a last resort.',
].join('\n')
