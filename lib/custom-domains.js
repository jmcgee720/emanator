// ══════════════════════════════════════════════════════════════════════
// ── CUSTOM DOMAIN HELPERS ──
// Tiny utility module for the custom-domain settings flow. Validates
// user-submitted domains and builds the DNS-record instructions that
// the UI renders. Actual DNS verification + Vercel API registration
// are gated behind a user-supplied VERCEL_TOKEN env var — this module
// never calls Vercel directly; it just prepares the payload.
// ══════════════════════════════════════════════════════════════════════

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/**
 * Normalise + validate a user-submitted domain. Returns the cleaned
 * lowercase form ready to store, or null if the input is invalid.
 */
export function normaliseDomain(input) {
  if (typeof input !== 'string') return null
  let s = input.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  s = s.replace(/:\d+$/, '')
  if (s.length > 253) return null
  if (!DOMAIN_RE.test(s)) return null
  if (s.startsWith('-') || s.endsWith('-')) return null
  if (/\.\./.test(s)) return null
  return s
}

/**
 * Returns true for apex (example.com), false for subdomains (app.example.com).
 * Treats two-part TLDs naively — good enough for .com, .io, .ai, .co.uk etc.
 * For co.uk we fall back to the "has 2 segments" rule so app.foo.co.uk is
 * correctly flagged as a subdomain.
 */
export function isApex(domain) {
  if (!domain) return false
  const parts = domain.split('.')
  if (parts.length === 2) return true
  // Handle 2-segment public suffixes like "co.uk", "com.au".
  const TWO_LEVEL_TLDS = new Set([
    'co.uk', 'co.nz', 'com.au', 'com.br', 'co.jp', 'co.kr', 'co.in', 'co.za',
  ])
  const lastTwo = parts.slice(-2).join('.')
  if (parts.length === 3 && TWO_LEVEL_TLDS.has(lastTwo)) return true
  return false
}

/**
 * Build the DNS records the user needs to create at their registrar
 * to point this domain at Vercel. Apex domains use A records; subdomains
 * use a CNAME. These are the current Vercel defaults.
 */
export function buildDnsInstructions(domain) {
  const d = normaliseDomain(domain)
  if (!d) return null
  if (isApex(d)) {
    return {
      domain: d,
      kind: 'apex',
      records: [
        { type: 'A', name: '@', value: '76.76.21.21', ttl: 3600 },
      ],
      notes: [
        'Create an A record at your DNS provider (Cloudflare / Namecheap / etc.) pointing @ → 76.76.21.21.',
        'Also consider adding `www` as a CNAME to cname.vercel-dns.com for the www subdomain.',
        'DNS propagation typically takes 5–60 minutes.',
      ],
    }
  }
  const sub = d.split('.')[0]
  return {
    domain: d,
    kind: 'subdomain',
    records: [
      { type: 'CNAME', name: sub, value: 'cname.vercel-dns.com', ttl: 3600 },
    ],
    notes: [
      `Create a CNAME record at your DNS provider with host=${sub} → cname.vercel-dns.com.`,
      'DNS propagation typically takes 5–60 minutes.',
    ],
  }
}

/**
 * Are we in a state where the actual domain-registration API call
 * can be made? Returns false (and the UI shows a "preview mode" banner)
 * when the platform operator hasn't provisioned a VERCEL_TOKEN.
 */
export function isDomainProvisioningAvailable() {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID)
}
