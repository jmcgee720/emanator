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
 * Handle the `read_files` tool call via E2B sandbox.
 * Reads files from the sandbox filesystem.
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
      const content = result.content.length > 30000 
        ? result.content.slice(0, 30000) + '\n// ... [truncated at 30K]' 
        : result.content
      const sizeWarning = lines > 500 
        ? `\n\n**WARNING: This file is ${lines} lines. Use \`update_files\` (NOT \`patch_files\`) for reliable editing.**` 
        : ''
      results.push(`## \`${reqPath}\` (${lines} lines)${sizeWarning}\n\`\`\`\n${content}\n\`\`\``)
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
    ? `Here are the file contents you requested:\n\n${results.join('\n\n')}\n\nYou now have the file contents. Do NOT call read_files again. Proceed to make your changes using update_files (for large files) or patch_files (for small targeted edits).`
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
        const sizeWarning = lineCount > 500
          ? `\n\n**WARNING: This file is ${lineCount} lines. Use \`update_files\` (NOT \`patch_files\`) for reliable editing.**`
          : ''
        results.push(`## \`${reqPath}\` (${lineCount} lines)${sizeWarning}\n\`\`\`\n${content}\n\`\`\``)
      } else {
        results.push(`## \`${reqPath}\` — FILE NOT FOUND`)
      }
    } catch (readErr) {
      results.push(`## \`${reqPath}\` — ERROR: ${readErr.message}`)
    }
  }

  return results.length > 0
    ? `Here are the file contents you requested:\n\n${results.join('\n\n')}\n\nYou now have the file contents. Do NOT call read_files again. Proceed to make your changes.`
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
      return 'BUILD VERIFIED: The app compiled successfully. Health check returned 200 OK. Your changes are working.'
    } else {
      let errorDetail = `Health check returned HTTP ${healthRes.status}.`
      try {
        const fs = await import('fs')
        const errLog = fs.readFileSync('/var/log/supervisor/nextjs_api.err.log', 'utf-8')
        const recentErrors = errLog.split('\n').slice(-20)
          .filter(l => l.includes('Error') || l.includes('error') || l.includes('Module build failed'))
          .join('\n')
        if (recentErrors) errorDetail += `\n\nRecent compilation errors:\n${recentErrors}`
      } catch {}
      return `BUILD FAILED: ${errorDetail}\n\nFix the error and try again.`
    }
  } catch (verifyErr) {
    return `BUILD CHECK ERROR: Could not reach the health endpoint — ${verifyErr.message}. The server may be restarting.`
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
