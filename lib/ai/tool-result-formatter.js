/**
 * Tool Result Formatter
 * 
 * Strips verbose tool output from conversation history to reduce token usage
 * and prevent chat UI bloat. Tool results are still sent to Claude for context
 * but aren't displayed in full to the user.
 */

/**
 * Detect and truncate verbose tool results in message content.
 * Preserves the tool call indicator but replaces multi-hundred-line
 * file dumps with a brief summary.
 */
export function stripVerboseToolResults(content) {
  if (!content || typeof content !== 'string') return content

  // Pattern: tool call blocks that contain numbered code (file content)
  // Example:
  //   > 🔧 **read_file** lib/ai/prompt-builder.js
  //   > ↳ lib/ai/prompt-builder.js
  //   > ```
  //   >   1| const foo = ...
  //   >   2| const bar = ...
  //   > ```
  
  // Replace code blocks with line numbers (read_file output) with a placeholder
  const lineNumberedCodePattern = /```[\s\S]*?\n\s*\d+\|[\s\S]*?```/g
  let cleaned = content.replace(lineNumberedCodePattern, (match) => {
    const lines = match.split('\n').filter(l => /^\s*\d+\|/.test(l))
    const lineCount = lines.length
    if (lineCount > 10) {
      return `\`\`\`\n[File content: ${lineCount} lines — collapsed to save space]\n\`\`\``
    }
    return match // keep short snippets
  })

  // Also handle raw tool result blocks (search_files, list_files output)
  // Pattern: blocks starting with "> ↳" followed by long output
  const toolResultPattern = /(>\s*↳.*\n)((?:>.*\n){15,})/g
  cleaned = cleaned.replace(toolResultPattern, (match, header, body) => {
    const bodyLines = body.split('\n').filter(l => l.trim())
    if (bodyLines.length > 15) {
      return `${header}> [Tool output: ${bodyLines.length} lines — collapsed]\n`
    }
    return match
  })

  return cleaned
}

/**
 * Format tool results for display in the chat UI.
 * Returns a concise summary instead of dumping full file contents.
 */
export function formatToolResultForDisplay(toolName, result) {
  if (!result) return '(no output)'

  const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  
  // For read_file: show just the file path and line count
  if (toolName === 'read_file') {
    const lines = resultStr.split('\n')
    const lineCount = lines.filter(l => /^\s*\d+\|/.test(l)).length
    if (lineCount > 0) {
      // Extract file path from first line if present
      const pathMatch = resultStr.match(/^([\w\/.@-]+)\s+\(/)
      const path = pathMatch ? pathMatch[1] : 'file'
      return `✓ Read ${path} (${lineCount} lines)`
    }
  }

  // For search_files / list_files: show count
  if (toolName === 'search_files' || toolName === 'list_files') {
    const lines = resultStr.split('\n').filter(l => l.trim() && !l.includes('(no matches'))
    if (lines.length > 3) {
      return `✓ Found ${lines.length} results`
    }
  }

  // For write_file / edit_file: show success + path
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const pathMatch = resultStr.match(/(?:Created|Updated|Edited)\s+([\w\/.@-]+)/)
    if (pathMatch) {
      return `✓ ${toolName === 'write_file' ? 'Wrote' : 'Edited'} ${pathMatch[1]}`
    }
  }

  // Default: truncate to 200 chars
  if (resultStr.length > 200) {
    return resultStr.substring(0, 200) + `... (${resultStr.length} chars total)`
  }

  return resultStr
}
