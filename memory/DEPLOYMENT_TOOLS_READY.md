# ✅ Deployment Authority Tools — READY FOR USE

## Status: IMPLEMENTED & REGISTERED

The `deploy_via_github` tool is **already built and registered** in the agent toolset. It's available to all project agents right now.

## How It Works

### Tool: `deploy_via_github`

**Purpose**: Deploy projects to Vercel via GitHub integration (bypasses 10 MB API limit)

**Location**: `lib/ai/tools/deploy-via-github.js`

**Registration**: Line 1075 in `lib/ai/agent-tools-v2.js`

**Parameters**:
```typescript
{
  github_token: string,      // User's GitHub PAT with 'repo' scope
  vercel_token: string,      // User's Vercel token
  repo_name: string,         // e.g., "mynexus"
  repo_visibility?: "public" | "private",  // Default: private
  vercel_project_name?: string,  // Optional, defaults to repo_name
  production?: boolean       // Default: true
}
```

**What It Does**:
1. ✅ Fetches all project files from Supabase (`db.projectFiles.findByProjectId`)
2. ✅ Creates GitHub repo (or uses existing)
3. ✅ Pushes files to GitHub via Git Data API (no git CLI needed)
4. ✅ Connects Vercel to GitHub repo
5. ✅ Triggers Vercel deployment
6. ✅ Returns deployment URL + dashboard URL

**Returns**:
```
✅ Deployment initiated successfully!

**GitHub Repository:**
  URL: https://github.com/user/mynexus
  Commit: abc1234
  Files pushed: 42

**Vercel Deployment:**
  Project: mynexus
  URL: https://mynexus.vercel.app
  Dashboard: https://vercel.com/user/mynexus
  Status: BUILDING

The deployment is now building. It will be live at the URL above in ~2-5 minutes.
Future pushes to the `main` branch will automatically trigger new deployments.
```

## Bug Fixed

**Line 58**: Changed `db.projectFiles.list(projectId)` → `db.projectFiles.findByProjectId(projectId)`

The tool is now fully functional.

## Usage Example

User provides tokens:
```
GitHub token: ghp_[REDACTED]
Vercel token: vcp_[REDACTED]
```

Agent calls:
```javascript
deploy_via_github({
  github_token: "ghp_[USER_PROVIDED]",
  vercel_token: "vcp_[USER_PROVIDED]",
  repo_name: "mynexus",
  repo_visibility: "private",
  production: true
})
```

Result: Project deployed to production in **one agent turn**, zero manual user work.

## Why This Tool Exists

**Problem**: `deploy_to_vercel` hits 10 MB API limit when uploading large projects

**Solution**: `deploy_via_github` pushes to GitHub first (unlimited size), then connects Vercel to the repo

**Benefit**: 
- ✅ No file size limit (GitHub handles large repos)
- ✅ Proper Git history
- ✅ Automatic redeployments on future pushes
- ✅ Vercel's build cache and incremental deploys

## Next Steps

The user (MyNexus deployment) can now:

1. Provide their GitHub + Vercel tokens in the chat
2. Agent calls `deploy_via_github` with those tokens
3. Deployment completes in ~2-5 minutes
4. User gets production URL + dashboard link

**No manual terminal commands required.**

## Other Deployment Tools Available

1. **`deploy_to_vercel`** — Direct Vercel API deployment (10 MB limit, faster for small projects)
2. **`deploy_via_github`** — GitHub → Vercel (unlimited size, best for production)
3. **`deploy_firebase_functions`** — Firebase Functions deployment (for full-stack apps)

All three are registered and available to project agents.
