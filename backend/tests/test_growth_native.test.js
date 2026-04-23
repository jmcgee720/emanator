/**
 * Sanity tests for the native growth lib (analyze + generate-drafts + trends).
 * We mock the OpenAI client and MongoDB access at the module boundaries so
 * these run without any external services.
 */

// Mock mongodb — provide a minimal db with findOne/find/updateOne.
const mockPage = {
  _id: 'abc123def456abc123def456',
  user_id: 'user-123',
  url: 'https://example.com/',
  extracted_data: {
    title: 'Example Title',
    title_length: 13,
    meta_description: 'Example meta desc.',
    meta_description_length: 19,
    headings: { h1: ['Hello world'], h2: ['Subhead'] },
    canonical: 'https://example.com/',
    og_tags: { 'og:title': 'X' },
    word_count: 500,
    internal_links: 3,
    external_links: 1,
    total_images: 2,
    images_with_alt: 2,
    meta_robots: 'index,follow',
  },
  opportunities: { recommendations: ['Add more content'] },
  fixes: {
    improved_title: 'Better Title',
    improved_meta_description: 'Better meta',
    improved_h1: 'Better H1',
  },
}

let mockDbCalls = { updateOne: 0 }

const mockDb = {
  collection(name) {
    const data = {
      growth_pages: mockPage,
      trend_signals: [],
      persona_profiles: null,
    }[name]
    return {
      async findOne() {
        return data
      },
      find() {
        const rows = Array.isArray(data) ? data : (data ? [data] : [])
        return {
          sort() { return this },
          limit() { return this },
          project() { return this },
          toArray: async () => rows,
        }
      },
      async updateOne() {
        mockDbCalls.updateOne++
        return { modifiedCount: 1 }
      },
    }
  },
}

jest.mock('../../lib/mongodb', () => ({
  getDb: async () => mockDb,
}))

// Mock MongoDB ObjectId — accept any string.
jest.mock('mongodb', () => ({
  ObjectId: function ObjectId(s) {
    if (s && !/^[a-f0-9-]+$/i.test(s)) throw new Error('Invalid')
    return s
  },
}))

// Mock OpenAI client.
const mockCompletion = { value: null }
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: class OpenAI {
      constructor() {}
      chat = {
        completions: {
          create: async () => ({
            choices: [{ message: { content: mockCompletion.value } }],
          }),
        },
      }
    },
  }
})

import { analyzeNative, generateDraftsNative } from '../../lib/growth/analyze-native.js'

beforeEach(() => {
  mockDbCalls = { updateOne: 0 }
  process.env.OPENAI_API_KEY = 'sk-test-mock'
})

describe('analyzeNative', () => {
  it('returns 400 when user_id is missing', async () => {
    const r = await analyzeNative({ pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/user_id/)
  })

  it('returns 400 when page_id is missing', async () => {
    const r = await analyzeNative({ userId: 'user-123' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/page_id/)
  })

  it('returns 500 when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY
    mockCompletion.value = '{}'
    const r = await analyzeNative({ userId: 'user-123', pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/OPENAI_API_KEY/)
  })

  it('parses flat-key LLM response and ensures expected shape', async () => {
    mockCompletion.value = JSON.stringify({
      title_issues: ['too short'],
      meta_issues: [],
      content_issues: ['thin'],
      structure_issues: [],
      recommendations: ['add more'],
      improved_title: 'Great Title',
      improved_meta_description: 'Great meta',
    })
    const r = await analyzeNative({ userId: 'user-123', pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(200)
    expect(r.body.opportunities.title_issues).toEqual(['too short'])
    expect(r.body.opportunities.recommendations).toEqual(['add more'])
    expect(r.body.fixes.improved_title).toBe('Great Title')
    expect(r.body.fixes.improved_meta_description).toBe('Great meta')
    expect(r.body.opportunities.improved_title).toBeUndefined() // stripped out
    expect(mockDbCalls.updateOne).toBe(1)
  })

  it('handles nested {ANALYSIS, FIXES} LLM response', async () => {
    mockCompletion.value = JSON.stringify({
      ANALYSIS: {
        title_issues: ['x'],
        meta_issues: [],
        content_issues: [],
        structure_issues: [],
        recommendations: [],
      },
      FIXES: { improved_title: 'Nested Title' },
    })
    const r = await analyzeNative({ userId: 'user-123', pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(200)
    expect(r.body.opportunities.title_issues).toEqual(['x'])
    expect(r.body.fixes.improved_title).toBe('Nested Title')
  })

  it('returns 502 when LLM returns invalid JSON', async () => {
    mockCompletion.value = 'not-json-at-all'
    const r = await analyzeNative({ userId: 'user-123', pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(502)
    expect(r.body.error).toMatch(/invalid JSON/)
  })

  it('strips markdown fences from LLM response', async () => {
    mockCompletion.value = '```json\n{"title_issues":["x"],"meta_issues":[],"content_issues":[],"structure_issues":[],"recommendations":[]}\n```'
    const r = await analyzeNative({ userId: 'user-123', pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(200)
    expect(r.body.opportunities.title_issues).toEqual(['x'])
  })
})

describe('generateDraftsNative', () => {
  it('returns 400 when inputs missing', async () => {
    const r1 = await generateDraftsNative({})
    const r2 = await generateDraftsNative({ userId: 'u' })
    expect(r1.status).toBe(400)
    expect(r2.status).toBe(400)
  })

  it('generates drafts and ensures expected channel keys', async () => {
    mockCompletion.value = JSON.stringify({
      social_post: { headline: 'Hi', body: 'Body', cta: 'Click' },
      search_ad: { headline_1: 'H1', headline_2: 'H2', description: 'desc' },
      email: { subject: 'S', preview_text: 'P', body_intro: 'Intro' },
    })
    const r = await generateDraftsNative({ userId: 'user-123', pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(200)
    expect(r.body.drafts.social_post.headline).toBe('Hi')
    expect(r.body.drafts.search_ad.headline_1).toBe('H1')
    expect(r.body.drafts.email.subject).toBe('S')
    expect(mockDbCalls.updateOne).toBe(1)
  })

  it('fills empty channels when LLM omits one', async () => {
    mockCompletion.value = JSON.stringify({
      social_post: { headline: 'Hi', body: 'Body', cta: 'Click' },
    })
    const r = await generateDraftsNative({ userId: 'user-123', pageId: 'abc123def456abc123def456' })
    expect(r.status).toBe(200)
    expect(r.body.drafts.search_ad).toEqual({})
    expect(r.body.drafts.email).toEqual({})
  })
})
