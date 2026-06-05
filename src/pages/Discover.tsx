import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useAppData } from '../store/AppData'
import { addSource } from '../lib/api'
import type { Podcast } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'

export default function Discover() {
  const { podcasts, toggleTracked } = useAppData()
  const [query, setQuery] = useState('')
  const [accepted, setAccepted] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const trackedCount = useMemo(() => podcasts.filter((p) => p.tracked).length, [podcasts])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSubmitting(true)
    const res = await addSource({ query: q })
    setSubmitting(false)
    if (res.accepted) {
      setAccepted(q)
      setQuery('')
    }
  }

  return (
    <div className="animate-fade-up">
      {/* Hero */}
      <section className="relative mb-xl overflow-hidden rounded-2xl p-xl text-white">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0058bc 0%, #001a41 100%)' }} />
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: 'radial-gradient(60% 120% at 90% 10%, rgba(173,198,255,0.6), transparent 55%)' }}
        />
        <div className="relative max-w-2xl">
          <h2 className="text-display-lg">Track the podcasts that matter to you</h2>
          <p className="mt-2 text-body-lg text-white/80">
            Add a show or paste a YouTube channel URL. SignalCast watches for every new episode and turns it into a
            one-page summary — automatically.
          </p>

          <form onSubmit={onSubmit} className="mt-lg flex flex-col gap-sm sm:flex-row">
            <div className="relative flex-1">
              <Icon name="search" size={20} className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setAccepted(null)
                }}
                placeholder="Podcast name, RSS feed, or YouTube channel URL"
                className="w-full rounded-lg border border-transparent bg-white py-3 pl-11 pr-sm text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary-fixed-dim"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-lg py-3 text-metadata font-semibold text-primary transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Icon name={submitting ? 'progress_activity' : 'add'} size={18} className={submitting ? 'animate-spin' : ''} />
              Track source
            </button>
          </form>

          {accepted && (
            <p className="mt-sm inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-metadata backdrop-blur">
              <Icon name="check_circle" size={16} fill /> Tracking <span className="font-semibold">{accepted}</span> — we'll
              detect new episodes and summarize them.
            </p>
          )}
        </div>
      </section>

      {/* Grid */}
      <div className="mb-md flex items-end justify-between">
        <div>
          <h3 className="text-display-sm text-on-surface">Recommended for you</h3>
          <p className="text-metadata text-secondary">Tech & investing shows your peers track most.</p>
        </div>
        <span className="rounded-full chip-signal px-3 py-1.5 text-metadata font-semibold">{trackedCount} tracked</span>
      </div>

      <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
        {podcasts.map((p) => (
          <PodcastCard key={p.id} podcast={p} onToggle={() => toggleTracked(p.id)} />
        ))}

        {/* Add-your-own */}
        <button
          onClick={() => document.querySelector<HTMLInputElement>('input')?.focus()}
          className="group flex min-h-[220px] flex-col items-center justify-center gap-sm rounded-2xl border-2 border-dashed border-outline-variant p-md text-center transition-colors hover:border-primary"
        >
          <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-container-high text-on-surface-variant transition-colors group-hover:bg-primary group-hover:text-on-primary">
            <Icon name="add" />
          </span>
          <span className="text-display-sm text-on-surface">Add your own</span>
          <span className="max-w-[220px] text-metadata text-secondary">Paste an RSS feed or YouTube URL above to start tracking.</span>
        </button>
      </div>
    </div>
  )
}

function PodcastCard({ podcast, onToggle }: { podcast: Podcast; onToggle: () => void }) {
  const tracked = podcast.tracked
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-surface-container-lowest p-md transition-shadow hover:shadow-card ${
        tracked ? 'border-primary ring-1 ring-primary/20' : 'border-outline-variant'
      }`}
    >
      <div className="relative mb-md h-40 overflow-hidden rounded-xl">
        <CoverTile podcast={podcast} className="h-full w-full" rounded="rounded-xl" showSource />
        <span className="absolute right-sm top-sm rounded-full bg-white/90 px-2.5 py-1 text-label-caps uppercase text-primary backdrop-blur">
          {podcast.category}
        </span>
      </div>

      <div className="mb-xs flex items-start justify-between gap-sm">
        <h4 className="text-display-sm leading-tight text-on-surface">{podcast.title}</h4>
        <span className="shrink-0 pt-1 text-metadata text-secondary">{podcast.episodeCount}+ eps</span>
      </div>
      <p className="mb-xs text-metadata text-on-surface-variant">{podcast.author}</p>
      <p className="mb-md line-clamp-2 text-body-md text-on-surface-variant">{podcast.description}</p>

      <div className="mt-auto flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[12px] text-secondary">
          <Icon name="schedule" size={14} /> {podcast.cadence}
        </span>
        <button
          onClick={onToggle}
          className={`inline-flex items-center gap-1.5 rounded-lg px-lg py-2 text-metadata font-semibold transition-colors ${
            tracked
              ? 'bg-surface-container text-on-surface hover:bg-surface-container-high'
              : 'bg-primary text-on-primary hover:bg-primary-container'
          }`}
        >
          <Icon name={tracked ? 'check' : 'add'} size={16} />
          {tracked ? 'Tracking' : 'Add'}
        </button>
      </div>
    </div>
  )
}
