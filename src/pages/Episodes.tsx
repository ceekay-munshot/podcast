import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { formatDuration, longDate, NOW } from '../lib/format'
import type { Episode } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

type Filter = 'all' | 'today' | 'week' | 'month'

const FILTERS: { id: Filter; label: string; days: number | null }[] = [
  { id: 'all', label: 'All', days: null },
  { id: 'today', label: 'Today', days: 0 },
  { id: 'week', label: 'This Week', days: 7 },
  { id: 'month', label: 'This Month', days: 31 },
]

export default function Episodes() {
  const { episodes, podcastById } = useAppData()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const def = FILTERS.find((f) => f.id === filter)!
    return episodes
      .filter((e) => {
        if (def.days === null) return true
        const ageDays = Math.floor((startOfDay(NOW) - startOfDay(+new Date(e.publishedAt))) / 86_400_000)
        return def.days === 0 ? ageDays <= 0 : ageDays < def.days
      })
      .filter((e) => {
        if (!needle) return true
        return e.title.toLowerCase().includes(needle) || podcastById(e.podcastId)?.title.toLowerCase().includes(needle)
      })
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
  }, [episodes, filter, q, podcastById])

  return (
    <div className="animate-fade-up">
      <div className="mb-md flex flex-wrap items-center justify-between gap-md">
        <h2 className="text-display-lg text-on-background">Episodes</h2>
        <Link
          to="/discover"
          className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-md py-2 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <Icon name="add" size={18} /> Add source
        </Link>
      </div>

      <div className="relative mb-md max-w-md">
        <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-outline" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search episodes…"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-11 pr-sm text-[14px] outline-none focus:border-primary"
        />
      </div>

      <div className="mb-md flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors ${
              filter === f.id
                ? 'bg-primary-fixed/60 text-primary ring-1 ring-primary/20'
                : 'border border-outline-variant bg-surface text-secondary hover:bg-surface-container-low'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-card">
        <div className="grid grid-cols-[2.6fr_1.6fr_1fr_0.8fr_1fr] items-center gap-md border-b border-outline-variant px-md py-3 text-label-caps uppercase text-outline">
          <span>Episode</span>
          <span>Podcast</span>
          <span className="flex items-center gap-1">Date <Icon name="arrow_downward" size={13} /></span>
          <span>Duration</span>
          <span>Status</span>
        </div>

        {rows.map((ep) => (
          <EpisodeRow key={ep.id} episode={ep} onOpen={() => navigate(`/episodes/${ep.id}`)} />
        ))}

        {rows.length === 0 && <div className="px-md py-xl text-center text-body-md text-secondary">No episodes match this filter.</div>}
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
      className="group grid w-full grid-cols-[2.6fr_1.6fr_1fr_0.8fr_1fr] items-center gap-md border-b border-outline-variant px-md py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface-container-low/60"
    >
      <div className="flex min-w-0 items-center gap-3">
        {podcast && <CoverTile podcast={podcast} className="h-11 w-11 shrink-0" />}
        <span className="truncate text-body-md font-medium text-on-surface group-hover:text-primary">{episode.title}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {podcast && <CoverTile podcast={podcast} className="h-6 w-6 shrink-0" rounded="rounded" />}
        <span className="truncate text-metadata text-on-surface-variant">{podcast?.title}</span>
      </div>
      <span className="text-metadata text-on-surface-variant">{longDate(episode.publishedAt)}</span>
      <span className="text-metadata text-on-surface-variant">{formatDuration(episode.durationSec)}</span>
      <span>
        <StatusBadge status={episode.status} />
      </span>
    </button>
  )
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
