import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { useSentiment } from '../store/Sentiment'
import { downloadWeekly } from '../lib/exportWeekly'
import { generateWeekly } from '../lib/weeklyApi'
import { weeklyTone } from '../lib/tone'
import type { WeeklySummary } from '../lib/types'
import { Icon } from '../components/Icon'
import { RichText, entityTerms } from '../components/RichText'
import { ToneMeter } from '../components/ToneMeter'

const THEME_STYLES = [
  { tile: 'bg-[#eff5ff] text-[#2563eb] border-[#dbeafe]', icon: 'cloud' },
  { tile: 'bg-[#ecfdf3] text-[#15803d] border-[#d1fadf]', icon: 'pie_chart' },
  { tile: 'bg-[#f5f3ff] text-[#7c3aed] border-[#e9e2ff]', icon: 'shield' },
  { tile: 'bg-[#fff4ec] text-[#c2410c] border-[#ffe5d3]', icon: 'memory' },
  { tile: 'bg-[#fefce8] text-[#a16207] border-[#fdf0bf]', icon: 'bolt' },
]

export default function Weekly() {
  const { episodes, podcasts, episodeById, podcastById, loading } = useAppData()
  const { on: sentimentOn } = useSentiment()
  const [weekly, setWeekly] = useState<WeeklySummary | null | undefined>(undefined) // undefined = generating

  const ready = useMemo(() => episodes.filter((e) => e.status === 'ready' && e.summary), [episodes])
  const readyKey = useMemo(() => ready.map((e) => e.id).sort().join(','), [ready])

  useEffect(() => {
    let alive = true
    setWeekly(undefined)
    generateWeekly(episodes, podcastById)
      .then((w) => alive && setWeekly(w))
      .catch(() => alive && setWeekly(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey])

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-lg flex flex-wrap items-start justify-between gap-md">
        <div>
          <h1 className="text-display-lg tracking-tight text-on-surface">Weekly Summary</h1>
          <p className="mt-1 text-body-md text-secondary">
            {loading || weekly === undefined
              ? 'Synthesising across your analysed episodes…'
              : weekly
                ? weekly.rangeLabel
                : 'No episodes analysed yet'}
          </p>
          {weekly && sentimentOn && (
            <div className="mt-2 flex items-center gap-2 text-metadata text-secondary">
              <span className="font-medium">This week's tone</span>
              <ToneMeter tone={weeklyTone(weekly)} />
            </div>
          )}
        </div>
        {weekly && (
          <button
            onClick={() => downloadWeekly(weekly, episodeById, podcastById)}
            title="Download a formatted Word document (.doc)"
            className="press inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary hover:bg-primary-container"
          >
            <Icon name="download" size={18} /> Download
          </button>
        )}
      </div>

      {loading || weekly === undefined ? (
        <GeneratingState count={ready.length} />
      ) : weekly === null ? (
        <EmptyState />
      ) : (
        <WeeklyDoc
          weekly={weekly}
          ready={ready}
          trackedCount={podcasts.filter((p) => p.tracked).length}
          episodeById={episodeById}
          podcastById={podcastById}
        />
      )}
    </div>
  )
}

// ── The rendered document ────────────────────────────────────────────────────
function WeeklyDoc({
  weekly,
  ready,
  trackedCount,
  episodeById,
  podcastById,
}: {
  weekly: WeeklySummary
  ready: ReturnType<typeof useAppData>['episodes']
  trackedCount: number
  episodeById: ReturnType<typeof useAppData>['episodeById']
  podcastById: ReturnType<typeof useAppData>['podcastById']
}) {
  const [active, setActive] = useState('overview')
  const terms = entityTerms(weekly.mentions)
  const interestingEpisode = episodeById(weekly.interesting.episodeId)
  const hasMentions = weekly.mentions.people.length > 0 || weekly.mentions.companies.length > 0

  const stats = [
    { icon: 'play_circle', label: 'Episodes Processed', value: weekly.episodeCount, style: THEME_STYLES[0] },
    { icon: 'format_list_bulleted', label: 'Key Takeaways', value: ready.reduce((n, e) => n + (e.summary?.takeaways.length ?? 0), 0), style: THEME_STYLES[1] },
    { icon: 'lightbulb', label: 'Interesting Moments', value: ready.reduce((n, e) => n + (e.summary?.moments.length ?? 0), 0), style: THEME_STYLES[2] },
    { icon: 'podcasts', label: 'Podcasts', value: trackedCount, style: THEME_STYLES[3] },
  ]

  // Only nav to sections that actually have content (zero empty/fake sections).
  const nav = [
    { id: 'overview', label: 'Overview', icon: 'play_circle', show: weekly.overview.length > 0 },
    { id: 'themes', label: 'Top Themes', icon: 'sell', show: weekly.topThemes.length > 0 },
    { id: 'takeaways', label: 'Key Takeaways', icon: 'format_list_bulleted', show: weekly.takeaways.length > 0 },
    { id: 'interesting', label: 'Interesting Ideas', icon: 'lightbulb', show: !!weekly.interesting.quote },
    { id: 'mentions', label: 'Mentions', icon: 'alternate_email', show: hasMentions },
    { id: 'questions', label: 'Questions', icon: 'help', show: weekly.questions.length > 0 },
  ].filter((n) => n.show)

  function go(id: string) {
    setActive(id)
    document.getElementById(`wk-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="grid grid-cols-12 gap-gutter">
      {/* In-page sub-nav */}
      <nav className="col-span-12 md:col-span-3">
        <ul className="sticky top-20 flex flex-col gap-0.5">
          {nav.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => go(n.id)}
                className={`press-soft flex w-full items-center gap-2.5 rounded-lg border-l-2 px-3 py-2 text-left text-[14px] ${
                  active === n.id
                    ? 'border-primary bg-primary-fixed/50 font-semibold text-primary'
                    : 'border-transparent text-secondary hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <Icon name={n.icon} size={18} /> {n.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <div className="col-span-12 md:col-span-9">
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-card">
          {/* Overview */}
          {weekly.overview.length > 0 && (
            <section id="wk-overview" className="scroll-mt-20">
              <h2 className="mb-md text-[22px] font-bold tracking-tight text-on-surface">This Week in Summary</h2>
              <div className="space-y-md text-body-md leading-relaxed text-on-surface-variant">
                {weekly.overview.map((p, i) => (
                  <p key={i}>
                    <RichText text={p} terms={terms} />
                  </p>
                ))}
              </div>
            </section>
          )}

          {/* Themes */}
          {weekly.topThemes.length > 0 && (
            <Block id="wk-themes" first={weekly.overview.length === 0} title="Top Themes">
              <div className="flex flex-wrap gap-2.5">
                {weekly.topThemes.map((t, i) => {
                  const s = THEME_STYLES[i % THEME_STYLES.length]
                  return (
                    <Link
                      key={t.label}
                      to={`/search?q=${encodeURIComponent(t.label)}`}
                      className={`press inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px] font-medium ${s.tile}`}
                    >
                      <Icon name={s.icon} size={16} /> {t.label}
                    </Link>
                  )
                })}
              </div>
            </Block>
          )}

          {/* Key takeaways + stat tiles */}
          {weekly.takeaways.length > 0 && (
            <Block id="wk-takeaways" title="Key Takeaways Across All Podcasts">
              <ul className="space-y-2.5">
                {weekly.takeaways.map((t, i) => (
                  <li key={i} className="flex gap-2.5 text-body-md text-on-surface-variant">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>
                      <span className="font-semibold text-on-surface">{t.title}.</span>{' '}
                      <RichText text={t.detail} terms={terms} />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-lg grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
                    <span className={`mb-2 grid h-9 w-9 place-items-center rounded-lg border ${s.style.tile}`}>
                      <Icon name={s.icon} size={18} />
                    </span>
                    <p className="text-[24px] font-bold leading-none text-on-surface">{s.value}</p>
                    <p className="mt-1 text-[12px] text-secondary">{s.label}</p>
                  </div>
                ))}
              </div>
            </Block>
          )}

          {/* Interesting */}
          {weekly.interesting.quote && (
            <Block id="wk-interesting" title="What Was Actually Interesting">
              <div className="relative overflow-hidden rounded-xl p-md text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
                <Icon name="lightbulb" className="absolute -right-5 -top-5 text-[130px] text-white/10" />
                <p className="relative text-body-lg italic text-white/95">“{weekly.interesting.quote}”</p>
                <div className="relative mt-md flex items-center justify-between">
                  <div>
                    <p className="text-metadata font-bold">{weekly.interesting.speaker}</p>
                    <p className="text-metadata text-white/70">{weekly.interesting.role}</p>
                  </div>
                  {interestingEpisode && (
                    <Link
                      to={`/episodes/${interestingEpisode.id}`}
                      className="press inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-metadata font-semibold backdrop-blur hover:bg-white/25"
                    >
                      <Icon name="open_in_new" size={16} /> Double-click this
                    </Link>
                  )}
                </div>
              </div>
            </Block>
          )}

          {/* Mentions */}
          {hasMentions && (
            <Block id="wk-mentions" title="Mentions">
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                {weekly.mentions.people.length > 0 && <MentionGroup title="People" icon="person" items={weekly.mentions.people} />}
                {weekly.mentions.companies.length > 0 && <MentionGroup title="Companies" icon="domain" items={weekly.mentions.companies} />}
              </div>
            </Block>
          )}

          {/* Questions */}
          {weekly.questions.length > 0 && (
            <Block id="wk-questions" title="Questions Worth Investigating">
              <ul className="space-y-2.5">
                {weekly.questions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2.5 rounded-xl border border-outline-variant bg-surface-container-low p-md">
                    <Icon name="help" size={20} className="shrink-0 text-primary" />
                    <p className="text-body-md text-on-surface-variant">
                      <RichText text={q} terms={terms} />
                    </p>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {/* Source citations */}
          <footer className="mt-lg border-t border-outline-variant pt-lg">
            <h3 className="mb-md text-[17px] font-semibold text-on-surface">Source Episodes</h3>
            <div className="space-y-1">
              {weekly.sourceEpisodeIds.map(episodeById).map((ep) => {
                if (!ep) return null
                const podcast = podcastById(ep.podcastId)
                return (
                  <Link
                    key={ep.id}
                    to={`/episodes/${ep.id}`}
                    className="group flex items-center justify-between gap-md rounded-lg p-2 transition-colors hover:bg-surface-container-low"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon name="play_circle" className="shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-body-md font-medium text-on-surface">{ep.title}</p>
                        <p className="truncate text-metadata text-secondary">{podcast?.title}</p>
                      </div>
                    </div>
                    <Icon name="arrow_forward" size={18} className="shrink-0 text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                )
              })}
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

function Block({ id, title, first, children }: { id: string; title: string; first?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-20 ${first ? '' : 'mt-lg border-t border-outline-variant pt-lg'}`}>
      <h3 className="mb-md text-[17px] font-semibold text-on-surface">{title}</h3>
      {children}
    </section>
  )
}

function GeneratingState({ count }: { count: number }) {
  return (
    <div className="grid place-items-center gap-sm rounded-2xl border border-outline-variant bg-surface-container-lowest py-[14vh] text-center shadow-card">
      <Icon name="auto_awesome" size={30} className="text-primary motion-safe:animate-pulse" fill />
      <p className="text-body-md font-semibold text-on-surface">Synthesising your weekly summary…</p>
      <p className="max-w-sm text-metadata text-secondary">
        Reading across {count} analysed episode{count === 1 ? '' : 's'} to find the through-line, themes, and what actually mattered.
      </p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="grid place-items-center gap-sm rounded-2xl border border-dashed border-outline-variant bg-surface-container-low py-[14vh] text-center">
      <Icon name="summarize" size={32} className="text-outline" />
      <h3 className="text-display-sm text-on-surface-variant">No weekly summary yet</h3>
      <p className="max-w-md text-body-md text-secondary">
        Your weekly master summary is built from analysed episodes. Once a few episodes are summarised, the cross-episode
        synthesis appears here — drawn entirely from real content.
      </p>
      <Link to="/episodes" className="press mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-lg py-2.5 text-metadata font-semibold text-on-primary hover:bg-primary-container">
        <Icon name="play_circle" size={18} /> Go to Episodes
      </Link>
    </div>
  )
}

function MentionGroup({ title, icon, items }: { title: string; icon: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
      <p className="mb-sm flex items-center gap-1.5 text-metadata font-semibold text-on-surface">
        <Icon name={icon} size={16} className="text-primary" /> {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <Link
            key={it}
            to={`/search?q=${encodeURIComponent(it)}`}
            className="press rounded-full border border-outline-variant bg-surface px-2.5 py-1 text-[12px] text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {it}
          </Link>
        ))}
      </div>
    </div>
  )
}
