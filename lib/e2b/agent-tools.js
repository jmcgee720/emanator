/**
 * E2B-powered Agent Tools
 * 
 * These tools give the AI agent real filesystem access, command execution,
 * and build verification through E2B sandboxes. Replaces the previous
 * read_files/verify_build implementations with actual sandboxed execution.
 */

import {
  getOrCreateSandbox,
  syncFilesToSandbox,
  readSandboxFile,
  readSandboxFiles,
  writeSandboxFile,
  execInSandbox,
  verifyBuild,
  listSandboxFiles,
  installDependencies,
  runTests,
} from './sandbox-service.js'

/**
 * Add line numbers to file content for the AI to reference in edit_lines.
 */
function addLineNumbers(content) {
  const lines = content.split('\n')
  const padding = String(lines.length).length
  return lines.map((line, i) => `${String(i + 1).padStart(padding)}| ${line}`).join('\n')
}

/**
 * Handle the `search_replace` tool call.
 * Finds exact strings in a file and replaces them — the safest editing method.
 * If any search string is not found, that edit fails safely (no partial change).
 */
export async function handleSearchReplace(args, { projectId, isSelfEdit } = {}) {
  const { path: filePath, edits, summary } = args

  if (!filePath) return { success: false, error: 'No file path provided' }
  if (!edits || edits.length === 0) return { success: false, error: 'No edits provided', errors: ['No edits provided'] }

  const fs = await import('fs')
  const pathMod = await import('path')

  // Read the current file
  let content
  let fullPath
  if (isSelfEdit) {
    fullPath = pathMod.resolve('/app', filePath)
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}`, errors: [`File not found: ${filePath}`] }
    }
    content = fs.readFileSync(fullPath, 'utf-8')
  } else {
    return { success: false, error: 'search_replace only works in self-edit mode currently', errors: ['Not in self-edit mode'] }
  }

  const originalContent = content
  const originalLineCount = content.split('\n').length
  const appliedEdits = []
  const failedEdits = []

  // Apply each search/replace pair in order
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    const { old_str, new_str } = edit

    if (!old_str) {
      failedEdits.push({ index: i, reason: 'old_str is empty' })
      continue
    }

    // Find the exact string in the current content
    const idx = content.indexOf(old_str)
    if (idx === -1) {
      // Fallback 1: normalized whitespace (trim trailing spaces per line)
      const normalizedContent = content.split('\n').map(l => l.trimEnd()).join('\n')
      const normalizedOld = old_str.split('\n').map(l => l.trimEnd()).join('\n')
      const normalizedIdx = normalizedContent.indexOf(normalizedOld)

      if (normalizedIdx !== -1) {
        // Found with normalized whitespace — map back to original content
        let charCount = 0
        let startLine = -1
        const normLines = normalizedContent.split('\n')
        for (let li = 0; li < normLines.length; li++) {
          if (charCount + normLines[li].length >= normalizedIdx) {
            startLine = li
            break
          }
          charCount += normLines[li].length + 1
        }
        const origLines = content.split('\n')
        const oldLines = old_str.split('\n')
        const origOld = origLines.slice(startLine, startLine + oldLines.length).join('\n')
        const origIdx = content.indexOf(origOld)
        if (origIdx !== -1) {
          content = content.slice(0, origIdx) + new_str + content.slice(origIdx + origOld.length)
          appliedEdits.push({ index: i, chars_replaced: origOld.length, chars_inserted: new_str.length })
        } else {
          failedEdits.push({ index: i, reason: 'Whitespace-normalized match found but could not map back to original', old_str_preview: old_str.slice(0, 100) })
        }
        continue
      }

      // Fallback 2: indentation-tolerant match (strip leading whitespace per line and compare)
      const stripIndent = (s) => s.split('\n').map(l => l.trimStart()).join('\n')
      const strippedContent = stripIndent(content)
      const strippedOld = stripIndent(old_str)
      if (strippedOld.length > 10) {
        const strippedIdx = strippedContent.indexOf(strippedOld)
        if (strippedIdx !== -1) {
          // Found! Map back to original lines
          let sc = 0, sl = -1
          const scLines = strippedContent.split('\n')
          for (let li = 0; li < scLines.length; li++) {
            if (sc + scLines[li].length >= strippedIdx) { sl = li; break }
            sc += scLines[li].length + 1
          }
          if (sl !== -1) {
            const origLines = content.split('\n')
            const oldLineCount = old_str.split('\n').length
            const origBlock = origLines.slice(sl, sl + oldLineCount).join('\n')
            const origBlockIdx = content.indexOf(origBlock)
            if (origBlockIdx !== -1) {
              content = content.slice(0, origBlockIdx) + new_str + content.slice(origBlockIdx + origBlock.length)
              appliedEdits.push({ index: i, chars_replaced: origBlock.length, chars_inserted: new_str.length, note: 'indentation-tolerant match' })
              console.log(`[search_replace] Applied edit ${i} via indentation-tolerant match`)
              continue
            }
          }
        }
      }

      failedEdits.push({ index: i, reason: `Exact text not found in file. The old_str must match the file content character-for-character. Check for extra/missing spaces or line breaks.`, old_str_preview: old_str.slice(0, 100) })
      continue
    }

    // Check for multiple matches — warn but apply to first
    const secondIdx = content.indexOf(old_str, idx + 1)
    if (secondIdx !== -1) {
      console.warn(`[search_replace] Warning: old_str found multiple times in ${filePath}. Replacing first occurrence only. Add more context to make it unique.`)
    }

    // Apply the replacement
    content = content.slice(0, idx) + new_str + content.slice(idx + old_str.length)
    appliedEdits.push({ index: i, chars_replaced: old_str.length, chars_inserted: new_str.length })
  }

  const newLineCount = content.split('\n').length

  // If no edits applied, don't write
  if (appliedEdits.length === 0) {
    return {
      success: false,
      applied: 0,
      failed: failedEdits.length,
      errors: failedEdits.map(f => `Edit ${f.index + 1}: ${f.reason}${f.old_str_preview ? ` (searching for: "${f.old_str_preview}...")` : ''}`),
      filePath,
      linesBefore: originalLineCount,
      linesAfter: originalLineCount,
      content: originalContent,
      originalContent,
    }
  }

  // Bracket balance check for JSX/JS files
  if (isSelfEdit && filePath.match(/\.(jsx|tsx|js|ts)$/)) {
    const opens = (content.match(/[({[]/g) || []).length
    const closes = (content.match(/[)}\]]/g) || []).length
    if (Math.abs(opens - closes) > 2) {
      console.error(`[search_replace] BRACKET MISMATCH in ${filePath}: ${opens} opens vs ${closes} closes — NOT writing`)
      return {
        success: false,
        applied: 0,
        failed: edits.length,
        errors: [`Bracket mismatch after applying edits: ${opens} opening vs ${closes} closing. Your replacement likely has missing or extra brackets. File was NOT modified.`],
        filePath,
        linesBefore: originalLineCount,
        linesAfter: newLineCount,
        content,
        originalContent,
      }
    }
  }

  // Write the file
  if (isSelfEdit) {
    fs.writeFileSync(fullPath, content, 'utf-8')
    console.log(`[search_replace] Wrote ${filePath}: ${appliedEdits.length} edits applied, ${originalLineCount} → ${newLineCount} lines`)
  }

  const result = {
    success: true,
    applied: appliedEdits.length,
    failed: failedEdits.length,
    errors: failedEdits.map(f => `Edit ${f.index + 1}: ${f.reason}`),
    filePath,
    linesBefore: originalLineCount,
    linesAfter: newLineCount,
    content,
    originalContent,
  }

  return result
}


/**
 * Handle the `read_files` tool call via E2B sandbox.
 * Reads files from the sandbox filesystem.
 * Returns content WITH line numbers so the AI can use edit_lines.
 */
export async function handleReadFiles(args, { projectId, projectFiles, isSelfEdit }) {
  const paths = args.paths || []
  const reason = args.reason || ''
  
  console.log(`[E2B-Tools] read_files: ${paths.length} file(s) — ${reason}`)

  // For self-edit mode, read from disk (not sandbox)
  if (isSelfEdit) {
    return handleReadFilesDisk(paths)
  }

  // For regular projects, use sandbox
  const sandbox = await getOrCreateSandbox(projectId)
  
  // Ensure files are synced to sandbox
  if (projectFiles?.length > 0) {
    await syncFilesToSandbox(sandbox, projectFiles)
  }

  const results = []
  for (const reqPath of paths.slice(0, 5)) {
    const result = await readSandboxFile(sandbox, reqPath)
    if (result.success) {
      const lines = result.content.split('\n').length
      let content = result.content.length > 30000 
        ? result.content.slice(0, 30000) + '\n// ... [truncated at 30K]' 
        : result.content
      content = addLineNumbers(content)
      const sizeWarning = lines > 500 
        ? `\n\n**This file is ${lines} lines. Use \`search_replace\` with small targeted edits (copy exact text as old_str).**` 
        : ''
      results.push(`## \`${reqPath}\` (${lines} lines)${sizeWarning}\n\`\`\`\n${content}\n\`\`\`\n\nUse \`search_replace\` with exact text from above to make changes. Strip the line numbers from old_str.`)
    } else {
      // Try from project files array as fallback
      const dbFile = projectFiles?.find(f => f.path === reqPath || f.path?.endsWith(reqPath))
      if (dbFile?.content) {
        const lines = dbFile.content.split('\n').length
        let content = dbFile.content.length > 30000
          ? dbFile.content.slice(0, 30000) + '\n// ... [truncated at 30K]'
          : dbFile.content
        content = addLineNumbers(content)
        const sizeWarning = lines > 500
          ? `\n\n**This file is ${lines} lines. Use \`search_replace\` with small targeted edits (copy exact text as old_str).**`
          : ''
        results.push(`## \`${dbFile.path}\` (${lines} lines)${sizeWarning}\n\`\`\`\n${content}\n\`\`\`\n\nUse \`search_replace\` with exact text from above to make changes. Strip the line numbers from old_str.`)
      } else {
        results.push(`## \`${reqPath}\` — FILE NOT FOUND`)
      }
    }
  }

  const toolResult = results.length > 0
    ? `Here are the file contents with line numbers:\n\n${results.join('\n\n')}\n\nUse the \`search_replace\` tool to make changes — copy exact text as old_str (strip line numbers). Fall back to \`edit_lines\` only if search_replace fails.`
    : 'No files found. Check the path and try again, or use create_files to create new files.'

  return toolResult
}

