import { Link } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { formatDuration } from '../lib/format'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { SectionLabel } from '../components/SectionLabel'
import { TakeawayList } from '../components/TakeawayList'

export default function Weekly() {
  const { weekly, episodeById, podcastById, settings } = useAppData()
  if (!weekly) return null

  const interestingEpisode = episodeById(weekly.interesting.episodeId)
  const sources = weekly.sourceEpisodeIds.map(episodeById).filter(Boolean)

  return (
    <div className="mx-auto max-w-reading animate-fade-up">
      {/* Breadcrumb */}
      <nav className="mb-sm flex items-center gap-xs text-metadata text-secondary">
        <span>Archive</span>
        <Icon name="chevron_right" size={14} />
        <span>2026</span>
        <Icon name="chevron_right" size={14} />
        <span className="text-primary">June</span>
      </nav>

      <h1 className="text-display-lg font-extrabold tracking-tight text-on-surface">
        Weekly Summary <span className="font-semibold text-secondary">·</span> {weekly.rangeLabel}
      </h1>
      <div className="mt-sm flex flex-wrap items-center gap-md border-b border-outline-variant pb-md text-metadata text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="schedule" size={15} /> {weekly.readMinutes} min read
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="mic" size={15} /> {weekly.episodeCount} episodes analyzed
        </span>
        {!settings.weeklySummary && (
          <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
            <Icon name="info" size={15} /> Weekly digest is paused in Settings
          </span>
        )}
      </div>

      {/* This week in summary */}
      <section className="mt-xl">
        <SectionLabel className="mb-md">This week in summary</SectionLabel>
        <div className="space-y-md rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg text-body-lg leading-relaxed text-on-surface">
          {weekly.overview.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </section>

      {/* Top themes */}
      <section className="mt-xl">
        <SectionLabel className="mb-md">Top themes</SectionLabel>
        <div className="flex flex-wrap gap-sm">
          {weekly.topThemes.map((t) => (
            <Link
              key={t.label}
              to={`/search?q=${encodeURIComponent(t.label)}`}
              className="group inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface px-md py-2 transition-colors hover:border-primary"
            >
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="text-metadata text-on-surface">{t.label}</span>
              <span className="text-[12px] font-semibold text-primary">+{t.momentum}%</span>
            </Link>
          ))}
        </div>
      </section>

      {/* What was actually interesting */}
      <section className="mt-xl">
        <div className="relative overflow-hidden rounded-2xl p-lg text-white" style={{ background: 'linear-gradient(135deg, #0058bc, #0070eb)' }}>
          <Icon name="lightbulb" className="absolute -right-6 -top-6 text-[150px] text-white/10" />
          <h3 className="relative mb-md text-display-sm font-bold">What was actually interesting this week?</h3>
          <p className="relative text-body-lg italic text-white/90">“{weekly.interesting.quote}”</p>
          <div className="relative mt-md flex items-center justify-between">
            <div>
              <p className="text-metadata font-bold">{weekly.interesting.speaker}</p>
              <p className="text-metadata text-white/70">{weekly.interesting.role}</p>
            </div>
            {interestingEpisode && (
              <Link
                to={`/episodes/${interestingEpisode.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-metadata font-semibold backdrop-blur transition-colors hover:bg-white/25"
              >
                <Icon name="open_in_new" size={16} /> Double-click this
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Key takeaways */}
      <section className="mt-xl">
        <SectionLabel className="mb-md">Most important takeaways</SectionLabel>
        <TakeawayList items={weekly.takeaways} numbered />
      </section>

      {/* Contradictions */}
      <section className="mt-xl">
        <SectionLabel className="mb-md">Contradictions & disagreements</SectionLabel>
        <div className="space-y-sm">
          {weekly.contradictions.map((c, i) => (
            <div key={i} className="flex gap-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
              <Icon name="swap_horiz" size={20} className="shrink-0 text-tertiary" />
              <p className="text-body-md text-on-surface-variant">{c}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Mentions */}
      <section className="mt-xl grid grid-cols-1 gap-gutter sm:grid-cols-2">
        <MentionCard title="People mentioned" icon="person" items={weekly.mentions.people} />
        <MentionCard title="Companies mentioned" icon="domain" items={weekly.mentions.companies} />
      </section>

      {/* Questions */}
      <section className="mt-xl">
        <SectionLabel className="mb-md">Questions worth investigating</SectionLabel>
        <ul className="space-y-sm">
          {weekly.questions.map((q, i) => (
            <li key={i} className="flex items-start gap-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
              <Icon name="help" size={20} className="shrink-0 text-primary" />
              <p className="text-body-md text-on-surface">{q}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Source episodes (citations) */}
      <footer className="mt-xl border-t border-outline-variant pt-lg">
        <SectionLabel className="mb-md">Source episodes</SectionLabel>
        <div className="space-y-1">
          {sources.map((ep) => {
            if (!ep) return null
            const podcast = podcastById(ep.podcastId)
            return (
              <Link
                key={ep.id}
                to={`/episodes/${ep.id}`}
                className="group flex items-center justify-between gap-md rounded-xl border border-transparent p-sm transition-colors hover:border-outline-variant hover:bg-surface-container-low"
              >
                <div className="flex min-w-0 items-center gap-md">
                  {podcast && <CoverTile podcast={podcast} className="h-9 w-9 shrink-0" />}
                  <div className="min-w-0">
                    <p className="truncate text-body-md font-semibold text-on-surface">{ep.title}</p>
                    <p className="truncate text-metadata text-secondary">
                      {podcast?.title} · {formatDuration(ep.durationSec)}
                    </p>
                  </div>
                </div>
                <Icon name="arrow_forward" size={18} className="shrink-0 text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            )
          })}
        </div>

        <div className="mt-lg flex items-center justify-between text-metadata text-secondary">
          <p>© 2026 SignalCast Intelligence</p>
          <button className="inline-flex items-center gap-1.5 transition-colors hover:text-primary">
            <Icon name="picture_as_pdf" size={16} /> Export PDF
          </button>
        </div>
      </footer>
    </div>
  )
}

function MentionCard({ title, icon, items }: { title: string; icon: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md">
      <p className="mb-sm flex items-center gap-1.5 text-metadata font-semibold text-on-surface">
        <Icon name={icon} size={16} className="text-primary" /> {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <Link
            key={it}
            to={`/search?q=${encodeURIComponent(it)}`}
            className="rounded-full border border-outline-variant bg-surface px-2.5 py-1 text-[12px] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            {it}
          </Link>
        ))}
      </div>
    </div>
  )
}
