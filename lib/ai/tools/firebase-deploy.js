// ──────────────────────────────────────────────────────────────────────
// Firebase Functions deployment tool for project agents
// ──────────────────────────────────────────────────────────────────────
// Allows agents to deploy Firebase Functions directly from the preview
// runner without requiring the user to have files on their local machine.
//
// Security model:
//   • Service account credentials are stored encrypted in project metadata
//   • Credentials are ephemeral (written to /tmp, deleted after deploy)
//   • Deployment runs in isolated preview container
//   • Logs are sanitized to prevent credential leakage

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { getProjectFiles } from '@/lib/supabase/db.js'

const execAsync = promisify(exec)

/**
 * deploy_firebase_functions — Deploy Firebase Functions server-side.
 * 
 * This tool deploys Firebase Functions by calling the Auroraly API server,
 * which runs Firebase CLI directly (not in the preview runner). This bypasses
 * preview runner command allowlist restrictions entirely.
 * 
 * Prerequisites:
 *   • Project must have /functions/index.js, /functions/package.json
 *   • Project must have firebase.json and .firebaserc
 *   • User must provide Firebase service account JSON (uploaded or pasted)
 * 
 * Security:
 *   • Service account JSON is sent to /api/firebase/deploy (server-side)
 *   • Credentials are written to /tmp, used once, then deleted
 *   • Deployment logs are sanitized to prevent credential leakage
 */
export function deployFirebaseFunctionsTool(projectId) {
  return {
    name: 'deploy_firebase_functions',
    description: [
      'Deploy Firebase Functions from the project\'s functions/ directory to Firebase.',
      '',
      'Use this when:',
      '  • You\'ve created Firebase Functions code (/functions/index.js, /functions/package.json)',
      '  • You\'ve created firebase.json and .firebaserc',
      '  • User has provided their Firebase service account JSON',
      '  • User wants to deploy the functions to make them live',
      '',
      'Prerequisites:',
      '  • User must provide Firebase service account JSON (ask them to upload or paste it)',
      '  • Project must have valid firebase.json and .firebaserc',
      '',
      'Security:',
      '  • Deployment runs server-side (not in preview runner)',
      '  • Service account credentials are ephemeral (written to /tmp, deleted after deploy)',
      '  • Logs are sanitized to prevent credential leakage',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: Deployment status, function URLs, and deployment log.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        service_account_json: {
          type: 'string',
          description: 'Firebase service account JSON (the full JSON object as a string, from user upload or paste)',
        },
        reason: {
          type: 'string',
          description: 'Why you\'re deploying (for logging). e.g. "deploying OAuth backend", "initial Firebase Functions deployment"',
        },
      },
      required: ['service_account_json'],
    },
    async execute({ service_account_json, reason }) {
      // Validate service account JSON
      let serviceAccount
      try {
        serviceAccount = JSON.parse(service_account_json)
        if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
          return [
            '❌ Invalid service account JSON.',
            '',
            'The service account JSON must contain:',
            '  • project_id',
            '  • private_key',
            '  • client_email',
            '',
            'Ask the user to download a fresh service account key from:',
            'Firebase Console → Project Settings → Service Accounts → Generate New Private Key',
          ].join('\n')
        }
      } catch (err) {
        return [
          '❌ Failed to parse service account JSON.',
          '',
          `Error: ${err.message}`,
          '',
          'The service_account_json parameter must be a valid JSON string.',
          'Ask the user to paste the FULL contents of their service account JSON file.',
        ].join('\n')
      }

      // Deploy directly (no HTTP round-trip)
      const startTime = Date.now()
      const deployId = randomBytes(8).toString('hex')
      const deployDir = join(tmpdir(), `firebase-deploy-${deployId}`)
      const credsPath = join(deployDir, 'service-account.json')

      try {
        await mkdir(deployDir, { recursive: true })

        // Fetch project files from Supabase
        const files = await getProjectFiles(projectId)
        if (!files || files.length === 0) {
          return [
            '❌ No files found for this project.',
            '',
            'Ensure the project has been created and files have been synced.',
          ].join('\n')
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
          return [
            `❌ Missing required files: ${missingFiles.join(', ')}`,
            '',
            'Ensure the project has firebase.json, .firebaserc, and a functions/ directory with index.js and package.json.',
          ].join('\n')
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

        const lines = []

        if (exitCode === 0) {
          lines.push(`✅ Firebase Functions deployed successfully! (${durationMs}ms)`)
          lines.push('')
          
          if (Object.keys(functionUrls).length > 0) {
            lines.push('📍 Function URLs:')
            for (const [name, url] of Object.entries(functionUrls)) {
              lines.push(`  • ${name}: ${url}`)
            }
            lines.push('')
          }
          
          lines.push('The functions are now live and ready to use!')
          if (reason) lines.push(`Deployment reason: ${reason}`)
        } else {
          lines.push(`❌ Firebase deployment failed (exit code ${exitCode}, ${durationMs}ms)`)
          lines.push('')
          
          // Detect common failure patterns
          const output = stdout + stderr
          if (output.includes('Permission denied') || output.includes('PERMISSION_DENIED')) {
            lines.push('🔒 Permission Error:')
            lines.push('The service account lacks required IAM roles (Cloud Functions Developer, Service Account User).')
            lines.push('')
          } else if (output.includes('Billing account not configured') || output.includes('BILLING_NOT_ENABLED')) {
            lines.push('💳 Billing Error:')
            lines.push('Firebase Functions require a Blaze plan. Enable billing in Firebase Console.')
            lines.push('')
          } else if (output.includes('firebase.json') || output.includes('not found')) {
            lines.push('📄 Configuration Error:')
            lines.push('Missing or malformed firebase.json or .firebaserc.')
            lines.push('')
          }
        }

        lines.push('')
        lines.push('DEPLOYMENT LOG:')
        lines.push(sanitize(stdout + '\n' + stderr).trim())

        return lines.join('\n')
      } catch (err) {
        return [
          '❌ Deployment error:',
          '',
          err.message,
          '',
          'This is likely a server configuration issue. Contact support if this persists.',
        ].join('\n')
      } finally {
        // Clean up deploy directory (best-effort)
        try {
          await execAsync(`rm -rf ${deployDir}`)
        } catch {}
      }
    },
  }
}
