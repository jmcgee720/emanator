import {
  normaliseDomain,
  isApex,
  buildDnsInstructions,
  isDomainProvisioningAvailable,
} from '../../lib/custom-domains.js'

describe('normaliseDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  example.com ', 'example.com'],
    ['EXAMPLE.COM', 'example.com'],
    ['https://example.com', 'example.com'],
    ['http://example.com/', 'example.com'],
    ['app.example.com', 'app.example.com'],
    ['example.co.uk', 'example.co.uk'],
    ['example.com:3000', 'example.com'],
    ['sub-domain.example.io', 'sub-domain.example.io'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected)
  })

  it.each([
    '',
    null,
    undefined,
    123,
    'not-a-domain',
    '.com',
    'example.',
    'ex ample.com',
    '-bad.com',
    'bad-.com',
    'x'.repeat(254) + '.com',
    'example..com',
  ])('rejects %p', (input) => {
    expect(normaliseDomain(input)).toBeNull()
  })
})

describe('isApex', () => {
  it.each([
    ['example.com', true],
    ['foo.io', true],
    ['company.co.uk', true],
    ['company.com.au', true],
    ['app.example.com', false],
    ['www.example.com', false],
    ['app.company.co.uk', false],
  ])('%s → apex=%s', (input, expected) => {
    expect(isApex(input)).toBe(expected)
  })

  it('handles empty / invalid input', () => {
    expect(isApex('')).toBe(false)
    expect(isApex(null)).toBe(false)
  })
})

describe('buildDnsInstructions', () => {
  it('returns apex-shaped A record for apex domains', () => {
    const dns = buildDnsInstructions('example.com')
    expect(dns.kind).toBe('apex')
    expect(dns.records).toEqual([
      { type: 'A', name: '@', value: '76.76.21.21', ttl: 3600 },
    ])
    expect(dns.notes.length).toBeGreaterThan(0)
  })

  it('returns CNAME instructions for subdomains', () => {
    const dns = buildDnsInstructions('app.example.com')
    expect(dns.kind).toBe('subdomain')
    expect(dns.records[0]).toEqual({ type: 'CNAME', name: 'app', value: 'cname.vercel-dns.com', ttl: 3600 })
  })

  it('normalises input before building records', () => {
    expect(buildDnsInstructions('  HTTPS://App.Example.com ').domain).toBe('app.example.com')
  })

  it('returns null for invalid input', () => {
    expect(buildDnsInstructions('not a domain')).toBeNull()
    expect(buildDnsInstructions('')).toBeNull()
  })
})

describe('isDomainProvisioningAvailable', () => {
  const originalEnv = { ...process.env }
  afterEach(() => { process.env = { ...originalEnv } })

  it('returns true only when both VERCEL_TOKEN and VERCEL_PROJECT_ID set', () => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'pid'
    expect(isDomainProvisioningAvailable()).toBe(true)
  })

  it('returns false when either is missing', () => {
    delete process.env.VERCEL_TOKEN
    process.env.VERCEL_PROJECT_ID = 'pid'
    expect(isDomainProvisioningAvailable()).toBe(false)

    process.env.VERCEL_TOKEN = 'tok'
    delete process.env.VERCEL_PROJECT_ID
    expect(isDomainProvisioningAvailable()).toBe(false)

    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    expect(isDomainProvisioningAvailable()).toBe(false)
  })
})
