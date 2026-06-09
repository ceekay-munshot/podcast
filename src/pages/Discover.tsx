import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { searchPodcasts } from '../lib/api'
import type { Podcast, PodcastSearchResult } from '../lib/types'
import { stableHash } from '../lib/hash'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'

const STEPS = [
  { n: 1, title: 'Add Podcasts', sub: 'Choose podcasts to track' },
  { n: 2, title: 'Your Interests', sub: 'Tell us what you care about' },
  { n: 3, title: 'Review & Finish', sub: 'Confirm and get started' },
]

// Cover palette for results with no artwork (e.g. YouTube channels). Deterministic
// per result so the same show always gets the same color.
const PALETTE = ['#0058bc', '#1c7d52', '#b3541e', '#5b3fa8', '#0a6e6e', '#1f3a8a', '#635bff', '#2f6f4f', '#d83b3b', '#e0792b']

function monogramOf(title: string): string {
  const words = title.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return 'PC'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// Search hit → a full Podcast the store can track (and CoverTile can render).
function toPodcast(r: PodcastSearchResult): Podcast {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    category: r.category,
    description: r.description,
    cadence: '',
    episodeCount: 0,
    source: r.source,
    color: PALETTE[parseInt(stableHash(r.id), 36) % PALETTE.length],
    monogram: monogramOf(r.title),
    artworkUrl: r.artworkUrl,
    feedUrl: r.feedUrl,
    tracked: true,
  }
}

const trimFeed = (u?: string) => (u ? u.trim().toLowerCase().replace(/\/+$/, '') : '')

export default function Discover() {
  const { podcasts, toggleTracked, addPodcast } = useAppData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PodcastSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(false)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const tracked = podcasts.filter((p) => p.tracked && !p.locked)
  const q = query.trim()

  // Live, debounced directory search. Each keystroke aborts the previous request,
  // so a slow earlier response can never overwrite a newer query's results.
  useEffect(() => {
    if (!q) {
      setResults([])
      setSearching(false)
      setError(false)
      return
    }
    setSearching(true)
    setError(false)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchPodcasts(q, controller.signal)
        .then((r) => {
          setResults(r)
          setSearching(false)
        })
        .catch((err) => {
          if ((err as { name?: string })?.name === 'AbortError') return // superseded — keep newer results
          setError(true)
          setSearching(false)
        })
    }, 300)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [q])

  // Already in the user's list? (by id or the same feed) → show as tracked.
  const isTracked = (r: PodcastSearchResult) =>
    podcasts.some((p) => p.tracked && (p.id === r.id || (!!p.feedUrl && trimFeed(p.feedUrl) === trimFeed(r.feedUrl))))

  function onAdd(r: PodcastSearchResult) {
    addPodcast(toPodcast(r))
    setJustAdded(r.title)
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
        <p className="mt-2 text-body-lg text-secondary">Search Apple Podcasts, or paste an RSS feed or YouTube channel URL to get started.</p>
        <form onSubmit={(e: FormEvent) => e.preventDefault()} className="relative mx-auto mt-lg">
          <Icon name="search" size={22} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setJustAdded(null)
            }}
            placeholder="Search podcasts or paste an RSS / YouTube channel URL"
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest py-3.5 pl-12 pr-11 text-body-md shadow-card outline-none focus:border-primary"
            autoFocus
          />
          {searching && (
            <Icon name="progress_activity" size={20} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-outline" />
          )}
        </form>
        {justAdded && (
          <p className="mt-sm inline-flex items-center gap-1.5 rounded-lg chip-signal px-3 py-2 text-metadata font-medium">
            <Icon name="check_circle" size={16} fill /> Tracking <span className="font-semibold">{justAdded}</span> — we'll detect new episodes.
          </p>
        )}
      </div>

      {/* Search results */}
      {q && (
        <div className="mt-xl">
          <h3 className="mb-md text-[19px] font-semibold text-on-surface">Search results</h3>
          {searching && results.length === 0 ? (
            <div className="grid grid-cols-1 gap-gutter md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
                  <div className="h-16 w-16 shrink-0 animate-pulse rounded-xl bg-surface-container-high" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-1/2 animate-pulse rounded bg-surface-container-high" />
                    <div className="h-3 w-1/4 animate-pulse rounded bg-surface-container-high" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-surface-container-high" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-low p-lg text-center">
              <p className="text-body-md text-on-surface-variant">Search is unavailable right now. Please try again in a moment.</p>
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-low p-lg text-center">
              <p className="text-body-md text-on-surface">
                No podcasts found for <span className="font-semibold">“{q}”</span>.
              </p>
              <p className="mt-1 text-metadata text-secondary">Try a different name, or paste an RSS feed or YouTube channel URL.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-gutter md:grid-cols-2">
              {results.map((r) => {
                const trackedNow = isTracked(r)
                return (
                  <PodcastCard
                    key={r.id}
                    podcast={{ ...toPodcast(r), tracked: trackedNow }}
                    onToggle={() => {
                      if (!trackedNow) onAdd(r)
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

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
                    <button onClick={() => toggleTracked(p.id)} className="press text-outline hover:text-error" aria-label={`Remove ${p.title}`}>
                      <Icon name="close" size={15} />
                    </button>
                  </span>
                ))}
                {tracked.length > 4 && <span className="self-center text-[13px] text-secondary">+{tracked.length - 4} more</span>}
              </div>
              <button
                onClick={() => navigate('/')}
                className="press inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-lg py-2.5 text-metadata font-semibold text-on-primary hover:bg-primary-container"
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
      className={`lift flex items-center gap-md rounded-xl border bg-surface-container-lowest p-md hover:shadow-card ${
        tracked ? 'border-primary ring-1 ring-primary/15' : 'border-outline-variant'
      }`}
    >
      <CoverTile podcast={podcast} className="h-16 w-16 shrink-0" rounded="rounded-xl" showSource />
      <div className="min-w-0 flex-1">
        <h4 className="text-[16px] font-semibold text-on-surface">{podcast.title}</h4>
        <p className="text-[12px] text-secondary">{podcast.category}</p>
        <p className="mt-0.5 line-clamp-1 text-metadata text-on-surface-variant">{podcast.description || podcast.author}</p>
      </div>
      <button
        onClick={onToggle}
        className={`press grid h-9 w-9 shrink-0 place-items-center rounded-full ${
          tracked ? 'bg-primary text-on-primary' : 'border border-outline-variant text-primary hover:bg-surface-container-low'
        }`}
        aria-label={tracked ? `${podcast.title} is tracked` : `Add ${podcast.title}`}
      >
        <Icon name={tracked ? 'check' : 'add'} size={20} />
      </button>
    </div>
  )
}