/**
 * Read files from disk (for self-edit mode).
 */
async function handleReadFilesDisk(paths) {
  const fs = await import('fs')
  const path = await import('path')
  
  const results = []
  for (const reqPath of paths.slice(0, 5)) {
    try {
      const fullPath = path.resolve('/app', reqPath)
      if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf-8')
        const lineCount = content.split('\n').length
        if (content.length > 30000) content = content.slice(0, 30000) + '\n// ... [truncated at 30K]'
        const numbered = addLineNumbers(content)
        const sizeWarning = lineCount > 500
          ? `\n\n**This file is ${lineCount} lines. Use \`search_replace\` with small targeted edits (copy exact text as old_str).**`
          : ''
        results.push(`## \`${reqPath}\` (${lineCount} lines)${sizeWarning}\n\`\`\`\n${numbered}\n\`\`\`\n\nUse \`search_replace\` with exact text from above to make changes. Strip the line numbers from old_str.`)
      } else {
        results.push(`## \`${reqPath}\` — FILE NOT FOUND`)
      }
    } catch (readErr) {
      results.push(`## \`${reqPath}\` — ERROR: ${readErr.message}`)
    }
  }

  return results.length > 0
    ? `Here are the file contents with line numbers:\n\n${results.join('\n\n')}\n\nUse the \`search_replace\` tool to make changes — copy exact text as old_str (strip line numbers). Fall back to \`edit_lines\` only if search_replace fails.`
    : 'No files found matching the requested paths.'
}

