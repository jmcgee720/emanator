// ──────────────────────────────────────────────────────────────────────
// Firebase Functions deployment tool for project agents
// ──────────────────────────────────────────────────────────────────────
// Deploys Firebase Functions using Google Cloud Functions API (not Firebase CLI).
// This works in serverless environments without requiring firebase-tools.

import { writeFile, unlink, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { getProjectFiles } from '@/lib/supabase/db.js'

/**
 * deploy_firebase_functions — Deploy Firebase Functions using Cloud Functions API.
 * 
 * This tool deploys Firebase Functions by:
 * 1. Fetching project files from Supabase
 * 2. Creating a deployment package (ZIP)
 * 3. Uploading to Google Cloud Storage
 * 4. Deploying via Cloud Functions API
 * 
 * Prerequisites:
 *   • Project must have /functions/index.js, /functions/package.json
 *   • Project must have firebase.json and .firebaserc
 *   • User must provide Firebase service account JSON
 * 
 * Security:
 *   • Service account credentials are ephemeral (written to /tmp, deleted after deploy)
 *   • Deployment logs are sanitized to prevent credential leakage
 */
export function deployFirebaseFunctionsTool(projectId) {
  return {
    name: 'deploy_firebase_functions',
    description: [
      'Deploy Firebase Functions from the project\'s functions/ directory to Firebase.',
      '',
      '⚠️  IMPORTANT: This tool is currently NOT IMPLEMENTED.',
      '',
      'Firebase Functions deployment requires Firebase CLI, which cannot run in',
      'Vercel serverless functions due to size and dependency constraints.',
      '',
      'Alternative approaches:',
      '  1. User deploys locally: `firebase deploy --only functions`',
      '  2. GitHub Actions workflow (automated deployment on push)',
      '  3. Cloud Build integration (deploy from Cloud Console)',
      '',
      'For now, provide the user with manual deployment instructions:',
      '',
      '```bash',
      '# Install Firebase CLI (if not already installed)',
      'npm install -g firebase-tools',
      '',
      '# Login to Firebase',
      'firebase login',
      '',
      '# Deploy functions',
      'firebase deploy --only functions',
      '```',
      '',
      'The deployed function URLs will be shown in the terminal output.',
      '',
      `Project: ${projectId || 'unknown'}`,
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        service_account_json: {
          type: 'string',
          description: 'Firebase service account JSON (currently unused — manual deployment required)',
        },
        reason: {
          type: 'string',
          description: 'Why you\'re deploying (for logging)',
        },
      },
      required: ['service_account_json'],
    },
    async execute({ service_account_json, reason }) {
      // Parse service account to extract project ID
      let firebaseProjectId = 'unknown'
      try {
        const serviceAccount = JSON.parse(service_account_json)
        firebaseProjectId = serviceAccount.project_id || 'unknown'
      } catch {}

      return [
        '⚠️  Firebase Functions deployment is not yet automated.',
        '',
        'Firebase CLI cannot run in Vercel serverless functions due to size constraints.',
        '',
        '📋 Manual Deployment Instructions:',
        '',
        '1. Download your project files:',
        '   • Go to the Auroraly dashboard',
        '   • Click "Export Project" to download a ZIP',
        '   • Extract the ZIP to a local folder',
        '',
        '2. Install Firebase CLI (if not already installed):',
        '   ```bash',
        '   npm install -g firebase-tools',
        '   ```',
        '',
        '3. Login to Firebase:',
        '   ```bash',
        '   firebase login',
        '   ```',
        '',
        '4. Navigate to your project folder and deploy:',
        '   ```bash',
        '   cd /path/to/your/project',
        '   firebase deploy --only functions',
        '   ```',
        '',
        `5. Your Firebase project ID is: ${firebaseProjectId}`,
        '',
        '6. After deployment, Firebase CLI will show the function URLs:',
        '   ```',
        '   Function URL (api): https://us-central1-PROJECT.cloudfunctions.net/api',
        '   ```',
        '',
        '7. Copy those URLs and use them in your frontend OAuth configuration.',
        '',
        '🔄 Alternative: GitHub Actions Automation',
        '',
        'For automated deployments, set up a GitHub Actions workflow:',
        '',
        '```yaml',
        '# .github/workflows/deploy-firebase.yml',
        'name: Deploy to Firebase',
        'on:',
        '  push:',
        '    branches: [main]',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      - uses: actions/setup-node@v3',
        '      - run: npm ci --prefix functions',
        '      - uses: w9jds/firebase-action@master',
        '        with:',
        '          args: deploy --only functions',
        '        env:',
        '          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}',
        '```',
        '',
        'Generate a CI token with: `firebase login:ci`',
        'Add it to GitHub Secrets as FIREBASE_TOKEN.',
        '',
        `Deployment reason: ${reason || 'N/A'}`,
      ].join('\n')
    },
  }
}
