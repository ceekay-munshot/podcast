import { Icon } from './Icon'
import type { Tone, ToneLabel } from '../lib/tone'

// Visual language for a tone read. Greens / reds match the inline sentiment
// palette exactly; "mixed" gets amber, "neutral" stays quiet.
const META: Record<ToneLabel, { label: string; icon: string; text: string }> = {
  positive: { label: 'Positive', icon: 'trending_up', text: 'text-[#15803d]' },
  cautious: { label: 'Cautious', icon: 'trending_down', text: 'text-[#b91c1c]' },
  mixed: { label: 'Mixed', icon: 'trending_flat', text: 'text-[#b45309]' },
  neutral: { label: 'Neutral', icon: 'remove', text: 'text-secondary' },
}

function tip(tone: Tone): string {
  if (tone.signal === 0) return 'No clear sentiment signal in this analysis yet'
  return `Tone from this analysis — ${tone.posHits} positive vs ${tone.negHits} negative signal${tone.signal === 1 ? '' : 's'}`
}

// Full meter: a labelled read + a proportion bar (green share vs red share of the
// total signal), so the number behind the word is visible at a glance.
export function ToneMeter({ tone, className = '' }: { tone: Tone; className?: string }) {
  const m = META[tone.label]
  const pos = Math.round(tone.posRatio * 100)
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={tip(tone)}>
      <span className={`inline-flex items-center gap-1 font-semibold ${m.text}`}>
        <Icon name={m.icon} size={15} /> {m.label}
      </span>
      {tone.signal >= 2 && (
        <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-container-high" aria-hidden>
          <span className="absolute inset-y-0 left-0 bg-[#16a34a]" style={{ width: `${pos}%` }} />
          <span className="absolute inset-y-0 right-0 bg-[#dc2626]" style={{ width: `${100 - pos}%` }} />
        </span>
      )}
    </span>
  )
}

// Compact badge for dense rows — icon + label, and nothing at all when there's
// no real signal (keeps the Episodes table calm).
export function ToneBadge({ tone, className = '' }: { tone: Tone; className?: string }) {
  if (tone.label === 'neutral') return null
  const m = META[tone.label]
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${m.text} ${className}`} title={tip(tone)}>
      <Icon name={m.icon} size={15} /> {m.label}
    </span>
  )
}