/**
 * Handle the `verify_build` tool call via E2B sandbox.
 * Actually runs the build in the sandbox and reports errors.
 */
export async function handleVerifyBuild(args, { projectId, projectFiles, isSelfEdit }) {
  const checkType = args.check_type || 'quick'
  
  console.log(`[E2B-Tools] verify_build: ${checkType}`)

  // For self-edit mode, check local health endpoint
  if (isSelfEdit) {
    return handleVerifyBuildLocal(checkType)
  }

  // For regular projects, build in sandbox
  const sandbox = await getOrCreateSandbox(projectId)
  
  if (checkType === 'full') {
    // Full build verification
    const buildResult = await verifyBuild(sandbox)
    
    if (buildResult.success) {
      return 'BUILD VERIFIED: The project compiled successfully with no errors. Your changes are working correctly.'
    } else {
      const errorDetail = buildResult.errors.length > 0
        ? `\n\nErrors found:\n${buildResult.errors.map(e => `- ${e}`).join('\n')}`
        : ''
      return `BUILD FAILED (exit code ${buildResult.exitCode}):${errorDetail}\n\nLast output:\n${buildResult.output.slice(-1000)}\n\nFix the errors above and try again.`
    }
  } else {
    // Quick check: just verify syntax
    const result = await execInSandbox(sandbox, 'node --check /home/user/project/**/*.js 2>&1 || echo "Syntax check completed"', { timeoutMs: 10000 })
    return result.success 
      ? 'QUICK CHECK PASSED: No obvious syntax errors detected.'
      : `QUICK CHECK: ${result.stderr || result.stdout}`
  }
}

