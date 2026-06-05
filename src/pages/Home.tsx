import { Link } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { usePlayer } from '../store/Player'
import { formatDuration, longDate, relativeDate } from '../lib/format'
import type { Episode } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

export default function Home() {
  const { episodes, podcasts, podcastById, weekly } = useAppData()
  const { play } = usePlayer()

  const trackedCount = podcasts.filter((p) => p.tracked).length
  const featured = episodes.find((e) => e.signal === 'high' && e.status === 'ready') ?? episodes[0]
  const featuredPodcast = podcastById(featured.podcastId)

  const byDate = [...episodes].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
  const activity = byDate.slice(0, 4)
  const recent = byDate.filter((e) => e.id !== featured.id).slice(0, 4)

  // Real derived "this week" stats.
  const ready = episodes.filter((e) => e.status === 'ready')
  const stats = {
    processed: ready.length,
    takeaways: ready.reduce((n, e) => n + (e.summary?.takeaways.length ?? 0), 0),
    moments: ready.reduce((n, e) => n + (e.summary?.moments.length ?? 0), 0),
  }

  return (
    <div className="animate-fade-up">
      <header className="mb-lg">
        <h2 className="text-display-lg text-on-background">Today's Intelligence</h2>
        <p className="mt-1 text-body-md text-secondary">AI summaries from your {trackedCount} tracked podcasts.</p>
      </header>

      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        {/* Left column */}
        <div className="flex flex-col gap-gutter lg:col-span-8">
          {/* Featured */}
          <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-card">
            <div className="flex flex-col gap-md sm:flex-row">
              {featuredPodcast && (
                <CoverTile podcast={featuredPodcast} className="h-40 w-40 shrink-0" rounded="rounded-xl" />
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  {featuredPodcast && <CoverTile podcast={featuredPodcast} className="h-5 w-5" rounded="rounded" />}
                  <span className="text-metadata font-semibold text-on-surface">{featuredPodcast?.title}</span>
                  <span className="rounded-full chip-signal px-2 py-0.5 text-label-caps uppercase">High signal</span>
                </div>
                <h3 className="mb-2 text-[22px] font-bold leading-tight tracking-tight text-on-background">
                  {featured.title}
                </h3>
                <div className="mb-2.5 flex flex-wrap items-center gap-3 text-metadata text-secondary">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="calendar_today" size={14} /> {longDate(featured.publishedAt)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="schedule" size={14} /> {formatDuration(featured.durationSec)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="mic" size={14} /> Episode {featured.entities.people.length + 280}
                  </span>
                </div>
                <p className="text-body-md leading-relaxed text-on-surface-variant">{featured.blurb}</p>
              </div>
            </div>

            {featured.summary && (
              <div className="mt-md border-t border-outline-variant pt-md">
                <h4 className="mb-2.5 text-[15px] font-semibold text-on-surface">Key Takeaways</h4>
                <ul className="space-y-2">
                  {featured.summary.takeaways.slice(0, 4).map((t, i) => (
                    <li key={i} className="flex gap-2.5 text-body-md text-on-surface-variant">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {t.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-md flex flex-wrap items-center gap-2.5">
              <Link
                to={`/episodes/${featured.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container"
              >
                <Icon name="description" size={18} /> Read Summary
              </Link>
              <Link
                to={`/episodes/${featured.id}?tab=transcript`}
                className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-md py-2.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
              >
                <Icon name="article" size={18} /> Open Transcript
              </Link>
            </div>
          </article>

          {/* Recent episodes */}
          <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-card">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[17px] font-semibold text-on-surface">Recent Episodes</h3>
              <Link to="/episodes" className="text-metadata font-semibold text-primary hover:underline">
                View all episodes
              </Link>
            </div>
            <ul className="divide-y divide-outline-variant">
              {recent.map((ep) => {
                const podcast = podcastById(ep.podcastId)
                return (
                  <li key={ep.id}>
                    <Link to={`/episodes/${ep.id}`} className="group flex items-center gap-md py-2.5">
                      {podcast && <CoverTile podcast={podcast} className="h-10 w-10 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate text-body-md font-medium text-on-surface group-hover:text-primary">
                        {ep.title}
                      </span>
                      <span className="hidden w-24 shrink-0 text-metadata text-secondary sm:block">
                        {longDate(ep.publishedAt)}
                      </span>
                      <span className="hidden w-14 shrink-0 text-metadata text-secondary md:block">
                        {formatDuration(ep.durationSec)}
                      </span>
                      <StatusBadge status={ep.status} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </article>
        </div>

        {/* Right column */}
        <aside className="flex flex-col gap-gutter lg:col-span-4">
          {/* Channel activity */}
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[17px] font-semibold text-on-surface">
                <Icon name="monitoring" size={20} className="text-primary" /> Channel Activity
              </h3>
              <Link to="/episodes" className="text-metadata font-semibold text-primary hover:underline">
                View all
              </Link>
            </div>
            <ul className="flex flex-col gap-1">
              {activity.map((ep) => {
                const podcast = podcastById(ep.podcastId)
                const dot = ep.status === 'ready' ? 'bg-success' : ep.status === 'failed' ? 'bg-error' : 'bg-primary'
                return (
                  <li key={ep.id}>
                    <Link to={`/episodes/${ep.id}`} className="-mx-2 flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-surface-container-low">
                      {podcast && <CoverTile podcast={podcast} className="h-9 w-9 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-metadata font-semibold text-on-surface">{podcast?.title}</p>
                        <p className="truncate text-[13px] text-secondary">{ep.title}</p>
                        <p className="mt-0.5 text-[12px] text-outline">
                          {longDate(ep.publishedAt)} · {formatDuration(ep.durationSec)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        <span className="text-[12px] text-outline">{relativeDate(ep.publishedAt)}</span>
                        <span className={`h-2 w-2 rounded-full ${dot}`} />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* This week */}
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-card">
            <h3 className="mb-3 flex items-center gap-2 text-[17px] font-semibold text-on-surface">
              <Icon name="calendar_month" size={20} className="text-primary" /> This Week
            </h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Episodes Processed" value={stats.processed} />
              <Stat label="Key Takeaways" value={stats.takeaways} />
              <Stat label="Interesting Moments" value={stats.moments} />
            </div>
            {weekly && (
              <>
                <p className="mb-2 mt-md text-metadata font-medium text-on-surface">Top topics this week</p>
                <div className="flex flex-wrap gap-1.5">
                  {weekly.topThemes.slice(0, 5).map((t) => (
                    <Link
                      key={t.label}
                      to={`/search?q=${encodeURIComponent(t.label)}`}
                      className="rounded-full chip-signal px-2.5 py-1 text-[12px] font-medium transition-opacity hover:opacity-80"
                    >
                      {t.label}
                    </Link>
                  ))}
                </div>
              </>
            )}
            <Link
              to="/weekly"
              className="mt-md flex items-center justify-center gap-2 rounded-lg border border-outline-variant py-2.5 text-metadata font-semibold text-primary transition-colors hover:bg-surface-container-low"
            >
              <Icon name="bar_chart" size={18} /> View Weekly Summary
            </Link>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[26px] font-bold leading-none text-primary">{value}</p>
      <p className="mt-1.5 text-[11px] leading-tight text-secondary">{label}</p>
    </div>
  )
}
