import React, { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertTriangle, Image as ImageIcon, Palette, Layout, Clock } from 'lucide-react'

/**
 * BuildObservatoryPanel — renders the build_manifest emitted by the
 * pipeline. Answers "why isn't my logo rendering?" in 3 seconds.
 *
 * Collapses by default; expand to see assets.js contents, theme tokens,
 * layout blueprint, integrity checks, and per-phase timing.
 */
export default function BuildObservatoryPanel({ manifest }) {
  const [open, setOpen] = useState(true)
  if (!manifest) return null

  const { assets, theme, blueprint, attachments, timings = [], integrity = [], warnings = [] } = manifest
  const passed = integrity.filter((c) => c.pass).length
  const failed = integrity.length - passed

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
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 text-[11px]">
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