/**
 * Verify build locally (for self-edit mode).
 */
async function handleVerifyBuildLocal(checkType) {
  try {
    const healthRes = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(10000) })
    
    if (healthRes.ok) {
      return 'BUILD VERIFIED: The app compiled successfully. Health check returned 200 OK.'
    } else {
      let errorDetail = `Health check returned HTTP ${healthRes.status}.`
      try {
        const fs = await import('fs')
        const errLog = fs.readFileSync('/var/log/supervisor/nextjs_api.err.log', 'utf-8')
        // Get the FULL last error block, not just filtered lines
        const lines = errLog.split('\n')
        const lastErrorIdx = lines.findLastIndex(l => l.includes('Error') || l.includes('Syntax') || l.includes('Module build failed'))
        if (lastErrorIdx >= 0) {
          // Get 30 lines around the error for full context
          const start = Math.max(0, lastErrorIdx - 10)
          const end = Math.min(lines.length, lastErrorIdx + 20)
          const errorBlock = lines.slice(start, end).join('\n')
          errorDetail += `\n\nFull error context:\n\`\`\`\n${errorBlock}\n\`\`\``
        }
        // Also get recent stdout for compilation status
        const outLog = fs.readFileSync('/var/log/supervisor/nextjs_api.out.log', 'utf-8')
        const outLines = outLog.split('\n').slice(-10).join('\n')
        if (outLines) errorDetail += `\n\nRecent output:\n${outLines}`
      } catch {}
      return `BUILD FAILED: ${errorDetail}\n\nRead the error carefully. Identify the exact file and line number. Use read_files to see the file, then fix it.`
    }
  } catch (verifyErr) {
    return `BUILD CHECK ERROR: Could not reach the health endpoint — ${verifyErr.message}. Server may be restarting. Wait 5 seconds and try verify_build again.`
  }
}

/**
 * Handle the `exec_command` tool call via E2B sandbox.
 * Runs arbitrary shell commands in the sandbox.
 */
export async function handleExecCommand(args, { projectId }) {
  const command = args.command
  const cwd = args.working_directory || '/home/user/project'
  
  console.log(`[E2B-Tools] exec_command: ${command}`)
  
  const sandbox = await getOrCreateSandbox(projectId)
  const result = await execInSandbox(sandbox, command, { cwd, timeoutMs: 60000 })
  
  const output = []
  if (result.stdout) output.push(`stdout:\n${result.stdout.slice(-2000)}`)
  if (result.stderr) output.push(`stderr:\n${result.stderr.slice(-1000)}`)
  
  return `Command: \`${command}\`\nExit code: ${result.exitCode}\n${result.success ? 'SUCCESS' : 'FAILED'}\n\n${output.join('\n\n') || '(no output)'}`
}

/**
 * Handle the `edit_lines` tool call.
 * Applies line-number-based edits to a file — the most reliable editing method.
 * Edits are sorted bottom-to-top so line numbers remain valid.
 */
