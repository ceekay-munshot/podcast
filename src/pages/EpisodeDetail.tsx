import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { usePlayer } from '../store/Player'
import { formatDuration, longDate, statusMeta } from '../lib/format'
import type { Episode, InterestingMoment, ProcessingStatus, TranscriptSegment } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { TakeawayList } from '../components/TakeawayList'
import { SectionLabel } from '../components/SectionLabel'

type Tab = 'summary' | 'takeaways' | 'qa' | 'transcript'

export default function EpisodeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { episodeById, podcastById } = useAppData()
  const { play } = usePlayer()

  const [tab, setTab] = useState<Tab>('summary')
  const [jumpTo, setJumpTo] = useState<string | null>(null)

  const episode = id ? episodeById(id) : undefined
  const podcast = episode ? podcastById(episode.podcastId) : undefined

  // Jump from an "Open transcript" action: switch tab, then scroll + flash.
  useEffect(() => {
    if (tab !== 'transcript' || !jumpTo) return
    const el = document.getElementById(`seg-${jumpTo}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const mark = el.querySelector('.transcript-mark')
      mark?.classList.add('is-active')
      const t = setTimeout(() => mark?.classList.remove('is-active'), 1800)
      return () => clearTimeout(t)
    }
  }, [tab, jumpTo])

  if (!episode || !podcast) {
    return (
      <div className="grid place-items-center py-[20vh] text-center">
        <Icon name="error" size={36} className="mb-sm text-outline" />
        <p className="text-body-md text-secondary">That episode could not be found.</p>
        <Link to="/episodes" className="mt-sm text-metadata font-semibold text-primary hover:underline">
          Back to episodes
        </Link>
      </div>
    )
  }

  const hasTranscript = !!episode.transcript?.length
  const TABS: { id: Tab; label: string; show: boolean }[] = [
    { id: 'summary', label: 'Summary', show: true },
    { id: 'takeaways', label: 'Takeaways', show: !!episode.summary },
    { id: 'qa', label: 'Q&A', show: !!episode.summary?.qa.length },
    { id: 'transcript', label: 'Transcript', show: true },
  ]

  function openTranscript(segmentId?: string) {
    setTab('transcript')
    if (segmentId) setJumpTo(segmentId)
  }

  return (
    <div className="animate-fade-up">
      {/* Breadcrumb */}
      <button
        onClick={() => navigate(-1)}
        className="mb-md inline-flex items-center gap-1 text-metadata text-secondary transition-colors hover:text-primary"
      >
        <Icon name="arrow_back" size={16} /> Back
      </button>

      {/* Header */}
      <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start">
        <CoverTile podcast={podcast} className="h-28 w-28 shrink-0" rounded="rounded-xl" showSource />
        <div className="flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-sm">
            <Link
              to="/episodes"
              className="rounded-full chip-signal px-2.5 py-1 text-label-caps uppercase transition-opacity hover:opacity-80"
            >
              {podcast.title}
            </Link>
            <span className="text-metadata text-secondary">{longDate(episode.publishedAt)}</span>
            <span className="text-metadata text-secondary">·</span>
            <span className="inline-flex items-center gap-1 text-metadata text-secondary">
              <Icon name="schedule" size={15} /> {formatDuration(episode.durationSec)}
            </span>
            {episode.signal === 'high' && (
              <span className="inline-flex items-center gap-1 rounded-full chip-signal px-2.5 py-1 text-label-caps uppercase">
                <Icon name="verified" size={13} fill /> High signal
              </span>
            )}
          </div>
          <h1 className="mb-md text-display-lg tracking-tight text-on-surface">{episode.title}</h1>
          <div className="flex flex-wrap items-center gap-sm">
            <button
              onClick={() => play(episode)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container"
            >
              <Icon name="play_arrow" size={18} fill /> Play episode
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-md py-2.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container">
              <Icon name="bookmark_add" size={18} /> Save
            </button>
            <StatusBadge status={episode.status} />
          </div>
        </div>
      </div>

      {/* Not-ready → show the pipeline instead of tabs */}
      {episode.status !== 'ready' || !episode.summary ? (
        <ProcessingPanel episode={episode} />
      ) : (
        <>
          {/* Tabs */}
          <div className="mb-xl flex gap-lg border-b border-outline-variant">
            {TABS.filter((t) => t.show).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 pb-sm text-metadata uppercase tracking-wider transition-colors ${
                  tab === t.id
                    ? 'border-primary font-bold text-primary'
                    : 'border-transparent text-secondary hover:text-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'summary' && <SummaryTab episode={episode} onOpenTranscript={openTranscript} hasTranscript={hasTranscript} />}
          {tab === 'takeaways' && <TakeawaysTab episode={episode} />}
          {tab === 'qa' && <QATab episode={episode} />}
          {tab === 'transcript' && <TranscriptTab episode={episode} onPlay={() => play(episode)} />}
        </>
      )}
    </div>
  )
}

// ── Summary tab ──────────────────────────────────────────────────────────────
function SummaryTab({
  episode,
  hasTranscript,
  onOpenTranscript,
}: {
  episode: Episode
  hasTranscript: boolean
  onOpenTranscript: (segmentId?: string) => void
}) {
  const s = episode.summary!
  return (
    <div className="grid grid-cols-12 gap-gutter">
      <div className="col-span-12 flex flex-col gap-lg md:col-span-7">
        <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md">
          <div className="mb-sm flex items-center gap-2 text-primary">
            <Icon name="auto_awesome" />
            <h2 className="text-display-sm text-on-surface">Executive synthesis</h2>
          </div>
          <div className="space-y-sm text-body-md leading-relaxed text-on-surface-variant">
            {s.synthesis.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>

        {s.qa.length > 0 && (
          <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md">
            <h2 className="mb-md text-display-sm text-on-surface">Extracted Q&A</h2>
            <div className="space-y-md">
              {s.qa.slice(0, 2).map((item, i) => (
                <QABlock key={i} q={item.q} a={item.a} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="col-span-12 flex flex-col gap-lg md:col-span-5">
        <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md">
          <h2 className="mb-md text-display-sm text-on-surface">Key takeaways</h2>
          <TakeawayList items={s.takeaways} />
        </section>

        <section>
          <h2 className="mb-md text-display-sm text-on-surface">Interesting moments</h2>
          <div className="space-y-sm">
            {s.moments.map((m) => (
              <MomentCard key={m.id} moment={m} canOpen={hasTranscript} onOpen={() => onOpenTranscript(m.segmentId)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function MomentCard({
  moment,
  canOpen,
  onOpen,
}: {
  moment: InterestingMoment
  canOpen: boolean
  onOpen: () => void
}) {
  return (
    <div className="group rounded-2xl border border-outline-variant bg-surface-container-lowest p-sm transition-shadow hover:shadow-card">
      <div className="mb-2 flex items-start justify-between gap-sm">
        <h3 className="text-metadata font-bold text-on-surface">{moment.title}</h3>
        <span className="shrink-0 rounded bg-surface-container-high px-2 py-0.5 text-label-caps text-on-surface-variant">
          {moment.timestamp}
        </span>
      </div>
      <SectionLabel className="mb-1 text-primary">Why it matters</SectionLabel>
      <p className="mb-sm text-[14px] leading-relaxed text-on-surface-variant">{moment.whyItMatters}</p>
      {canOpen && (
        <button
          onClick={onOpen}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant py-1.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <Icon name="notes" size={16} /> Open transcript
        </button>
      )}
    </div>
  )
}

// ── Takeaways tab ────────────────────────────────────────────────────────────
function TakeawaysTab({ episode }: { episode: Episode }) {
  const s = episode.summary!
  return (
    <div className="grid grid-cols-12 gap-gutter">
      <section className="col-span-12 md:col-span-8">
        <TakeawayList items={s.takeaways} numbered />
      </section>
      <aside className="col-span-12 md:col-span-4">
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md">
          <SectionLabel className="mb-sm">Mentioned in this episode</SectionLabel>
          <EntityGroup label="People" icon="person" items={episode.entities.people} />
          <EntityGroup label="Companies" icon="domain" items={episode.entities.companies} />
          <EntityGroup label="Themes" icon="tag" items={episode.entities.themes} />
        </div>
      </aside>
    </div>
  )
}

function EntityGroup({ label, icon, items }: { label: string; icon: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mb-md last:mb-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-secondary">
        <Icon name={icon} size={14} /> {label}
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

// ── Q&A tab ──────────────────────────────────────────────────────────────────
function QATab({ episode }: { episode: Episode }) {
  const s = episode.summary!
  return (
    <section className="mx-auto max-w-reading">
      <div className="space-y-lg rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg">
        {s.qa.map((item, i) => (
          <QABlock key={i} q={item.q} a={item.a} />
        ))}
      </div>
    </section>
  )
}

function QABlock({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <h3 className="mb-xs flex items-start gap-2 text-body-md font-bold text-on-surface">
        <span className="mt-0.5 text-tertiary-container">Q.</span>
        {q}
      </h3>
      <p className="ml-1.5 border-l border-outline-variant py-1 pl-6 text-body-md leading-relaxed text-on-surface-variant">
        {a}
      </p>
    </div>
  )
}

// ── Transcript tab (highlights ↔ intelligence modules) ───────────────────────
function TranscriptTab({ episode, onPlay }: { episode: Episode; onPlay: () => void }) {
  const [activeRef, setActiveRef] = useState<string | null>(null)
  const segments = episode.transcript ?? []
  const moments = episode.summary?.moments.filter((m) => m.segmentId) ?? []

  if (!segments.length) {
    return (
      <div className="grid place-items-center gap-sm rounded-2xl border border-dashed border-outline-variant bg-surface-container-low py-xl text-center">
        <Icon name="graphic_eq" size={32} className="text-outline" />
        <h3 className="text-display-sm text-on-surface-variant">Transcript not ingested yet</h3>
        <p className="max-w-md text-body-md text-secondary">
          Once the transcription API returns this episode's text, the full transcript will appear here with the summary's
          highlights linked inline.
        </p>
      </div>
    )
  }

  function scrollToSegment(segmentId?: string) {
    if (!segmentId) return
    document.getElementById(`seg-${segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="grid grid-cols-12 items-start gap-gutter">
      {/* Transcript */}
      <article className="col-span-12 rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg md:col-span-8">
        <div className="flex flex-col gap-lg">
          {segments.map((seg) => (
            <TranscriptRow key={seg.id} seg={seg} activeRef={activeRef} onHover={setActiveRef} />
          ))}
        </div>
      </article>

      {/* Intelligence modules */}
      <aside className="sticky top-20 col-span-12 flex flex-col gap-md md:col-span-4">
        <div className="flex items-center gap-2 text-on-surface">
          <Icon name="auto_awesome" size={20} className="text-primary" />
          <SectionLabel>Intelligence modules</SectionLabel>
        </div>

        {moments.map((m) => {
          const refId = m.id
          const active = activeRef === refId
          return (
            <button
              key={m.id}
              onMouseEnter={() => setActiveRef(refId)}
              onMouseLeave={() => setActiveRef(null)}
              onClick={() => scrollToSegment(m.segmentId)}
              className={`rounded-lg border bg-surface-container-lowest p-md text-left transition-all ${
                active ? 'border-l-4 border-primary shadow-card' : 'border border-outline-variant'
              }`}
            >
              <div className="mb-sm flex items-start justify-between gap-sm">
                <h4 className="text-metadata font-semibold text-on-surface">{m.title}</h4>
                <span className="shrink-0 rounded bg-surface-container px-2 py-0.5 text-label-caps text-outline">
                  {m.timestamp}
                </span>
              </div>
              <p className="text-[14px] leading-relaxed text-on-surface-variant">{m.whyItMatters}</p>
            </button>
          )
        })}

        <button
          onClick={onPlay}
          className="flex items-center justify-center gap-2 rounded-lg border border-outline-variant py-2 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <Icon name="play_arrow" size={18} fill /> Listen along
        </button>
      </aside>
    </div>
  )
}

function TranscriptRow({
  seg,
  activeRef,
  onHover,
}: {
  seg: TranscriptSegment
  activeRef: string | null
  onHover: (ref: string | null) => void
}) {
  return (
    <div id={`seg-${seg.id}`} className="flex flex-col gap-1 scroll-mt-24 md:flex-row md:gap-md">
      <div className="flex shrink-0 items-baseline gap-2 md:w-32 md:flex-col md:items-start md:gap-1">
        <span className={`text-metadata font-semibold ${seg.role === 'guest' ? 'text-primary' : 'text-secondary'}`}>
          {seg.speaker}
        </span>
        <span className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-semibold text-outline">
          {seg.timestamp}
        </span>
      </div>
      <p className="flex-1 text-body-md leading-relaxed text-on-surface">
        {renderText(seg, activeRef, onHover)}
      </p>
    </div>
  )
}

// Wrap the highlighted span (if any) in an interactive <mark>.
function renderText(
  seg: TranscriptSegment,
  activeRef: string | null,
  onHover: (ref: string | null) => void,
) {
  const hl = seg.highlight
  if (!hl) return seg.text
  const idx = seg.text.indexOf(hl.quote)
  if (idx === -1) return seg.text
  const before = seg.text.slice(0, idx)
  const after = seg.text.slice(idx + hl.quote.length)
  return (
    <>
      {before}
      <mark
        className={`transcript-mark ${activeRef === hl.refId ? 'is-active' : ''}`}
        onMouseEnter={() => onHover(hl.refId)}
        onMouseLeave={() => onHover(null)}
        title={hl.label}
      >
        {hl.quote}
      </mark>
      {after}
    </>
  )
}

// ── Processing pipeline (non-ready episodes) ─────────────────────────────────
const PIPELINE: { status: ProcessingStatus; label: string; icon: string }[] = [
  { status: 'detected', label: 'Episode detected', icon: 'fiber_new' },
  { status: 'fetching', label: 'Fetching audio', icon: 'downloading' },
  { status: 'transcribing', label: 'Transcribing', icon: 'graphic_eq' },
  { status: 'summarizing', label: 'Generating AI summary', icon: 'auto_awesome' },
  { status: 'ready', label: 'Summary ready', icon: 'check_circle' },
]

function ProcessingPanel({ episode }: { episode: Episode }) {
  const failed = episode.status === 'failed'
  const currentIndex = failed ? 1 : PIPELINE.findIndex((p) => p.status === episode.status)

  return (
    <section className="mx-auto max-w-reading rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg">
      <div className="mb-lg flex items-center gap-sm">
        <span className="grid h-10 w-10 place-items-center rounded-full chip-signal">
          <Icon name={failed ? 'error' : statusMeta(episode.status).icon} className={failed ? 'text-error' : ''} />
        </span>
        <div>
          <h2 className="text-display-sm text-on-surface">{failed ? 'Processing failed' : 'Working on this episode…'}</h2>
          <p className="text-metadata text-secondary">
            {failed
              ? 'Something went wrong during processing. You can retry the pipeline.'
              : 'SignalCast is moving this episode through the pipeline. The summary will appear here when ready.'}
          </p>
        </div>
      </div>

      <ol className="relative ml-5 border-l border-outline-variant">
        {PIPELINE.map((step, i) => {
          const done = !failed && i < currentIndex
          const active = !failed && i === currentIndex
          const errored = failed && i === currentIndex
          return (
            <li key={step.status} className="mb-lg ml-lg last:mb-0">
              <span
                className={`absolute -left-[13px] grid h-6 w-6 place-items-center rounded-full border-2 ${
                  done
                    ? 'border-primary bg-primary text-on-primary'
                    : active
                      ? 'border-primary bg-surface text-primary'
                      : errored
                        ? 'border-error bg-error-container text-on-error-container'
                        : 'border-outline-variant bg-surface text-outline'
                }`}
              >
                <Icon
                  name={done ? 'check' : errored ? 'priority_high' : step.icon}
                  size={14}
                  className={active ? 'motion-safe:animate-pulse' : ''}
                />
              </span>
              <div className="flex items-center justify-between">
                <p className={`text-body-md ${done || active ? 'font-semibold text-on-surface' : 'text-secondary'}`}>
                  {step.label}
                </p>
                {active && <span className="text-[12px] font-medium text-primary">In progress</span>}
                {errored && <span className="text-[12px] font-medium text-error">Failed</span>}
              </div>
            </li>
          )
        })}
      </ol>

      {failed && (
        <button className="mt-md inline-flex items-center gap-2 rounded-lg bg-primary px-lg py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container">
          <Icon name="refresh" size={18} /> Retry processing
        </button>
      )}
    </section>
  )
}
