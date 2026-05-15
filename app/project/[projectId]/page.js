'use client'

import AppShell from '@/components/AppShell'

/**
 * /project/[projectId] — deep-link entry point.
 *
 * Renders the same AppShell as the homepage, but tells the Dashboard
 * to auto-select the project whose id is in the URL. Bookmarkable,
 * refreshable, shareable.
 */
export default function ProjectPage({ params }) {
  return <AppShell initialProjectId={params.projectId} />
}
