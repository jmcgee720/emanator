/**
 * deploy_via_github — Deploy a project to Vercel via GitHub integration.
 * 
 * Bypasses Vercel's 10 MB API file upload limit by:
 *   1. Creating a GitHub repo (or using existing)
 *   2. Pushing all project files to GitHub via API
 *   3. Connecting Vercel to the GitHub repo
 *   4. Triggering a Vercel deployment
 * 
 * This is the standard Vercel workflow and supports:
 *   - Unlimited project size (GitHub handles large repos)
 *   - Proper Git history
 *   - Automatic redeployments on future pushes
 *   - Vercel's build cache and incremental deploys
 * 
 * @version 1.0.1 - Fixed path filtering logic (cache bust)
 */

import { db } from '@/lib/supabase/db'

export function deployViaGithubTool(projectId) {
  return {
    name: 'deploy_via_github',
    description: 'Deploy project to Vercel via GitHub integration. Creates a GitHub repo, pushes files, connects Vercel, and triggers deployment. Bypasses the 10 MB API limit.',
    input_schema: {
      type: 'object',
      properties: {
        github_token: {
          type: 'string',
          description: 'GitHub Personal Access Token with `repo` scope (from github.com/settings/tokens)',
        },
        vercel_token: {
          type: 'string',
          description: 'Vercel API token (from vercel.com/account/tokens)',
        },
        repo_name: {
          type: 'string',
          description: 'GitHub repository name (e.g., "mynexus"). Will be created if it doesn\'t exist.',
        },
        repo_visibility: {
          type: 'string',
          enum: ['public', 'private'],
          description: 'Repository visibility. Default: private',
        },
        vercel_project_name: {
          type: 'string',
          description: 'Vercel project name (optional, defaults to repo_name)',
        },
        production: {
          type: 'boolean',
          description: 'Deploy to production (true) or preview (false). Default: true',
        },
      },
      required: ['github_token', 'vercel_token', 'repo_name'],
    },
    async execute({ github_token, vercel_token, repo_name, repo_visibility = 'private', vercel_project_name, production = true }) {
      try {
        // Step 1: Fetch all project files from database
        const files = await db.projectFiles.findByProjectId(projectId)
        if (!files || files.length === 0) {
          throw new Error('No files found in project. Cannot deploy an empty project.')
        }
        
        console.log(`[deploy_via_github] Found ${files.length} files in database`)
        console.log(`[deploy_via_github] Sample paths:`, files.slice(0, 5).map(f => f.path))

        // Step 2: Get GitHub user info
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${github_token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        })
        if (!userRes.ok) {
          const err = await userRes.json().catch(() => ({ message: userRes.statusText }))
          throw new Error(`GitHub auth failed: ${err.message || userRes.statusText}`)
        }
        const user = await userRes.json()
        const owner = user.login

        // Step 3: Create or get existing repo
        let repo
        const repoCheckRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}`, {
          headers: {
            'Authorization': `Bearer ${github_token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        })
        
        if (repoCheckRes.ok) {
          repo = await repoCheckRes.json()
        } else {
          // Create new repo
          const createRes = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${github_token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: repo_name,
              private: repo_visibility === 'private',
              auto_init: false,
            }),
          })
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({ message: createRes.statusText }))
            throw new Error(`Failed to create GitHub repo: ${err.message || createRes.statusText}`)
          }
          repo = await createRes.json()
        }

        // Step 4: Push files to GitHub using Git Data API
        // Get the default branch (usually 'main' or 'master')
        let defaultBranch = repo.default_branch || 'main'
        let baseTreeSha = null
        let parentCommitSha = null

        // Try to get the latest commit on the default branch
        const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}/git/refs/heads/${defaultBranch}`, {
          headers: {
            'Authorization': `Bearer ${github_token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        })

        if (branchRes.ok) {
          const branchData = await branchRes.json()
          parentCommitSha = branchData.object.sha
          
          // Get the tree from the parent commit
          const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}/git/commits/${parentCommitSha}`, {
            headers: {
              'Authorization': `Bearer ${github_token}`,
              'Accept': 'application/vnd.github.v3+json',
            },
          })
          if (commitRes.ok) {
            const commitData = await commitRes.json()
            baseTreeSha = commitData.tree.sha
          }
        }

        // Create blobs for all files
        const tree = []
        for (const file of files) {
          // Skip node_modules, .git, and common build artifacts
          const pathSegments = file.path.split('/').filter(Boolean)
          if (
            pathSegments.includes('node_modules') ||
            pathSegments.includes('.git') ||
            pathSegments.includes('build') ||
            pathSegments.includes('dist') ||
            pathSegments.includes('.next') ||
            pathSegments.includes('out') ||
            pathSegments.includes('coverage') ||
            file.path.endsWith('.log')
          ) {
            continue
          }

          // Detect if content is a base64 data URL (binary file)
          const isDataUrl = typeof file.content === 'string' && file.content.startsWith('data:')
          let blobContent
          let encoding

          if (isDataUrl) {
            // Extract base64 body from data URL
            const base64Body = file.content.split(',')[1]
            blobContent = base64Body
            encoding = 'base64'
          } else {
            // Text file
            blobContent = file.content
            encoding = 'utf-8'
          }

          // Create blob
          const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}/git/blobs`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${github_token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              content: blobContent,
              encoding: encoding,
            }),
          })

          if (!blobRes.ok) {
            const err = await blobRes.json().catch(() => ({ message: blobRes.statusText }))
            console.warn(`Failed to create blob for ${file.path}: ${err.message}`)
            continue
          }

          const blob = await blobRes.json()
          tree.push({
            path: file.path,
            mode: '100644', // regular file
            type: 'blob',
            sha: blob.sha,
          })
        }

        if (tree.length === 0) {
          throw new Error('No files to deploy after filtering (all files were in node_modules or build artifacts)')
        }

        // Create tree
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}/git/trees`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${github_token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: tree,
          }),
        })

        if (!treeRes.ok) {
          const err = await treeRes.json().catch(() => ({ message: treeRes.statusText }))
          throw new Error(`Failed to create tree: ${err.message || treeRes.statusText}`)
        }

        const treeData = await treeRes.json()

        // Create commit
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}/git/commits`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${github_token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `Deploy from Auroraly (${new Date().toISOString()})`,
            tree: treeData.sha,
            parents: parentCommitSha ? [parentCommitSha] : [],
          }),
        })

        if (!commitRes.ok) {
          const err = await commitRes.json().catch(() => ({ message: commitRes.statusText }))
          throw new Error(`Failed to create commit: ${err.message || commitRes.statusText}`)
        }

        const commitData = await commitRes.json()

        // Update branch reference
        const refUpdateRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}/git/refs/heads/${defaultBranch}`, {
          method: parentCommitSha ? 'PATCH' : 'POST',
          headers: {
            'Authorization': `Bearer ${github_token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sha: commitData.sha,
            force: false,
          }),
        })

        if (!refUpdateRes.ok) {
          // If PATCH failed, try POST (creating the ref for the first time)
          if (parentCommitSha) {
            const refCreateRes = await fetch(`https://api.github.com/repos/${owner}/${repo_name}/git/refs`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${github_token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                ref: `refs/heads/${defaultBranch}`,
                sha: commitData.sha,
              }),
            })
            if (!refCreateRes.ok) {
              const err = await refCreateRes.json().catch(() => ({ message: refCreateRes.statusText }))
              throw new Error(`Failed to create branch ref: ${err.message || refCreateRes.statusText}`)
            }
          } else {
            const err = await refUpdateRes.json().catch(() => ({ message: refUpdateRes.statusText }))
            throw new Error(`Failed to update branch ref: ${err.message || refUpdateRes.statusText}`)
          }
        }

        // Step 5: Connect Vercel to GitHub repo (if not already connected)
        const projectName = vercel_project_name || repo_name
        
        // Check if Vercel project exists
        const vercelProjectRes = await fetch(`https://api.vercel.com/v9/projects/${projectName}`, {
          headers: {
            'Authorization': `Bearer ${vercel_token}`,
          },
        })

        let vercelProject
        if (vercelProjectRes.ok) {
          vercelProject = await vercelProjectRes.json()
        } else {
          // Create Vercel project linked to GitHub repo
          const createProjectRes = await fetch('https://api.vercel.com/v9/projects', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${vercel_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: projectName,
              gitRepository: {
                type: 'github',
                repo: `${owner}/${repo_name}`,
              },
            }),
          })

          if (!createProjectRes.ok) {
            const err = await createProjectRes.json().catch(() => ({ message: createProjectRes.statusText }))
            throw new Error(`Failed to create Vercel project: ${err.message || createProjectRes.statusText}`)
          }

          vercelProject = await createProjectRes.json()
        }

        // Step 6: Trigger Vercel deployment
        const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${vercel_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: projectName,
            gitSource: {
              type: 'github',
              repo: `${owner}/${repo_name}`,
              ref: defaultBranch,
            },
            target: production ? 'production' : 'preview',
          }),
        })

        if (!deployRes.ok) {
          const err = await deployRes.json().catch(() => ({ message: deployRes.statusText }))
          throw new Error(`Failed to trigger Vercel deployment: ${err.message || deployRes.statusText}`)
        }

        const deployment = await deployRes.json()

        return [
          `✅ Deployment initiated successfully!`,
          '',
          `**GitHub Repository:**`,
          `  URL: https://github.com/${owner}/${repo_name}`,
          `  Commit: ${commitData.sha.slice(0, 7)}`,
          `  Files pushed: ${tree.length}`,
          '',
          `**Vercel Deployment:**`,
          `  Project: ${projectName}`,
          `  URL: https://${deployment.url}`,
          `  Dashboard: https://vercel.com/${owner}/${projectName}`,
          `  Status: ${deployment.readyState || 'BUILDING'}`,
          '',
          `The deployment is now building. It will be live at the URL above in ~2-5 minutes.`,
          `Future pushes to the \`${defaultBranch}\` branch will automatically trigger new deployments.`,
        ].join('\n')

      } catch (error) {
        return [
          `❌ Deployment failed: ${error.message}`,
          '',
          `**Troubleshooting:**`,
          `  • Verify your GitHub token has \`repo\` scope`,
          `  • Verify your Vercel token is valid`,
          `  • Check that the repo name is available (if creating new)`,
          `  • Ensure you have permission to create repos in your GitHub account`,
        ].join('\n')
      }
    },
  }
}
