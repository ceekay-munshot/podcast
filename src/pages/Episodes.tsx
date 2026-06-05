import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { formatDuration, longDate } from '../lib/format'
import type { Episode, ProcessingStatus } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

type Filter = 'all' | 'ready' | 'processing' | 'failed'

const PROCESSING: ProcessingStatus[] = ['detected', 'fetching', 'transcribing', 'summarizing']

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'processing', label: 'In progress' },
  { id: 'failed', label: 'Needs attention' },
]

export default function Episodes() {
  const { episodes, podcasts, podcastById } = useAppData()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const trackedCount = podcasts.filter((p) => p.tracked).length

  const counts = useMemo(
    () => ({
      all: episodes.length,
      ready: episodes.filter((e) => e.status === 'ready').length,
      processing: episodes.filter((e) => PROCESSING.includes(e.status)).length,
      failed: episodes.filter((e) => e.status === 'failed').length,
    }),
    [episodes],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return episodes
      .filter((e) => {
        if (filter === 'ready') return e.status === 'ready'
        if (filter === 'processing') return PROCESSING.includes(e.status)
        if (filter === 'failed') return e.status === 'failed'
        return true
      })
      .filter((e) => {
        if (!needle) return true
        const podcast = podcastById(e.podcastId)
        return e.title.toLowerCase().includes(needle) || podcast?.title.toLowerCase().includes(needle)
      })
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
  }, [episodes, filter, q, podcastById])

  return (
    <div className="animate-fade-up">
      <header className="mb-lg flex flex-wrap items-end justify-between gap-md">
        <div>
          <h2 className="text-display-lg text-on-background">Episodes</h2>
          <p className="mt-1 text-body-md text-secondary">
            Your intelligence feed across {trackedCount} active subscriptions.
          </p>
        </div>
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter episodes…"
            className="w-64 rounded-full border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-sm text-metadata outline-none focus:border-primary"
          />
        </div>
      </header>

      {/* Filter chips */}
      <div className="mb-md flex flex-wrap gap-xs">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-md py-1.5 text-metadata font-medium transition-colors ${
              filter === f.id
                ? 'bg-primary text-on-primary'
                : 'border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {f.label}
            <span className={filter === f.id ? 'text-white/70' : 'text-secondary'}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest">
        <div className="grid grid-cols-[1.4fr_2.6fr_1.4fr_0.9fr_0.7fr_40px] items-center gap-md border-b border-outline-variant bg-surface-container-low/50 px-lg py-3 text-label-caps uppercase text-outline">
          <span>Podcast</span>
          <span>Episode</span>
          <span>Status</span>
          <span>Date</span>
          <span>Length</span>
          <span />
        </div>

        {rows.map((ep) => (
          <EpisodeRow key={ep.id} episode={ep} onOpen={() => navigate(`/episodes/${ep.id}`)} />
        ))}

        {rows.length === 0 && (
          <div className="px-lg py-xl text-center text-body-md text-secondary">No episodes match this filter.</div>
        )}
      </div>

      {/* Add source footer */}
      <div className="mt-xl flex flex-col items-center justify-center gap-sm rounded-2xl border border-dashed border-outline-variant bg-surface-container-low py-xl text-center">
        <Icon name="rss_feed" size={32} className="text-outline" />
        <h3 className="text-display-sm text-on-surface-variant">Looking for more?</h3>
        <p className="max-w-md text-body-md text-secondary">
          Add an RSS feed or YouTube channel and SignalCast will detect and summarize every new episode automatically.
        </p>
        <Link
          to="/discover"
          className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-lg py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container"
        >
          <Icon name="add" size={18} /> Add new source
        </Link>
      </div>
    </div>
  )
}

function EpisodeRow({ episode, onOpen }: { episode: Episode; onOpen: () => void }) {
  const { podcastById } = useAppData()
  const podcast = podcastById(episode.podcastId)
  return (
    <button
      onClick={onOpen}
      className="group grid w-full grid-cols-[1.4fr_2.6fr_1.4fr_0.9fr_0.7fr_40px] items-center gap-md border-b border-outline-variant px-lg py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface-container-low/60"
    >
      <div className="flex min-w-0 items-center gap-sm">
        {podcast && <CoverTile podcast={podcast} className="h-10 w-10 shrink-0" />}
        <span className="truncate font-semibold text-on-surface">{podcast?.title}</span>
      </div>
      <span className="truncate pr-md text-body-md text-on-surface">{episode.title}</span>
      <span>
        <StatusBadge status={episode.status} />
      </span>
      <span className="text-metadata text-on-surface-variant">{longDate(episode.publishedAt)}</span>
      <span className="text-metadata text-on-surface-variant">{formatDuration(episode.durationSec)}</span>
      <span className="flex justify-end text-primary opacity-0 transition-opacity group-hover:opacity-100">
        <Icon name="arrow_forward_ios" size={16} />
      </span>
    </button>
  )
}
