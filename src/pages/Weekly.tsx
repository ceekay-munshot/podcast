import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { useSentiment } from '../store/Sentiment'
import { downloadWeekly } from '../lib/exportWeekly'
import { generateWeekly } from '../lib/weeklyApi'
import { listEditions } from '../lib/weeklyEditions'
import { weeklyToneView } from '../lib/tone'
import type { WeeklyIdea, WeeklyShowDigest, WeeklySummary } from '../lib/types'
import { Icon } from '../components/Icon'
import { EditionSwitcher } from '../components/EditionSwitcher'
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
  const [params, setParams] = useSearchParams()
  const [weekly, setWeekly] = useState<WeeklySummary | null | undefined>(undefined) // undefined = generating

  // The history: ready episodes sliced into per-week editions (newest first).
  const editions = useMemo(() => listEditions(episodes, podcastById), [episodes, podcastById])

  // Selected edition: ?week=<key> | 'all', defaulting to the latest week.
  const requested = params.get('week')
  const currentKey =
    requested === 'all' || (requested && editions.some((e) => e.weekKey === requested))
      ? requested
      : editions[0]?.weekKey ?? 'all'
  const selected = currentKey === 'all' ? null : editions.find((e) => e.weekKey === currentKey)

  // The episodes feeding the selected edition (a single week, or everything).
  const editionEpisodes = useMemo(() => {
    const isReady = (e: (typeof episodes)[number]) => e.status === 'ready' && e.summary
    if (currentKey === 'all') return episodes.filter(isReady)
    const ids = new Set(selected?.episodeIds ?? [])
    return episodes.filter((e) => ids.has(e.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, currentKey, selected?.weekKey])

  const genKey = useMemo(
    () => `${currentKey}|${editionEpisodes.map((e) => e.id).sort().join(',')}`,
    [currentKey, editionEpisodes],
  )
  // Latest genKey, so an in-flight refresh never applies its result to an edition
  // the user has since switched away from.
  const genKeyRef = useRef(genKey)
  genKeyRef.current = genKey
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let alive = true
    setWeekly(undefined)
    if (!editionEpisodes.length) {
      setWeekly(null)
      return
    }
    generateWeekly(editionEpisodes, podcastById, { scope: currentKey, rangeLabel: selected?.rangeLabel })
      .then((w) => alive && setWeekly(w))
      .catch(() => alive && setWeekly(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genKey])

  // Force-regenerate the current edition, bypassing the memory + localStorage cache
  // (and overwriting it). The escape hatch for "I shipped a new format — show me the
  // latest, not the cached version."
  async function refresh() {
    if (!editionEpisodes.length || refreshing) return
    const token = genKey
    setRefreshing(true)
    setWeekly(undefined)
    try {
      const w = await generateWeekly(editionEpisodes, podcastById, {
        scope: currentKey,
        rangeLabel: selected?.rangeLabel,
        force: true,
      })
      if (genKeyRef.current === token) setWeekly(w)
    } catch {
      if (genKeyRef.current === token) setWeekly(null)
    } finally {
      setRefreshing(false)
    }
  }

  function selectEdition(key: string) {
    const next = new URLSearchParams(params)
    if (key === (editions[0]?.weekKey ?? 'all')) next.delete('week') // latest → clean URL
    else next.set('week', key)
    setParams(next)
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-lg flex flex-wrap items-start justify-between gap-md">
        <div>
          <h1 className="text-display-lg tracking-tight text-on-surface">Weekly Summary</h1>
          <p className="mt-1 text-body-md text-secondary">
            {loading || weekly === undefined
              ? 'Synthesising this edition…'
              : weekly
                ? `${weekly.episodeCount} episode${weekly.episodeCount === 1 ? '' : 's'} · ${weekly.readMinutes} min read`
                : 'No episodes analysed yet'}
          </p>
          {weekly && sentimentOn && (
            <div className="mt-2 flex items-center gap-2 text-metadata text-secondary">
              <span className="font-medium">This edition's tone</span>
              <ToneMeter tone={weeklyToneView(weekly, episodeById)} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {editions.length > 0 && <EditionSwitcher editions={editions} currentKey={currentKey} onSelect={selectEdition} />}
          {editionEpisodes.length > 0 && (
            <button
              onClick={refresh}
              disabled={refreshing || weekly === undefined}
              title="Regenerate this edition from scratch (skips the cache) — use after shipping a new format"
              className="press inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-3 py-2.5 text-metadata font-semibold text-on-surface hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="refresh" size={18} className={refreshing ? 'motion-safe:animate-spin' : ''} />
              <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          )}
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
      </div>

      {loading || weekly === undefined ? (
        <GeneratingState count={editionEpisodes.length} />
      ) : weekly === null ? (
        <EmptyState />
      ) : (
        <WeeklyDoc
          weekly={weekly}
          ready={editionEpisodes}
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
  const shows = weekly.shows ?? [] // older cached digests predate the by-show shape
  const ideaCount = shows.reduce((n, s) => n + s.ideas.length, 0)

  const stats = [
    { icon: 'play_circle', label: 'Episodes Processed', value: weekly.episodeCount, style: THEME_STYLES[0] },
    { icon: 'trending_up', label: 'Ideas Pitched', value: ideaCount, style: THEME_STYLES[1] },
    { icon: 'help', label: 'Questions Answered', value: ready.reduce((n, e) => n + (e.summary?.qa.length ?? 0), 0), style: THEME_STYLES[2] },
    { icon: 'podcasts', label: 'Podcasts', value: trackedCount, style: THEME_STYLES[3] },
  ]

  // Only nav to sections that actually have content (zero empty/fake sections). The
  // per-show digests are the primary body, so each show gets its own jump target.
  const nav = [
    { id: 'overview', label: 'Overview', icon: 'play_circle', show: weekly.overview.length > 0 },
    ...shows.map((s) => ({ id: `show-${s.podcastId}`, label: s.show, icon: 'podcasts', show: true })),
    { id: 'themes', label: 'Top Themes', icon: 'sell', show: weekly.topThemes.length > 0 },
    { id: 'mentions', label: 'Mentions', icon: 'alternate_email', show: hasMentions },
    { id: 'interesting', label: 'Interesting', icon: 'lightbulb', show: !!weekly.interesting.quote },
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
          {/* Overview + at-a-glance stats */}
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
            </section>
          )}

          {/* By show — the primary body: each show's pitched ideas, takeaways, questions */}
          {shows.map((digest, i) => (
            <ShowDigest
              key={digest.podcastId}
              digest={digest}
              first={i === 0 && weekly.overview.length === 0}
              terms={terms}
              episodeById={episodeById}
            />
          ))}

          {/* Themes (cross-show) */}
          {weekly.topThemes.length > 0 && (
            <Block id="wk-themes" title="Top Themes">
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

          {/* Mentions (cross-show) */}
          {hasMentions && (
            <Block id="wk-mentions" title="Mentions">
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                {weekly.mentions.people.length > 0 && <MentionGroup title="People" icon="person" items={weekly.mentions.people} />}
                {weekly.mentions.companies.length > 0 && <MentionGroup title="Companies" icon="domain" items={weekly.mentions.companies} />}
              </div>
            </Block>
          )}

          {/* Interesting (cross-show) */}
          {weekly.interesting.quote && (
            <Block id="wk-interesting" title="What Was Actually Interesting">
              <div className="relative overflow-hidden rounded-xl p-md text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
                <Icon name="lightbulb" className="absolute -right-5 -top-5 text-[130px] text-white/10" />
                {weekly.interesting.title && (
                  <p className="relative text-[19px] font-semibold leading-snug text-white">{weekly.interesting.title}</p>
                )}
                <p className="relative mt-1.5 text-body-lg italic text-white/90">{weekly.interesting.quote}</p>
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

const KIND_LABEL: Record<NonNullable<WeeklyIdea['kind']>, string> = {
  stock: 'Stock',
  trade: 'Trade',
  macro: 'Macro',
  prediction: 'Prediction',
}

// One show's slice of the week: its pitched ideas first (the headline value), then
// its key takeaways and open questions. Subheads are hidden when a group is empty.
function ShowDigest({
  digest,
  first,
  terms,
  episodeById,
}: {
  digest: WeeklyShowDigest
  first?: boolean
  terms: string[]
  episodeById: ReturnType<typeof useAppData>['episodeById']
}) {
  return (
    <section
      id={`wk-show-${digest.podcastId}`}
      className={`scroll-mt-20 ${first ? '' : 'mt-lg border-t border-outline-variant pt-lg'}`}
    >
      <div className="mb-md flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-fixed/60 text-primary">
          <Icon name="podcasts" size={18} />
        </span>
        <h3 className="text-[18px] font-bold tracking-tight text-on-surface">{digest.show}</h3>
        <span className="text-metadata text-secondary">
          {digest.episodeCount} episode{digest.episodeCount === 1 ? '' : 's'}
        </span>
      </div>

      {digest.ideas.length > 0 && (
        <div className="mb-md">
          <p className="mb-sm flex items-center gap-1.5 text-metadata font-semibold uppercase tracking-wide text-secondary">
            <Icon name="trending_up" size={15} className="text-primary" /> Ideas Pitched
          </p>
          <ul className="space-y-2.5">
            {digest.ideas.map((idea, i) => (
              <IdeaCard key={i} idea={idea} terms={terms} episodeById={episodeById} />
            ))}
          </ul>
        </div>
      )}

      {digest.takeaways.length > 0 && (
        <div className="mb-md">
          <p className="mb-sm text-metadata font-semibold uppercase tracking-wide text-secondary">Key Takeaways</p>
          <ul className="space-y-2.5">
            {digest.takeaways.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-body-md text-on-surface-variant">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>
                  <span className="font-semibold text-on-surface">{t.title}.</span> <RichText text={t.detail} terms={terms} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {digest.questions.length > 0 && (
        <div>
          <p className="mb-sm text-metadata font-semibold uppercase tracking-wide text-secondary">Questions</p>
          <ul className="space-y-1.5">
            {digest.questions.map((q, i) => (
              <li key={i} className="flex items-start gap-2 text-body-md text-on-surface-variant">
                <Icon name="help" size={18} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  <RichText text={q} terms={terms} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// A single pitched idea: the call (with a category badge), who pitched it, the
// thesis bullets, and a jump to the episode it came from.
function IdeaCard({
  idea,
  terms,
  episodeById,
}: {
  idea: WeeklyIdea
  terms: string[]
  episodeById: ReturnType<typeof useAppData>['episodeById']
}) {
  const ep = episodeById(idea.episodeId)
  return (
    <li className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-body-md font-semibold text-on-surface">
          {idea.kind && (
            <span className="mr-2 inline-block rounded bg-primary-fixed/70 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-primary">
              {KIND_LABEL[idea.kind]}
            </span>
          )}
          <RichText text={idea.idea} terms={terms} />
        </p>
        {ep && (
          <Link
            to={`/episodes/${ep.id}`}
            title={ep.title}
            className="press shrink-0 text-secondary hover:text-primary"
          >
            <Icon name="open_in_new" size={16} />
          </Link>
        )}
      </div>
      {idea.proponent && idea.proponent !== '—' && (
        <p className="mt-1 text-metadata text-secondary">Pitched by {idea.proponent}</p>
      )}
      {idea.thesis.length > 0 && (
        <ul className="mt-2 space-y-1">
          {idea.thesis.map((t, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] leading-snug text-on-surface-variant">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-secondary" />
              <span>
                <RichText text={t} terms={terms} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
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
