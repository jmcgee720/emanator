// ──────────────────────────────────────────────────────────────────────
// Fly Apps — per-project dedicated apps
// ──────────────────────────────────────────────────────────────────────
// Why one app per project?
// Fly's wildcard `<app>.fly.dev` (and any custom wildcard CNAME) routes
// to ANY machine in a Fly App via Fly's edge load-balancer. When we had
// EVERY user's project in a single shared Fly App we had to route at
// the runner layer using `fly-replay` headers, which Fly drops, loops,
// or stale-routes — manifesting as 502s, ECONNREFUSED on dead machines,
// and cross-project CSS bleed.
//
// Solution: one Fly App per Auroraly project. App = `auroraly-prv-<hash>`.
// Inside each app, exactly one machine. `<app>.fly.dev` routes
// deterministically to that machine. Zero routing ambiguity. This is
// the same architecture Emergent uses.
// ──────────────────────────────────────────────────────────────────────

const FLY_API_BASE = 'https://api.machines.dev/v1'

function getOrgSlug() {
  const slug = process.env.FLY_ORG_SLUG
  if (!slug) throw new Error('FLY_ORG_SLUG missing — set it in Vercel env')
  return slug
}

function getToken() {
  const t = process.env.FLY_API_TOKEN
  if (!t) throw new Error('FLY_API_TOKEN missing — set it in Vercel env')
  return t
}

/**
 * Deterministic, DNS-safe app name for a project.
 *
 * Fly app names: lowercase alphanumeric + dashes; must START with a letter;
 * MAX 30 chars; globally unique within an org.
 *
 * We fold the projectId through two cheap non-cryptographic hashes
 * (cyrb-style) and concat to 16 hex chars. Result is always exactly
 * 13 + 16 = 29 chars: well under Fly's 30-char limit, DNS-safe,
 * starts with `a`, and collision-resistant for the scales we operate at.
 */
export function previewAppName(projectId) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('previewAppName: non-empty string projectId required')
  }
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < projectId.length; i++) {
    const ch = projectId.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0
  h2 = (h2 ^ (h2 >>> 16)) >>> 0
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16)
  return `auroraly-prv-${hex}`
}

async function flyFetch(path, init = {}) {
  const res = await fetch(`${FLY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { res, body }
}

/**
 * Idempotently provision a per-project Fly App.
 *
 * Safe to call on EVERY preview-start. First call creates the app
 * (~200ms) AND allocates a shared IPv4 + IPv6 (~500ms) so that
 * `<app>.fly.dev` resolves publicly. Subsequent calls hit a cheap
 * GET that returns immediately and skip the IP step.
 *
 * Race-safe: concurrent first-time calls converge on the same app.
 *
 * Returns the app name.
 */
export async function ensurePreviewApp(projectId) {
  const name = previewAppName(projectId)
  const org = getOrgSlug()

  // Cheap existence probe first.
  const check = await flyFetch(`/apps/${name}`)
  const exists = check.res.ok

  if (!exists) {
    const create = await flyFetch(`/apps`, {
      method: 'POST',
      body: JSON.stringify({ app_name: name, org_slug: org, network: 'default' }),
    })
    const createdOk = create.res.ok || create.res.status === 201
    const msg = String(create.body?.error || create.body || '').toLowerCase()
    const raceOk = create.res.status === 422 && (msg.includes('taken') || msg.includes('already'))
    if (!createdOk && !raceOk && create.res.status !== 409) {
      throw new Error(
        `ensurePreviewApp(${name}) → ${create.res.status}: ` +
        (typeof create.body === 'string' ? create.body : JSON.stringify(create.body))
      )
    }
  }

  // ALWAYS ensure shared IPs are allocated — even for pre-existing apps,
  // because apps created during the buggy first-deploy window
  // (2026-06-14 → 2026-06-16) had NO IP allocated and `<app>.fly.dev`
  // returned "could not resolve host". Idempotent: Fly's GraphQL
  // returns a benign "already" error if the IP exists, which we swallow.
  await allocateSharedIp(name, 'shared_v4').catch((err) => {
    console.warn(`[ensurePreviewApp] shared_v4 alloc warning for ${name}: ${err.message}`)
  })
  await allocateSharedIp(name, 'v6').catch((err) => {
    console.warn(`[ensurePreviewApp] v6 alloc warning for ${name}: ${err.message}`)
  })

  return name
}

/**
 * Ensure a persistent Fly volume exists for this project.
 *
 * Why: without a volume, `/project/node_modules` lives on the machine's
 * ephemeral rootfs. When Fly destroys the machine (image update, region
 * drain, health-check failure, manual reset) the node_modules is gone
 * and the next boot has to run a full `npm install` — 3-6 minutes for
 * a typical React project, 8-15+ for Next.js / CRA. Users hit "Preview
 * failed to start (15 min timeout)" all the time on cold-boot after
 * destroy.
 *
 * A per-project volume mounted at /project turns this into:
 *   - First-ever boot: install populates the volume (~3-6 min)
 *   - Every subsequent boot (even after destroy): reuse existing
 *     node_modules → dev server up in <10 seconds
 *
 * Volume sizing: 1 GB is Fly's minimum. A CRA + all its transitives
 * lands around 400-700 MB; Next.js around 300-500 MB. Vite is <200 MB.
 * If any user hits the cap the safety-nets will fail loudly.
 *
 * Idempotent: probe for an existing volume with the same name first,
 * only POST /volumes on cache miss. Returns the volume id string.
 */
/**
 * Delete a project's persistent volume. Called when Fly refuses to
 * schedule a machine into the volume's availability zone (412
 * "insufficient resources to create new machine with existing volume") —
 * we drop the volume so the next boot either creates a fresh one in a
 * zone with capacity, or falls back to an ephemeral rootfs machine.
 */
export async function deleteProjectVolume(appName, volumeId) {
  const { res, body } = await flyFetch(`/apps/${appName}/volumes/${volumeId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `deleteProjectVolume(${appName}, ${volumeId}) → ${res.status}: ` +
      (typeof body === 'string' ? body : JSON.stringify(body))
    )
  }
  return { ok: true }
}


