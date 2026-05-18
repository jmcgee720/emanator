// ──────────────────────────────────────────────────────────────────────
// Auroraly Preview Runner — host header parser
// ──────────────────────────────────────────────────────────────────────
// Pure function so unit tests can drive every edge case without booting
// the Express server. Used by the project-routing proxy in index.js to
// decide whether an inbound request belongs on this machine and, if not,
// whether we can do a single-hop fly-replay (machineId embedded in host)
// or have to fall back to the multi-hop `elsewhere=true` retry.
//
// Supported host formats:
//   <projectId>.preview.auroraly.co
//   <projectId>--<machineId>.preview.auroraly.co   ← 1-hop replay
//   <machineId>.vm.<app>.internal                  ← debug / 6PN
// ──────────────────────────────────────────────────────────────────────

export function projectIdFromHost(hostHeader) {
  if (!hostHeader) return { projectId: '', machineId: '' }
  const host = hostHeader.split(':')[0].toLowerCase()
  const sub = host.split('.')[0]
  const parts = sub.split('--')
  return { projectId: parts[0] || '', machineId: parts[1] || '' }
}
