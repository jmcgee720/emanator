/**
 * Phase 6: Polish
 *
 * This phase is intentionally a no-op in v1. Compose already enforces
 * multi-column grids, hover states, typography tokens, and 300+ lines.
 * Running another LLM call here burns credits without adding much.
 *
 * Future work: wire this to a lightweight post-check that reads compose
 * output and ONLY calls the LLM if it detects issues (missing a11y attrs,
 * no responsive classes, broken links). For now we pass through.
 */
export async function* runPhasePolish(ctx) {
  const { priorResults } = ctx
  const phaseStart = Date.now()
  const composed = priorResults.compose
  yield { event: 'status', data: { stage: 'polish', detail: 'Skipping polish (disabled in v1)...' } }
  return { files: composed?.files || [], skipped: true, _ms: Date.now() - phaseStart }
}
