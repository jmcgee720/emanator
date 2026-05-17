'use client'

import AppShell from '@/components/AppShell'

/**
 * /project-bin — explicit URL for the authenticated user's project list.
 *
 * Functionally identical to `/` for logged-in users: both render the
 * same `AppShell` → `Dashboard` tree. The difference is the address bar
 * displays a meaningful URL ("auroraly.co/project-bin") instead of the
 * empty-path homepage. AppShell handles the `/` → `/project-bin`
 * redirect for authenticated users so anyone typing the bare domain
 * still lands here.
 */
export default function ProjectBinPage() {
  return <AppShell />
}
