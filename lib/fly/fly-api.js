// ─── Fly.io API — the ONE canonical fetch helper ─────────────────────
//
// Historical footgun: lib/fly/apps.js and lib/fly/machines.js each had
// their OWN flyFetch with different return shapes.
//
//   apps.js flyFetch     → returns { res, body }, NEVER throws
//   machines.js flyFetch → returns body directly, THROWS on !res.ok
//
// Any refactor that crossed the boundary crashed with obscure
// "Cannot read properties of undefined (reading 'ok')" errors. That
// class of bug is why every preview broke in July 2026.
//
// This file replaces both. Both existing shapes are exported so we
// can migrate callers incrementally without a big-bang PR that risks
// blocking previews again.
//   flyFetch(path, init?)         — { res, body }, no throw   (apps.js contract)
//   flyFetchOrThrow(path, init?)  — body, throws on !res.ok   (machines.js contract)

const FLY_API_BASE = 'https://api.machines.dev/v1'

function getToken() {
  const t = process.env.FLY_API_TOKEN
  if (!t) throw new Error('FLY_API_TOKEN missing — preview infra not configured')
  return t
}

async function baseFetch(path, init = {}) {
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

export async function flyFetch(path, init = {}) {
  return baseFetch(path, init)
}

export async function flyFetchOrThrow(path, init = {}) {
  const { res, body } = await baseFetch(path, init)
  if (!res.ok) {
    const msg = typeof body === 'string' ? body : (body?.error || JSON.stringify(body))
    throw new Error(`fly ${init.method || 'GET'} ${path} → ${res.status}: ${msg}`)
  }
  return body
}
