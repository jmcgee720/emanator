'use client'

import { Palette, Sun, Layers, Paintbrush, Eye } from 'lucide-react'

/**
 * CreativeBriefCard — displays the detected creative direction
 * before/during AI generation so the user can see the vibe.
 */
export default function CreativeBriefCard({ brief }) {
  if (!brief) return null

  const moodColors = {
    luxurious: 'from-amber-500/20 to-yellow-600/10 border-amber-500/25',
    minimal: 'from-zinc-400/15 to-slate-500/10 border-zinc-400/20',
    vibrant: 'from-pink-500/20 to-orange-500/10 border-pink-500/25',
    moody: 'from-purple-500/20 to-indigo-600/10 border-purple-500/25',
    organic: 'from-emerald-500/20 to-green-600/10 border-emerald-500/25',
    futuristic: 'from-cyan-500/20 to-blue-600/10 border-cyan-500/25',
    playful: 'from-rose-400/20 to-pink-500/10 border-rose-400/25',
    elegant: 'from-slate-400/15 to-violet-500/10 border-slate-400/20',
    raw: 'from-red-500/20 to-orange-700/10 border-red-500/25',
    ethereal: 'from-violet-400/20 to-blue-300/10 border-violet-400/25',
  }

  const moodEmoji = {
    luxurious: '\\u2728', minimal: '\\u25CB', vibrant: '\\u26A1', moody: '\\u25CF',
    organic: '\\u2618', futuristic: '\\u25C6', playful: '\\u25B2', elegant: '\\u25C7',
    raw: '\\u2716', ethereal: '\\u2606',
  }

  const gradient = moodColors[brief.mood] || moodColors.elegant
  const mood = brief.mood || 'elegant'

  return (
    <div
      className={`rounded-lg border bg-gradient-to-br ${gradient} p-3 mb-2 backdrop-blur-sm`}
      data-testid="creative-brief-card"
    >
      <div className="flex items-center gap-2 mb-2">
        <Eye className="w-3.5 h-3.5 text-[var(--em-cyan)]" />
        <span className="text-[11px] font-semibold tracking-wide uppercase text-[var(--em-text-secondary)]">
          Creative Direction
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Mood */}
        <div className="flex items-center gap-1.5 bg-black/20 rounded-md px-2 py-1" data-testid="brief-mood">
          <Palette className="w-3 h-3 text-[var(--em-cyan)]" />
          <span className="text-[11px] font-medium text-[var(--em-text-primary)] capitalize">{mood}</span>
        </div>

        {/* Subjects */}
        {brief.subjects?.length > 0 && brief.subjects.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 bg-black/20 rounded-md px-2 py-1" data-testid={`brief-subject-${s}`}>
            <Layers className="w-3 h-3 text-emerald-400/70" />
            <span className="text-[11px] text-[var(--em-text-secondary)] capitalize">{s}</span>
          </div>
        ))}

        {/* Colors */}
        {brief.colors?.length > 0 && (
          <div className="flex items-center gap-1.5 bg-black/20 rounded-md px-2 py-1" data-testid="brief-colors">
            <Paintbrush className="w-3 h-3 text-pink-400/70" />
            <span className="text-[11px] text-[var(--em-text-secondary)]">{brief.colors.join(', ')}</span>
          </div>
        )}

        {/* Lighting */}
        {brief.lightingCues?.length > 0 && (
          <div className="flex items-center gap-1.5 bg-black/20 rounded-md px-2 py-1" data-testid="brief-lighting">
            <Sun className="w-3 h-3 text-yellow-400/70" />
            <span className="text-[11px] text-[var(--em-text-secondary)] truncate max-w-[200px]">
              {brief.lightingCues[0].split(',')[0]}
            </span>
          </div>
        )}
      </div>

      {/* Mood parameters */}
      {brief.moodParams && (
        <div className="mt-2 text-[10px] text-[var(--em-text-muted)] leading-relaxed">
          <span className="text-[var(--em-text-secondary)]">Palette:</span> {brief.moodParams.palette}
          {' · '}
          <span className="text-[var(--em-text-secondary)]">Space:</span> {brief.moodParams.space}
        </div>
      )}
    </div>
  )
}
