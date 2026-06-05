import { Link } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { usePlayer } from '../store/Player'
import { formatDuration, longDate, relativeDate } from '../lib/format'
import type { Episode } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { TakeawayList } from '../components/TakeawayList'
import { SectionLabel } from '../components/SectionLabel'

const PROCESSING: Episode['status'][] = ['detected', 'fetching', 'transcribing', 'summarizing', 'failed']

export default function Home() {
  const { episodes, podcasts, podcastById, weekly } = useAppData()
  const { play } = usePlayer()

  const trackedCount = podcasts.filter((p) => p.tracked).length
  const featured = episodes.find((e) => e.signal === 'high' && e.status === 'ready') ?? episodes[0]
  const queue = episodes.filter((e) => PROCESSING.includes(e.status))
  const recent = episodes.filter((e) => e.status === 'ready' && e.id !== featured.id).slice(0, 3)
  const featuredPodcast = podcastById(featured.podcastId)
  const trend = weekly?.topThemes[0]

  return (
    <div className="animate-fade-up">
      <header className="mb-lg">
        <h2 className="text-display-lg text-on-background">Today's Intelligence</h2>
        <p className="mt-1 text-body-lg text-secondary">Analyzed insights from your {trackedCount} prioritized feeds.</p>
      </header>

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-12">
        {/* Featured high-signal episode */}
        <section className="md:col-span-8">
          <article className="group overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest transition-shadow hover:shadow-card">
            {featuredPodcast && (
              <div className="relative h-56 w-full">
                <CoverTile podcast={featuredPodcast} className="h-full w-full" rounded="rounded-none" />
                <span className="absolute left-md top-md inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-black/25 px-3 py-1.5 text-label-caps uppercase text-white backdrop-blur">
                  <Icon name="verified" size={14} fill /> High signal
                </span>
              </div>
            )}
            <div className="p-xl">
              <div className="mb-sm flex flex-wrap items-center gap-sm text-metadata text-secondary">
                <span className="font-semibold text-primary">{featuredPodcast?.title}</span>
                <span>·</span>
                <span>{longDate(featured.publishedAt)}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Icon name="schedule" size={16} /> {formatDuration(featured.durationSec)}
                </span>
              </div>

              <h3 className="mb-sm text-display-sm text-on-background">{featured.title}</h3>
              <p className="mb-lg text-body-md leading-relaxed text-on-surface-variant">{featured.blurb}</p>

              {featured.summary && (
                <div className="mb-xl">
                  <SectionLabel className="mb-sm">Key takeaways</SectionLabel>
                  <TakeawayList items={featured.summary.takeaways.slice(0, 2)} />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-md border-t border-outline-variant pt-md">
                <button
                  onClick={() => play(featured)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-lg py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container"
                >
                  <Icon name="play_arrow" size={18} fill /> Play episode
                </button>
                <Link
                  to={`/episodes/${featured.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-lg py-2.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container"
                >
                  <Icon name="auto_awesome" size={18} /> Read summary
                </Link>
              </div>
            </div>
          </article>
        </section>

        {/* Processing queue + trend */}
        <aside className="flex flex-col gap-gutter md:col-span-4">
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md">
            <div className="mb-md flex items-center justify-between">
              <h3 className="text-headline-mobile text-on-background">Processing queue</h3>
              <Link to="/episodes" className="text-metadata font-semibold text-primary hover:underline">
                View all
              </Link>
            </div>
            <ul className="flex flex-col">
              {queue.map((ep) => {
                const podcast = podcastById(ep.podcastId)
                return (
                  <li key={ep.id}>
                    <Link
                      to={`/episodes/${ep.id}`}
                      className="-mx-sm flex items-start gap-sm rounded-lg p-sm transition-colors hover:bg-surface-container-low"
                    >
                      {podcast && <CoverTile podcast={podcast} className="h-12 w-12 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-metadata font-semibold text-on-surface">{podcast?.title}</p>
                        <p className="mb-1.5 truncate text-[13px] text-on-surface-variant">{ep.title}</p>
                        <StatusBadge status={ep.status} />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>

          {trend && (
            <div
              className="rounded-2xl border border-outline-variant p-md"
              style={{ background: 'radial-gradient(120% 120% at 100% 0%, #f3f3f3, #ffffff 60%)' }}
            >
              <div className="mb-sm flex items-center gap-sm text-primary">
                <Icon name="trending_up" />
                <span className="text-label-caps uppercase tracking-widest">Signal trend</span>
              </div>
              <p className="text-body-md text-on-background">
                <span className="font-semibold">“{trend.label}”</span> mentions across your feed are up{' '}
                <span className="font-semibold text-primary">{trend.momentum}%</span> this week.
              </p>
              <Link to="/weekly" className="mt-md inline-flex items-center gap-1 text-metadata font-semibold text-primary hover:underline">
                Read the weekly summary <Icon name="arrow_forward" size={16} />
              </Link>
            </div>
          )}
        </aside>
      </div>

      {/* Recently analyzed */}
      {recent.length > 0 && (
        <section className="mt-xl">
          <div className="mb-md flex items-center justify-between">
            <h3 className="text-headline-mobile text-on-background">Recently analyzed</h3>
            <Link to="/episodes" className="text-metadata font-semibold text-primary hover:underline">
              All episodes
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-gutter sm:grid-cols-3">
            {recent.map((ep) => {
              const podcast = podcastById(ep.podcastId)
              return (
                <Link
                  key={ep.id}
                  to={`/episodes/${ep.id}`}
                  className="group flex flex-col rounded-2xl border border-outline-variant bg-surface-container-lowest p-md transition-shadow hover:shadow-card"
                >
                  <div className="mb-sm flex items-center gap-sm">
                    {podcast && <CoverTile podcast={podcast} className="h-9 w-9" />}
                    <span className="truncate text-metadata font-semibold text-on-surface">{podcast?.title}</span>
                  </div>
                  <p className="mb-sm flex-1 text-body-md font-semibold leading-snug text-on-background group-hover:text-primary">
                    {ep.title}
                  </p>
                  <div className="flex items-center justify-between text-[12px] text-secondary">
                    <span>{relativeDate(ep.publishedAt)}</span>
                    <StatusBadge status={ep.status} compact />
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
