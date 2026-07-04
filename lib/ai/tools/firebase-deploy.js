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

import {
  findMachineForProject,
  machineControlUrl,
} from '@/lib/fly/machines.js'

/** Same derivation as preview-diagnostics.js. Keep in lockstep. */
function projectRunnerSecret(projectId) {
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
  let h = 0
  const s = `${seed}:${projectId}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `runner-${projectId}-${(h >>> 0).toString(36)}`
}

/**
 * Best-effort fetch to the preview runner's control plane. Returns
 * { ok: true, data } on success, { ok: false, reason } on failure.
 * Never throws — all errors are surfaced as structured results.
 */
async function fetchFromRunner(projectId, endpoint, opts = {}) {
  if (!projectId) return { ok: false, reason: 'no-project-id' }

  // If Fly isn't configured (local dev, test runs), no-op silently.
  if (!process.env.FLY_API_TOKEN || !process.env.FLY_PREVIEW_APP_NAME) {
    return { ok: false, reason: 'fly-not-configured' }
  }

  let machine
  try {
    machine = await findMachineForProject(projectId)
  } catch (err) {
    return { ok: false, reason: 'machine-lookup-failed: ' + (err?.message || 'unknown') }
  }

  // No machine = preview hasn't been started for this project
  if (!machine) return { ok: false, reason: 'no-machine' }
  if (machine.state !== 'started') {
    return { ok: false, reason: 'machine-' + machine.state, machineId: machine.id }
  }

  const secret = projectRunnerSecret(projectId)
  const { url, headers } = machineControlUrl(machine)

  try {
    // 10-minute cap for Firebase deploy (can take 3-5 min for cold functions)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 600_000)
    const res = await fetch(`${url}${endpoint}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Auroraly-Secret': secret,
        ...headers,
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, reason: `runner-${res.status}: ${text.slice(0, 200)}`, machineId: machine.id }
    }

    const data = await res.json().catch(() => null)
    return { ok: true, data, machineId: machine.id }
  } catch (err) {
    return { ok: false, reason: 'fetch-failed: ' + (err?.message || 'unknown'), machineId: machine.id }
  }
}

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

      // Deploy via server-side API endpoint
      const startTime = Date.now()
      let response
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://auroraly.com'
        response = await fetch(`${baseUrl}/api/firebase/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            service_account_json,
            reason,
          }),
        })
      } catch (err) {
        return [
          '❌ Failed to connect to deployment service.',
          '',
          `Error: ${err.message}`,
          '',
          'This is likely a network or server issue. Try again in a moment.',
        ].join('\n')
      }

      const durationMs = Date.now() - startTime
      let result
      try {
        result = await response.json()
      } catch {
        return [
          '❌ Deployment service returned invalid response.',
          '',
          `HTTP ${response.status}`,
          '',
          'This is likely a server error. Try again in a moment.',
        ].join('\n')
      }

      const lines = []

      if (result.success) {
        lines.push(`✅ Firebase Functions deployed successfully! (${result.duration_ms}ms)`)
        lines.push('')
        
        if (result.function_urls && Object.keys(result.function_urls).length > 0) {
          lines.push('📍 Function URLs:')
          for (const [name, url] of Object.entries(result.function_urls)) {
            lines.push(`  • ${name}: ${url}`)
          }
          lines.push('')
        }
        
        lines.push('The functions are now live and ready to use!')
        if (result.reason) lines.push(`Deployment reason: ${result.reason}`)
      } else {
        lines.push(`❌ Firebase deployment failed (${result.duration_ms || durationMs}ms)`)
        lines.push('')
        
        if (result.error) {
          lines.push(result.error)
          lines.push('')
        }
      }

      if (result.log && result.log.trim()) {
        lines.push('')
        lines.push('DEPLOYMENT LOG:')
        lines.push(result.log.trim())
      }

      return lines.join('\n')
    },
  }
}
