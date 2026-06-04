// Locks the wiring of the Haiku Fast Mode toggle introduced 2026-02.
//
// The toggle is a one-click pill that swaps the active model to
// claude-haiku-4-5 (cheap/fast) and snapshots the previous selection so
// toggling back restores it exactly. This test pins:
//   1) ChatComposer renders a `fast-mode-toggle` button when a callback is
//      passed (no callback → no button, so we don't break older callers).
//   2) Dashboard holds the snapshot state (`prevModel`) and switches both
//      provider + model.
//   3) LeftPanel forwards the props through to ChatComposer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('ChatComposer accepts fastMode + onToggleFastMode props', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/ChatComposer.jsx'), 'utf8')
  assert.match(src, /fastMode = false,\s*onToggleFastMode,/, 'must destructure both props with safe default')
  assert.match(src, /data-testid="fast-mode-toggle"/, 'must expose stable test id')
  assert.match(src, /aria-pressed=\{fastMode\}/, 'must be accessible as a toggle')
  // Conditional render guards against accidentally rendering on legacy mounts
  assert.match(src, /onToggleFastMode && \(/, 'must not render the pill when no callback wired')
})

test('Dashboard owns fast-mode snapshot state and wires toggle', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/Dashboard.jsx'), 'utf8')
  assert.match(src, /const \[fastMode, setFastMode\] = useState\(false\)/)
  assert.match(src, /const \[prevModel, setPrevModel\] = useState\(null\)/, 'must keep snapshot of previous selection')
  // On enable: snapshots prev and switches both provider + model
  assert.match(src, /setPrevModel\(\{ provider: aiProvider, model: aiModel \}\)/)
  assert.match(src, /setAiModel\('claude-haiku-4-5-20251001'\)/)
  // On disable: restores the snapshot, doesn't just default
  assert.match(src, /setAiProvider\(prevModel\.provider\)/)
  assert.match(src, /setAiModel\(prevModel\.model\)/)
  // Wires both into LeftPanel
  assert.match(src, /fastMode=\{fastMode\}/)
  assert.match(src, /onToggleFastMode=\{toggleFastMode\}/)
})

test('LeftPanel forwards fast-mode props to ChatComposer', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/LeftPanel.jsx'), 'utf8')
  // Destructured from props
  assert.match(src, /fastMode,\s*\n\s*onToggleFastMode,/)
  // Forwarded to the composer
  assert.match(src, /fastMode=\{fastMode\}\s*\n\s*onToggleFastMode=\{onToggleFastMode\}/)
})
