import { NextResponse } from 'next/server'

// Shared helpers
import { handleCORS, initializeOwner } from '@/lib/api/helpers'

// Phase 1 route modules
import * as publicRoutes from '@/lib/api/routes/public'
import * as authRoutes from '@/lib/api/routes/auth'
import * as adminRoutes from '@/lib/api/routes/admin'
import * as exportsRoutes from '@/lib/api/routes/exports'
import * as creditsRoutes from '@/lib/api/routes/credits'
import * as stripeRoutes from '@/lib/api/routes/stripe'
import * as searchRoutes from '@/lib/api/routes/search'
import * as growthRoutes from '@/lib/api/routes/growth'
import * as personasRoutes from '@/lib/api/routes/personas'
import * as importsRoutes from '@/lib/api/routes/imports'
import * as deploymentsRoutes from '@/lib/api/routes/deployments'
import * as snapshotsRoutes from '@/lib/api/routes/snapshots'
import * as generationsRoutes from '@/lib/api/routes/generations'
import * as memoryRoutes from '@/lib/api/routes/memory'
import * as builderStatusRoutes from '@/lib/api/routes/builder-status'
import * as statsRoutes from '@/lib/api/routes/stats'
import * as promptLibraryRoutes from '@/lib/api/routes/prompt-library'
import * as learningRoutes from '@/lib/api/routes/learning'
import * as auroraRoutes from '@/lib/api/routes/aurora'
import * as shareRoutes from '@/lib/api/routes/share'
import * as galleryRoutes from '@/lib/api/routes/gallery'
import * as marketplaceRoutes from '@/lib/api/routes/marketplace'
import * as buildStepsRoutes from '@/lib/api/routes/build-steps'
import * as firebaseDeployRoutes from '@/lib/api/routes/firebase-deploy'

// Phase 2 route modules
import * as adminUsersRoutes from '@/lib/api/routes/admin-users'
import * as adminPromoRoutes from '@/lib/api/routes/admin-promo'
import * as promoRedeemRoutes from '@/lib/api/routes/promo-redeem'
import * as designRoutes from '@/lib/api/routes/design'
import * as canvasRoutes from '@/lib/api/routes/canvas'
import * as filesRoutes from '@/lib/api/routes/files'
import * as sandboxRoutes from '@/lib/api/routes/sandbox'
import * as livePromoteRoutes from '@/lib/api/routes/live-promote'
import * as diffsRoutes from '@/lib/api/routes/diffs'
import * as assetsRoutes from '@/lib/api/routes/assets'
import * as chatsRoutes from '@/lib/api/routes/chats'
import * as chatMetadataRoutes from '@/lib/api/routes/chat-metadata'
import * as screenshotsRoutes from '@/lib/api/routes/screenshots'
import * as projectsRoutes from '@/lib/api/routes/projects'

// App Router handles request bodies via Web Request streaming — no config needed.
// For large uploads, routes read the body directly via req.formData() / req.json().
export const runtime = 'nodejs'
// Fluid Compute on Pro plan supports up to 800 seconds (~13 min).
// Compose phase legitimately needs 4-7 minutes for projects with 10-15
// pages (~20-30s per file via Claude streaming). 300s was insufficient
// and timed out mid-build; 800s gives generous headroom while still
// failing fast if something hangs.
export const maxDuration = 800

// Phase 1 module dispatch order (CRITICAL: preserve evaluation order)
const phase1Modules = [
  publicRoutes,
  authRoutes,
  adminRoutes,
  exportsRoutes,       // MUST run before projectsRoutes (handles /projects/import)
  creditsRoutes,
  stripeRoutes,
  searchRoutes,
  growthRoutes,
  personasRoutes,
  importsRoutes,
  deploymentsRoutes,
  snapshotsRoutes,
  generationsRoutes,
  memoryRoutes,
  builderStatusRoutes,
  statsRoutes,
  promptLibraryRoutes,
  learningRoutes,
  auroraRoutes,
  shareRoutes,
  galleryRoutes,
  marketplaceRoutes,
  buildStepsRoutes,
  firebaseDeployRoutes,
]

// Phase 2 module dispatch order (CRITICAL: projectsRoutes MUST be last — its regex swallows /projects/:id)
const phase2Modules = [
  adminUsersRoutes,
  adminPromoRoutes,
  promoRedeemRoutes,
  designRoutes,
  canvasRoutes,
  filesRoutes,
  sandboxRoutes,
  livePromoteRoutes,
  diffsRoutes,
  assetsRoutes,
  chatsRoutes,
  chatMetadataRoutes,  // Chat organization endpoints
  screenshotsRoutes,
  projectsRoutes,      // MUST be last
]

// OPTIONS handler for CORS
export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 200 }))
}

// Route handler function
async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    await initializeOwner()

    // ── Phase 1: Dispatch to extracted modules ──
    for (const mod of phase1Modules) {
      const result = await mod.handle(route, method, path, request)
      if (result) return result
    }

    // ── Phase 2: Dispatch to extracted modules ──
    for (const mod of phase2Modules) {
      const result = await mod.handle(route, method, path, request)
      if (result) return result
    }

    // Route not found
    return handleCORS(NextResponse.json(
      { error: `Route ${route} not found` },
      { status: 404 }
    ))

  } catch (error) {
    console.error('API Error:', error)
    return handleCORS(NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    ))
  }
}

// Export all HTTP methods
export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
