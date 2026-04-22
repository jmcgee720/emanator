import React, { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertTriangle, Image as ImageIcon, Palette, Layout, Clock, Layers, Eye } from 'lucide-react'

/**
 * BuildObservatoryPanel — renders the build_manifest emitted by the
 * pipeline. Answers "why isn't my logo rendering?" in 3 seconds.
 *
 * Collapses by default; expand to see assets.js contents, theme tokens,
 * layout blueprint, integrity checks, and per-phase timing.
 */
export default function BuildObservatoryPanel({ manifest, screenshotVerify, visualLoopSummary }) {
  const [open, setOpen] = useState(true)
  if (!manifest) return null

  const { assets, theme, blueprint, family, attachments, timings = [], integrity = [], warnings = [], qualityScore = null } = manifest
  const passed = integrity.filter((c) => c.pass).length
  const failed = integrity.length - passed
  const verifyFindings = screenshotVerify?.findings?.length || 0
  const loopRounds = visualLoopSummary?.rounds?.length || 0

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'rgba(0,229,255,0.02)', borderColor: 'rgba(0,229,255,0.15)' }}
      data-testid="build-observatory"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-white/80 hover:bg-[rgba(0,229,255,0.03)]"
        data-testid="build-observatory-toggle"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Build observatory
          {qualityScore && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${GRADE_CHIP_CLASSES[qualityScore.gradeColor] || GRADE_CHIP_CLASSES.sky}`}
              data-testid="observatory-quality-chip"
              title={qualityScore.headline}
            >
              {qualityScore.total}/100 · {qualityScore.grade}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-amber-300 bg-amber-500/10" data-testid="observatory-warnings-chip">
              <AlertTriangle className="w-3 h-3" /> {warnings.length}
            </span>
          )}
          {failed > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-rose-300 bg-rose-500/10" data-testid="observatory-fail-chip">
              <XCircle className="w-3 h-3" /> {failed} failing
            </span>
          )}
          {failed === 0 && integrity.length > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-emerald-300 bg-emerald-500/10" data-testid="observatory-pass-chip">
              <CheckCircle2 className="w-3 h-3" /> {passed}/{integrity.length} integrity
            </span>
          )}
          {screenshotVerify && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${screenshotVerify.matches ? 'text-sky-300 bg-sky-500/10' : 'text-rose-300 bg-rose-500/10'}`}
              data-testid="observatory-verify-chip"
            >
              <Eye className="w-3 h-3" />
              {screenshotVerify.matches ? 'Vision match' : `Vision: ${verifyFindings} off`}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 text-[11px]">
          {qualityScore && <QualityScoreCard score={qualityScore} />}
          {warnings.length > 0 && (
            <div className="space-y-1" data-testid="observatory-warnings">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/20 text-amber-200/90">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <Section icon={ImageIcon} label="Assets manifest" testId="observatory-assets">
            {!assets.emitted ? (
              <div className="text-white/50 italic">components/assets.js not emitted — no brand uploads tagged.</div>
            ) : (
              <ul className="space-y-1">
                {assets.exports.map((exp) => (
                  <li key={exp.name} className="flex items-start gap-2" data-testid={`observatory-asset-${exp.name}`}>
                    <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-white/85">{exp.name}</div>
                      <div className="text-white/50">{exp.sourceFile} · {formatBytes(exp.sizeBytes)}</div>
                      {exp.note && <div className="text-cyan-300/80 italic">note: {exp.note}</div>}
                    </div>
                  </li>
                ))}
                {assets.missing.map((m) => (
                  <li key={m} className="flex items-start gap-2 text-white/45" data-testid={`observatory-missing-${m}`}>
                    <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-white/40" />
                    <span className="font-mono">{m}<span className="not-italic ml-2 text-white/40">— not provided</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Palette} label="Design tokens" testId="observatory-theme">
            {!theme.emitted ? (
              <div className="text-white/50 italic">theme.js not emitted — using defaults.</div>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <Kv k="vibe" v={theme.tokens.vibe} />
                <Kv k="mode" v={theme.tokens.mode} />
                <Kv k="primary" v={theme.tokens.primary} swatch />
                <Kv k="bg" v={theme.tokens.bg} swatch />
                <Kv k="ink" v={theme.tokens.ink} swatch />
                <Kv k="accent" v={theme.tokens.accent} swatch />
                <Kv k="radius" v={theme.tokens.radius} />
                <Kv k="display" v={theme.tokens.fontDisplay} />
              </div>
            )}
          </Section>

          {family && (
            <Section icon={Layers} label="Recipe family" testId="observatory-family">
              <div className="space-y-0.5">
                <Kv k="pick" v={family.family} />
                <Kv k="confidence" v={`${(family.confidence * 100).toFixed(0)}%`} />
                {family.reason && (
                  <div className="text-white/60 italic pt-1">{family.reason}</div>
                )}
              </div>
            </Section>
          )}

          {blueprint && (
            <Section icon={Layout} label="Layout blueprint" testId="observatory-blueprint">
              <div className="space-y-0.5">
                <Kv k="sections" v={blueprint.sections_order.join(' → ')} />
                <Kv k="hero" v={`${blueprint.hero_composition} · ${blueprint.hero_text_alignment}`} />
                <Kv k="navbar" v={blueprint.navbar_style} />
                <Kv k="features" v={`${blueprint.feature_columns}-col · ${blueprint.feature_card_style}`} />
                <Kv k="pricing" v={blueprint.pricing_pattern} />
              </div>
            </Section>
          )}

          {integrity.length > 0 && (
            <Section icon={CheckCircle2} label="Integrity checks" testId="observatory-integrity">
              <ul className="space-y-1">
                {integrity.map((c, i) => (
                  <li key={i} className="flex items-start gap-2" data-testid={`observatory-check-${c.pass ? 'pass' : 'fail'}-${i}`}>
                    {c.pass ? (
                      <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-rose-400" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={c.pass ? 'text-white/85' : 'text-rose-200'}>{c.name}</div>
                      {c.detail && <div className="text-white/45 text-[10px]">{c.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {screenshotVerify && (
            <Section icon={Eye} label="Vision verify (reference vs. generated code)" testId="observatory-screenshot-verify">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {screenshotVerify.matches ? (
                    <span className="inline-flex items-center gap-1 text-sky-300"><CheckCircle2 className="w-3 h-3" /> matches references</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-rose-300"><XCircle className="w-3 h-3" /> {verifyFindings} mismatch(es)</span>
                  )}
                  <span className="text-white/45">· {Math.round((screenshotVerify.confidence || 0) * 100)}% confidence</span>
                </div>
                {screenshotVerify.summary && (
                  <div className="text-white/65 italic" data-testid="observatory-verify-summary">{screenshotVerify.summary}</div>
                )}
                {verifyFindings > 0 && (
                  <ul className="space-y-1 mt-1" data-testid="observatory-verify-findings">
                    {screenshotVerify.findings.map((f, i) => (
                      <li key={i} className="border-l-2 border-rose-400/30 pl-2">
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-rose-200/70 font-mono">{f.category}</span>
                          <span className="text-white/75">{f.issue}</span>
                        </div>
                        {f.file && <div className="text-[10px] text-white/45 font-mono">{f.file}</div>}
                        {f.fix && <div className="text-[10px] text-emerald-200/70">→ {f.fix}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          )}

          {visualLoopSummary && loopRounds > 0 && (
            <Section icon={Layers} label={`Visual repair loop (${loopRounds} round${loopRounds === 1 ? '' : 's'})`} testId="observatory-visual-loop">
              <div className="space-y-1">
                <div className="flex items-center gap-3 text-white/65">
                  <span>Initial findings: <strong className="text-white/85">{visualLoopSummary.initialFindings}</strong></span>
                  <span>·</span>
                  <span>Repaired: <strong className="text-white/85">{visualLoopSummary.totalFilesRepaired}</strong> file(s)</span>
                  <span>·</span>
                  <span className={visualLoopSummary.finalMatches ? 'text-emerald-300' : 'text-amber-300'}>
                    {visualLoopSummary.finalMatches ? 'Final: MATCH' : 'Final: partial match'}
                  </span>
                </div>
                <ol className="mt-1 space-y-0.5" data-testid="observatory-visual-rounds">
                  {visualLoopSummary.rounds.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="text-white/45">#{r.round}</span>
                      <span className="text-white/65">{r.findings} finding{r.findings === 1 ? '' : 's'}</span>
                      <span className="text-white/45">·</span>
                      <span className="text-white/65">{r.filesRepaired} file(s) repaired</span>
                      <span className="text-white/45">·</span>
                      <span className={r.matches ? 'text-emerald-300' : 'text-amber-300'}>
                        {r.matches ? 'MATCH' : `${Math.round((r.confidence || 0) * 100)}%`}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </Section>
          )}

          <Section icon={Clock} label="Phase timings" testId="observatory-timings">
            {timings.length === 0 ? (
              <div className="text-white/50 italic">no timings captured</div>
            ) : (
              <ul className="space-y-0.5 font-mono">
                {timings.map((t, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-white/65">{t.stage}</span>
                    <span className="text-cyan-300/80">{t.ms}ms</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="text-[10px] text-white/45 border-t border-white/5 pt-2">
            Attachments: {attachments.total || 0} total · {attachments.brand || 0} brand · {attachments.aesthetic || 0} aesthetic · {attachments.structural || 0} structural
            {attachments.untagged ? ` · ${attachments.untagged} untagged` : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ icon: Icon, label, testId, children }) {
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/45 mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="pl-1">{children}</div>
    </div>
  )
}

function Kv({ k, v, swatch }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-white/55">{k}</span>
      {swatch && <span className="inline-block w-3 h-3 rounded border border-white/10" style={{ background: v }} />}
      <span className="font-mono text-white/80 truncate" title={String(v)}>{v}</span>
    </div>
  )
}

function formatBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ── Quality-score visuals ──
// Static Tailwind class maps so the JIT compiler can see every utility.
const GRADE_CHIP_CLASSES = {
  emerald: 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20',
  sky:     'text-sky-300 bg-sky-500/10 border border-sky-500/20',
  amber:   'text-amber-300 bg-amber-500/10 border border-amber-500/20',
  rose:    'text-rose-300 bg-rose-500/10 border border-rose-500/20',
}

const GRADE_RING = {
  emerald: { ring: 'ring-emerald-500/40', glow: 'shadow-[0_0_40px_rgba(16,185,129,0.25)]', text: 'text-emerald-300' },
  sky:     { ring: 'ring-sky-500/40',     glow: 'shadow-[0_0_40px_rgba(56,189,248,0.25)]',  text: 'text-sky-300' },
  amber:   { ring: 'ring-amber-500/40',   glow: 'shadow-[0_0_40px_rgba(245,158,11,0.22)]',  text: 'text-amber-300' },
  rose:    { ring: 'ring-rose-500/40',    glow: 'shadow-[0_0_40px_rgba(244,63,94,0.22)]',   text: 'text-rose-300' },
}

function QualityScoreCard({ score }) {
  const palette = GRADE_RING[score.gradeColor] || GRADE_RING.sky
  return (
    <div
      className={`rounded-lg border border-white/10 bg-[rgba(255,255,255,0.02)] p-3 ring-1 ${palette.ring} ${palette.glow}`}
      data-testid="observatory-quality-score"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 flex flex-col items-center justify-center w-20 h-20 rounded-xl bg-[rgba(0,0,0,0.35)] border border-white/10">
          <div className={`text-3xl font-bold tracking-tight ${palette.text}`} data-testid="observatory-quality-total">
            {score.total}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/40">/ 100</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-white/45">Build quality</span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${GRADE_CHIP_CLASSES[score.gradeColor] || GRADE_CHIP_CLASSES.sky}`}
              data-testid="observatory-quality-grade"
            >
              {score.grade}
            </span>
          </div>
          <div className="text-white/90 mt-0.5" data-testid="observatory-quality-headline">{score.headline}</div>
          <ul className="mt-2 space-y-1" data-testid="observatory-quality-breakdown">
            {score.components.map((c) => {
              const rate = c.max > 0 ? c.points / c.max : 0
              const barClass =
                rate >= 0.9 ? 'bg-emerald-400' :
                rate >= 0.5 ? 'bg-sky-400' :
                rate >= 0.25 ? 'bg-amber-400' : 'bg-rose-400'
              const testId = `observatory-quality-component-${c.name.replace(/\s+/g, '-').toLowerCase()}`
              return (
                <li key={c.name} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2" data-testid={testId}>
                  <span className="text-white/65 truncate">{c.name}</span>
                  <span className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <span className={`block h-full ${barClass}`} style={{ width: `${Math.max(2, rate * 100)}%` }} />
                  </span>
                  <span className="font-mono text-[10px] text-white/55 tabular-nums">
                    {c.points}/{c.max} <span className="text-white/35">· {c.note}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
