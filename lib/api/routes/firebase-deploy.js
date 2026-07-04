// ──────────────────────────────────────────────────────────────────────
// Server-side Firebase Functions deployment endpoint
// ──────────────────────────────────────────────────────────────────────
// Runs Firebase CLI on the Auroraly API server (not in preview runner).
// This bypasses preview runner command allowlist restrictions entirely.

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getProjectFiles } from '@/lib/supabase/db.js'

const execAsync = promisify(exec)

/**
 * POST /api/firebase/deploy
 * 
 * Deploy Firebase Functions from a project's files to Firebase.
 * 
 * Body:
 *   {
 *     project_id: string,           // Auroraly project ID
 *     service_account_json: string, // Firebase service account JSON
 *     reason: string                // Optional: why deploying (for logs)
 *   }
 * 
 * Returns:
 *   {
 *     success: true,
 *     function_urls: { api: "https://...", ... },
 *     duration_ms: 12345,
 *     log: "..."
 *   }
 * 
 * OR on failure:
 *   {
 *     success: false,
 *     error: "...",
 *     log: "...",
 *     exit_code: 1
 *   }
 */
export async function handle(route, method, path, request) {
  if (route !== '/api/firebase/deploy') return null
  if (method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const startTime = Date.now()
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { project_id, service_account_json, reason } = body

  if (!project_id) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }
  if (!service_account_json) {
    return NextResponse.json({ error: 'Missing service_account_json' }, { status: 400 })
  }

  // Validate service account JSON
  let serviceAccount
  try {
    serviceAccount = JSON.parse(service_account_json)
    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
      return NextResponse.json({
        error: 'Invalid service account JSON. Must contain project_id, private_key, and client_email.',
      }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({
      error: `Failed to parse service account JSON: ${err.message}`,
    }, { status: 400 })
  }

  // Create a temporary directory for this deployment
  const deployId = randomBytes(8).toString('hex')
  const deployDir = join(tmpdir(), `firebase-deploy-${deployId}`)
  const credsPath = join(deployDir, 'service-account.json')

  try {
    await mkdir(deployDir, { recursive: true })

    // Fetch project files from Supabase
    const files = await getProjectFiles(project_id)
    if (!files || files.length === 0) {
      return NextResponse.json({
        error: 'No files found for this project. Ensure the project has been created and files have been synced.',
      }, { status: 404 })
    }

    // Write project files to the deploy directory
    for (const file of files) {
      const filePath = join(deployDir, file.path.replace(/^\//, ''))
      const fileDir = join(filePath, '..')
      await mkdir(fileDir, { recursive: true })
      await writeFile(filePath, file.content || '', 'utf8')
    }

    // Verify required files exist
    const requiredFiles = ['firebase.json', '.firebaserc', 'functions/index.js', 'functions/package.json']
    const missingFiles = []
    for (const reqFile of requiredFiles) {
      const exists = files.some(f => f.path === `/${reqFile}` || f.path === reqFile)
      if (!exists) missingFiles.push(reqFile)
    }
    if (missingFiles.length > 0) {
      return NextResponse.json({
        error: `Missing required files: ${missingFiles.join(', ')}`,
        hint: 'Ensure the project has firebase.json, .firebaserc, and a functions/ directory with index.js and package.json.',
      }, { status: 400 })
    }

    // Write service account credentials
    await writeFile(credsPath, service_account_json, 'utf8')

    // Run Firebase deploy
    const env = {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: credsPath,
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    }

    let stdout = ''
    let stderr = ''
    let exitCode = 0

    try {
      const { stdout: out, stderr: err } = await execAsync(
        'firebase deploy --only functions --non-interactive --force',
        {
          cwd: deployDir,
          env,
          timeout: 600_000, // 10 minutes
          maxBuffer: 10 * 1024 * 1024, // 10 MB
        }
      )
      stdout = out
      stderr = err
    } catch (err) {
      exitCode = err.code || 1
      stdout = err.stdout || ''
      stderr = err.stderr || err.message || ''
    }

    // Clean up credentials immediately
    await unlink(credsPath).catch(() => {})

    // Parse function URLs from deployment log
    const functionUrls = {}
    const urlMatches = stdout.matchAll(/Function URL \(([^)]+)\):\s+(https:\/\/[^\s]+)/g)
    for (const match of urlMatches) {
      functionUrls[match[1]] = match[2]
    }

    const durationMs = Date.now() - startTime

    // Sanitize logs (remove credential lines)
    const sanitize = (text) => text
      .split('\n')
      .filter(line => !line.includes('private_key') && !line.includes('client_email'))
      .join('\n')

    if (exitCode === 0) {
      return NextResponse.json({
        success: true,
        function_urls: functionUrls,
        duration_ms: durationMs,
        log: sanitize(stdout),
        reason: reason || null,
      })
    } else {
      // Detect common failure patterns
      const output = stdout + stderr
      let errorHint = ''
      if (output.includes('Permission denied') || output.includes('PERMISSION_DENIED')) {
        errorHint = 'Permission Error: The service account lacks required IAM roles (Cloud Functions Developer, Service Account User).'
      } else if (output.includes('Billing account not configured') || output.includes('BILLING_NOT_ENABLED')) {
        errorHint = 'Billing Error: Firebase Functions require a Blaze plan. Enable billing in Firebase Console.'
      } else if (output.includes('firebase.json') || output.includes('not found')) {
        errorHint = 'Configuration Error: Missing or malformed firebase.json or .firebaserc.'
      }

      return NextResponse.json({
        success: false,
        error: errorHint || 'Firebase deployment failed. See log for details.',
        exit_code: exitCode,
        log: sanitize(stdout + '\n' + stderr),
        duration_ms: durationMs,
      }, { status: 500 })
    }
  } catch (err) {
    return NextResponse.json({
      error: `Deployment error: ${err.message}`,
      duration_ms: Date.now() - startTime,
    }, { status: 500 })
  } finally {
    // Clean up deploy directory (best-effort)
    try {
      await execAsync(`rm -rf ${deployDir}`)
    } catch {}
  }
}
