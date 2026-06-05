import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { addSource } from '../lib/api'
import type { Podcast } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'

const STEPS = [
  { n: 1, title: 'Add Podcasts', sub: 'Choose podcasts to track' },
  { n: 2, title: 'Your Interests', sub: 'Tell us what you care about' },
  { n: 3, title: 'Review & Finish', sub: 'Confirm and get started' },
]

export default function Discover() {
  const { podcasts, toggleTracked } = useAppData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [accepted, setAccepted] = useState<string | null>(null)

  const tracked = podcasts.filter((p) => p.tracked && !p.locked)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    const res = await addSource({ query: q })
    if (res.accepted) {
      setAccepted(q)
      setQuery('')
    }
  }

  return (
    <div className="animate-fade-up pb-24">
      {/* Stepper */}
      <ol className="mb-xl flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s.n} className="flex flex-1 items-center gap-3">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold ${
                s.n === 1 ? 'bg-primary text-on-primary' : 'border border-outline-variant text-secondary'
              }`}
            >
              {s.n}
            </span>
            <div className="hidden sm:block">
              <p className={`text-[14px] font-semibold ${s.n === 1 ? 'text-primary' : 'text-on-surface'}`}>{s.title}</p>
              <p className="text-[12px] text-secondary">{s.sub}</p>
            </div>
            {i < STEPS.length - 1 && <span className="mx-2 hidden h-px flex-1 bg-outline-variant sm:block" />}
          </li>
        ))}
      </ol>

      {/* Heading + search */}
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-display-lg tracking-tight text-on-surface">Track the podcasts that matter to you</h1>
        <p className="mt-2 text-body-lg text-secondary">Search for podcasts or paste a YouTube channel URL to get started.</p>
        <form onSubmit={onSubmit} className="relative mx-auto mt-lg">
          <Icon name="search" size={22} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setAccepted(null)
            }}
            placeholder="Search podcasts or paste YouTube channel URL"
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest py-3.5 pl-12 pr-4 text-body-md shadow-card outline-none focus:border-primary"
          />
        </form>
        {accepted && (
          <p className="mt-sm inline-flex items-center gap-1.5 rounded-lg chip-signal px-3 py-2 text-metadata font-medium">
            <Icon name="check_circle" size={16} fill /> Tracking <span className="font-semibold">{accepted}</span> — we'll detect new episodes.
          </p>
        )}
      </div>

      {/* Popular */}
      <h3 className="mb-md mt-xl text-[19px] font-semibold text-on-surface">Popular Right Now</h3>
      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2">
        {podcasts.map((p) => (
          <PodcastCard key={p.id} podcast={p} onToggle={() => toggleTracked(p.id)} />
        ))}
      </div>

      {/* Selected bar */}
      {tracked.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 pl-64">
          <div className="mx-auto max-w-container px-lg pb-4">
            <div className="flex flex-wrap items-center gap-md rounded-2xl border border-outline-variant bg-surface/95 px-md py-3 shadow-player backdrop-blur-xl">
              <div className="shrink-0">
                <p className="text-[15px] font-semibold text-on-surface">Selected ({tracked.length})</p>
                <p className="text-[12px] text-secondary">You can add or remove podcasts anytime.</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                {tracked.slice(0, 4).map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-[13px] font-medium text-on-surface">
                    <CoverTile podcast={p} className="h-5 w-5" rounded="rounded" /> {p.title}
                    <button onClick={() => toggleTracked(p.id)} className="text-outline hover:text-error" aria-label={`Remove ${p.title}`}>
                      <Icon name="close" size={15} />
                    </button>
                  </span>
                ))}
                {tracked.length > 4 && <span className="self-center text-[13px] text-secondary">+{tracked.length - 4} more</span>}
              </div>
              <button
                onClick={() => navigate('/')}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-lg py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container"
              >
                Continue <Icon name="arrow_forward" size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PodcastCard({ podcast, onToggle }: { podcast: Podcast; onToggle: () => void }) {
  // Locked = no public feed. Can't be tracked, ingested, or transcribed — render
  // it plainly as locked rather than letting it imply analyzable content.
  if (podcast.locked) {
    return (
      <div className="flex items-center gap-md rounded-xl border border-dashed border-outline-variant bg-surface-container-low p-md">
        <div className="relative shrink-0">
          <CoverTile podcast={podcast} className="h-16 w-16 opacity-50 grayscale" rounded="rounded-xl" showSource />
          <span className="absolute inset-0 grid place-items-center">
            <Icon name="lock" size={22} className="text-on-surface" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[16px] font-semibold text-on-surface-variant">{podcast.title}</h4>
            <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
              <Icon name="lock" size={11} /> Locked
            </span>
          </div>
          <p className="text-[12px] text-secondary">No public feed — episodes can't be ingested or transcribed.</p>
          <p className="mt-0.5 line-clamp-1 text-metadata text-outline">{podcast.description}</p>
        </div>
        <span
          className="grid h-9 w-9 shrink-0 cursor-not-allowed place-items-center rounded-full border border-outline-variant text-outline"
          title="No public feed — can't be tracked"
          aria-label={`${podcast.title} is locked — no public feed`}
        >
          <Icon name="lock" size={18} />
        </span>
      </div>
    )
  }
  const tracked = podcast.tracked
  return (
    <div
      className={`flex items-center gap-md rounded-xl border bg-surface-container-lowest p-md transition-shadow hover:shadow-card ${
        tracked ? 'border-primary ring-1 ring-primary/15' : 'border-outline-variant'
      }`}
    >
      <CoverTile podcast={podcast} className="h-16 w-16 shrink-0" rounded="rounded-xl" showSource />
      <div className="min-w-0 flex-1">
        <h4 className="text-[16px] font-semibold text-on-surface">{podcast.title}</h4>
        <p className="text-[12px] text-secondary">{podcast.category}</p>
        <p className="mt-0.5 line-clamp-1 text-metadata text-on-surface-variant">{podcast.description}</p>
      </div>
      <button
        onClick={onToggle}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
          tracked ? 'bg-primary text-on-primary' : 'border border-outline-variant text-primary hover:bg-surface-container-low'
        }`}
        aria-label={tracked ? `Remove ${podcast.title}` : `Add ${podcast.title}`}
      >
        <Icon name={tracked ? 'check' : 'add'} size={20} />
      </button>
    </div>
  )
}