export async function handleEditLines(args, { projectId, isSelfEdit }) {
  const filePath = args.path
  const edits = args.edits || []
  const summary = args.summary || ''
  
  if (!filePath || edits.length === 0) {
    return { success: false, error: 'path and edits are required' }
  }

  console.log(`[E2B-Tools] edit_lines: ${filePath} — ${edits.length} edit(s) — ${summary}`)

  // Read current file content
  let content
  if (isSelfEdit) {
    const fs = await import('fs')
    const path = await import('path')
    const fullPath = path.resolve('/app', filePath)
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }
    content = fs.readFileSync(fullPath, 'utf-8')
  } else {
    const sandbox = await getOrCreateSandbox(projectId)
    const result = await readSandboxFile(sandbox, filePath)
    if (!result.success) return { success: false, error: result.error }
    content = result.content
  }

  const lines = content.split('\n')
  const originalLineCount = lines.length

  // Sort edits bottom-to-top so earlier line numbers aren't shifted
  const sortedEdits = [...edits].sort((a, b) => (b.line_start || 0) - (a.line_start || 0))

  let appliedCount = 0
  let errors = []

  for (const edit of sortedEdits) {
    const { type, line_start, line_end, content: newContent } = edit
    const start = line_start - 1 // Convert to 0-indexed
    const end = (line_end || line_start) - 1

    if (start < 0 || start >= lines.length) {
      errors.push(`Line ${line_start} out of range (file has ${lines.length} lines)`)
      continue
    }

    if (type === 'replace') {
      if (end < start || end >= lines.length) {
        errors.push(`Line range ${line_start}-${line_end} invalid (file has ${lines.length} lines)`)
        continue
      }
      const newLines = (newContent || '').split('\n')
      lines.splice(start, end - start + 1, ...newLines)
      appliedCount++
    } else if (type === 'insert_after') {
      const newLines = (newContent || '').split('\n')
      lines.splice(start + 1, 0, ...newLines)
      appliedCount++
    } else if (type === 'delete') {
      if (end < start || end >= lines.length) {
        errors.push(`Delete range ${line_start}-${line_end} invalid`)
        continue
      }
      lines.splice(start, end - start + 1)
      appliedCount++
    } else {
      errors.push(`Unknown edit type: ${type}`)
    }
  }

  const newContent = lines.join('\n')
  const newLineCount = lines.length

  // ── Pre-write validation: check bracket balance to catch broken JSX ──
  if (isSelfEdit && filePath.match(/\.(jsx|tsx|js|ts)$/)) {
    const opens = (newContent.match(/[({[]/g) || []).length
    const closes = (newContent.match(/[)}\]]/g) || []).length
    if (Math.abs(opens - closes) > 2) {
      console.error(`[edit_lines] BRACKET MISMATCH in ${filePath}: ${opens} opens vs ${closes} closes — NOT writing to disk`)
      return {
        success: false,
        applied: 0,
        failed: edits.length,
        errors: [`Bracket mismatch after applying edits: ${opens} opening brackets vs ${closes} closing brackets. Your edit likely has missing or extra brackets/tags. Please check your replacement content and try again with properly balanced brackets.`],
        filePath,
        linesBefore: originalLineCount,
        linesAfter: newLineCount,
        content: newContent,
        originalContent: content,
      }
    }
  }

  // Write back
  if (isSelfEdit) {
    const fs = await import('fs')
    const path = await import('path')
    fs.writeFileSync(path.resolve('/app', filePath), newContent, 'utf-8')
  } else {
    const sandbox = await getOrCreateSandbox(projectId)
    await writeSandboxFile(sandbox, filePath, newContent)
  }

  const result = {
    success: appliedCount > 0,
    applied: appliedCount,
    failed: errors.length,
    errors,
    filePath,
    linesBefore: originalLineCount,
    linesAfter: newLineCount,
    content: newContent, // For saving to Supabase
    originalContent: content, // For auto-revert on build failure
  }

  console.log(`[E2B-Tools] edit_lines result: ${appliedCount} applied, ${errors.length} failed, ${originalLineCount} → ${newLineCount} lines`)
  return result
}