export async function ensureProjectVolume(appName, region) {
  const volumeName = 'data_project' // per-machine mount point matches this
  // List existing volumes (idempotency probe)
  const listed = await flyFetch(`/apps/${appName}/volumes`)
  if (listed.res.ok && Array.isArray(listed.body)) {
    const existing = listed.body.find(v => v.name === volumeName && v.region === region && v.state !== 'destroyed')
    if (existing) return existing.id
  }
  // Create fresh 1 GB volume in the correct region.
  const created = await flyFetch(`/apps/${appName}/volumes`, {
    method: 'POST',
    body: JSON.stringify({
      name: volumeName,
      region,
      size_gb: 1,
      // encrypted: true is Fly's default; explicit for clarity.
      encrypted: true,
      // require_unique_zone: false lets Fly place the volume in ANY
      // AZ within the region. Otherwise machine boot fails if the
      // region has capacity issues in a specific zone.
      require_unique_zone: false,
    }),
  })
  if (!created.res.ok) {
    throw new Error(
      `ensureProjectVolume(${appName}) → ${created.res.status}: ` +
      (typeof created.body === 'string' ? created.body : JSON.stringify(created.body))
    )
  }
  return created.body.id
}

async function allocateSharedIp(appName, type) {
  const token = getToken()
  const res = await fetch('https://api.fly.io/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { app { sharedIpAddress } ipAddress { address type } } }',
      variables: { input: { appId: appName, type, region: '' } },
    }),
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    throw new Error(`allocateIpAddress(${appName}, ${type}) → ${res.status}: ${text}`)
  }
  if (body?.errors?.length) {
    // Fly returns 200 with an `errors` array on GraphQL-level failures.
    // "ip address already allocated" is benign and means we're idempotent.
    const errMsg = body.errors.map(e => e?.message || JSON.stringify(e)).join('; ')
    if (/already/i.test(errMsg)) return
    throw new Error(`allocateIpAddress(${appName}, ${type}) GraphQL error: ${errMsg}`)
  }
  return body?.data?.allocateIpAddress
}

/**
 * Destroy a project's dedicated app (and every machine inside).
 * Called when a project is permanently deleted by the user.
 * Idempotent: returns ok:true even if the app didn't exist.
 */
export async function destroyPreviewApp(projectId) {
  const name = previewAppName(projectId)
  const { res, body } = await flyFetch(`/apps/${name}`, { method: 'DELETE' })
  if (res.ok || res.status === 404 || res.status === 410) {
    return { ok: true, name, deleted: res.ok }
  }
  throw new Error(
    `destroyPreviewApp(${name}) → ${res.status}: ` +
    (typeof body === 'string' ? body : JSON.stringify(body))
  )
}

/**
 * Public dev-server URL for a project. Always `<dedicated-app>.fly.dev`.
 * Zero machineId in the URL — there's only one machine per app, so
 * `<app>.fly.dev` routes deterministically by design.
 */
export function previewAppPublicUrl(projectId) {
  return `https://${previewAppName(projectId)}.fly.dev`
}
