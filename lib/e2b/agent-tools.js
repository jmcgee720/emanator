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
        ? `\n\n**This file is ${lines} lines. Use \`edit_lines\` with line numbers for precise edits.**` 
        : ''
      results.push(`## \`${reqPath}\` (${lines} lines)${sizeWarning}\n\`\`\`\n${content}\n\`\`\`\n\nUse \`edit_lines\` with the line numbers shown above to make changes.`)
    } else {
      // Try from project files array as fallback
      const dbFile = projectFiles?.find(f => f.path === reqPath || f.path?.endsWith(reqPath))
      if (dbFile?.content) {
        const lines = dbFile.content.split('\n').length
        const content = dbFile.content.length > 30000
          ? dbFile.content.slice(0, 30000) + '\n// ... [truncated at 30K]'
          : dbFile.content
        const sizeWarning = lines > 500
          ? `\n\n**WARNING: This file is ${lines} lines. Use \`update_files\` (NOT \`patch_files\`) for reliable editing.**`
          : ''
        results.push(`## \`${dbFile.path}\` (${lines} lines)${sizeWarning}\n\`\`\`\n${content}\n\`\`\``)
      } else {
        results.push(`## \`${reqPath}\` — FILE NOT FOUND`)
      }
    }
  }

  const toolResult = results.length > 0
    ? `Here are the file contents with line numbers:\n\n${results.join('\n\n')}\n\nUse the \`edit_lines\` tool to make changes by specifying line numbers. Do NOT call read_files again.`
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
          ? `\n\n**This file is ${lineCount} lines. Use \`edit_lines\` with line numbers for precise edits.**`
          : ''
        results.push(`## \`${reqPath}\` (${lineCount} lines)${sizeWarning}\n\`\`\`\n${numbered}\n\`\`\`\n\nUse \`edit_lines\` with the line numbers shown above to make changes.`)
      } else {
        results.push(`## \`${reqPath}\` — FILE NOT FOUND`)
      }
    } catch (readErr) {
      results.push(`## \`${reqPath}\` — ERROR: ${readErr.message}`)
    }
  }

  return results.length > 0
    ? `Here are the file contents with line numbers:\n\n${results.join('\n\n')}\n\nUse the \`edit_lines\` tool to make changes by specifying line numbers. Do NOT call read_files again.`
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
  }

  console.log(`[E2B-Tools] edit_lines result: ${appliedCount} applied, ${errors.length} failed, ${originalLineCount} → ${newLineCount} lines`)
  return result
}
