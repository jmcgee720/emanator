// ── run_command credential leak guard ──
// Verifies the runtime refuses to execute shell commands that contain
// token-shaped strings. This is the last line of defence against the
// AI pasting a GitHub PAT / API key / JWT into a curl invocation that
// would otherwise echo into the chat transcript.

import { test, describe, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runCommandTool } from '../lib/ai/agent-tools-v2.js'

let TMP, scope, tool

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'run-cmd-sanitizer-'))
  scope = { rootDirs: [TMP], excludePaths: [], execTimeoutMs: 5000 }
  tool = runCommandTool(scope)
})

after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
})

describe('runCommandTool credential sanitizer', () => {
  test('refuses GitHub classic PAT (ghp_)', async () => {
    await assert.rejects(
      () => tool.execute({ command: 'curl -H "Authorization: token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" https://api.github.com/user' }),
      /credential|token|key/i,
    )
  })

  test('refuses GitHub fine-grained PAT (github_pat_)', async () => {
    await assert.rejects(
      () => tool.execute({ command: 'curl -u user:github_pat_11AAAAAAAAAAAAAAAAAAAAAA https://api.github.com' }),
      /credential|token|key/i,
    )
  })

  test('refuses OpenAI/Anthropic-style key (sk-)', async () => {
    await assert.rejects(
      () => tool.execute({ command: 'curl -H "Authorization: Bearer sk-aaaaaaaaaaaaaaaaaaaaaaaa" https://api.openai.com' }),
      /credential|token|key/i,
    )
  })

  test('refuses long JWT', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNjM1MzA3MTYz.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    await assert.rejects(
      () => tool.execute({ command: `curl -H "apikey: ${jwt}" https://example.supabase.co/rest/v1` }),
      /credential|token|key/i,
    )
  })

  test('refuses Slack bot token', async () => {
    await assert.rejects(
      () => tool.execute({ command: 'curl -H "Authorization: Bearer xoxb-1234567890-abcdefghijklmnop" https://slack.com/api/chat' }),
      /credential|token|key/i,
    )
  })

  test('ALLOWS innocuous shell command', async () => {
    const out = await tool.execute({ command: 'echo hello' })
    assert.match(out, /hello/)
  })

  test('ALLOWS git status (no token)', async () => {
    const out = await tool.execute({ command: 'pwd' })
    assert.ok(out && typeof out === 'string')
  })

  test('refuses even when the token is embedded mid-string', async () => {
    await assert.rejects(
      () => tool.execute({ command: 'echo "my key is ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA today"' }),
      /credential|token|key/i,
    )
  })
})
