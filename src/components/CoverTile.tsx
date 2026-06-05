import type { Podcast } from '../lib/types'
import { Icon } from './Icon'

// Generated cover art: a tonal gradient from the podcast's brand color plus its
// monogram, drawn as an SVG so it scales crisply at any tile size. Keeps the
// prototype fully self-contained (no external image hosts) while giving every
// show a distinct, on-brand identity.

interface CoverTileProps {
  podcast: Pick<Podcast, 'color' | 'monogram' | 'source'>
  className?: string
  rounded?: string
  /** Show the source glyph (podcast / youtube) in the corner. */
  showSource?: boolean
}

export function CoverTile({
  podcast,
  className = 'w-12 h-12',
  rounded = 'rounded-lg',
  showSource = false,
}: CoverTileProps) {
  const fontSize = podcast.monogram.length >= 3 ? 32 : 44
  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${rounded} ${className}`}
      style={{ background: `linear-gradient(145deg, ${podcast.color} 0%, ${shade(podcast.color, -28)} 100%)` }}
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{ background: 'radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,0.35), transparent 60%)' }}
      />
      <svg viewBox="0 0 100 100" className="relative h-full w-full" role="img" aria-label={podcast.monogram}>
        <text
          x="50"
          y="52"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#ffffff"
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize={fontSize}
          letterSpacing="-1"
        >
          {podcast.monogram}
        </text>
      </svg>
      {showSource && (
        <span className="absolute bottom-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/30 backdrop-blur">
          <Icon name={podcast.source === 'youtube' ? 'smart_display' : 'podcasts'} size={13} className="text-white" />
        </span>
      )}
    </div>
  )
}

// Darken/lighten a hex color by a percentage (-100..100).
function shade(hex: string, percent: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const t = percent < 0 ? 0 : 255
  const p = Math.abs(percent) / 100
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const mix = (c: number) => Math.round((t - c) * p) + c
  return `#${((1 << 24) + (mix(r) << 16) + (mix(g) << 8) + mix(b)).toString(16).slice(1)}`
}
