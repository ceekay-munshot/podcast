import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { usePlayer } from '../store/Player'
import { formatDuration, longDate, statusMeta } from '../lib/format'
import type { Episode, InterestingMoment, ProcessingStatus, TranscriptSegment } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'

type Tab = 'summary' | 'takeaways' | 'qa' | 'moments' | 'transcript'

// Colored styling for interesting-moment tiles, cycled by index.
const TILES = [
  { icon: 'hub', text: 'text-[#2563eb]', tile: 'bg-[#eff5ff]', pill: 'bg-[#eff5ff] text-[#2563eb]' },
  { icon: 'memory', text: 'text-[#16a34a]', tile: 'bg-[#ecfdf3]', pill: 'bg-[#ecfdf3] text-[#15803d]' },
  { icon: 'trending_up', text: 'text-[#7c3aed]', tile: 'bg-[#f5f3ff]', pill: 'bg-[#f5f3ff] text-[#7c3aed]' },
  { icon: 'account_balance', text: 'text-[#ea7317]', tile: 'bg-[#fff4ec]', pill: 'bg-[#fff4ec] text-[#c2410c]' },
  { icon: 'developer_board', text: 'text-[#0d9488]', tile: 'bg-[#eefcfb]', pill: 'bg-[#eefcfb] text-[#0d9488]' },
]

export default function EpisodeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { episodeById, podcastById } = useAppData()
  const { play } = usePlayer()

  const paramTab = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(paramTab ?? 'summary')
  const [jumpTo, setJumpTo] = useState<string | null>(null)

  const episode = id ? episodeById(id) : undefined
  const podcast = episode ? podcastById(episode.podcastId) : undefined

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
    { id: 'moments', label: 'Interesting Moments', show: !!episode.summary?.moments.length },
    { id: 'transcript', label: 'Transcript', show: true },
  ]

  function openTranscript(segmentId?: string) {
    setTab('transcript')
    if (segmentId) setJumpTo(segmentId)
  }

  return (
    <div className="animate-fade-up">
      <button
        onClick={() => navigate(-1)}
        className="mb-md inline-flex items-center gap-1 text-metadata font-semibold text-primary transition-colors hover:underline"
      >
        <Icon name="arrow_back" size={16} /> Back to Episodes
      </button>

      {/* Header */}
      <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start">
        <CoverTile podcast={podcast} className="h-28 w-28 shrink-0" rounded="rounded-xl" />
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <CoverTile podcast={podcast} className="h-5 w-5" rounded="rounded" />
            <span className="text-metadata font-semibold text-on-surface">{podcast.title}</span>
            <span className="text-metadata text-secondary">· {podcast.author}</span>
          </div>
          <h1 className="mb-2 text-display-lg tracking-tight text-on-surface">{episode.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-metadata text-secondary">
            <span className="inline-flex items-center gap-1">
              <Icon name="calendar_today" size={15} /> {longDate(episode.publishedAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="schedule" size={15} /> {formatDuration(episode.durationSec)}
            </span>
            <StatusBadge status={episode.status} />
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => play(episode)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container"
          >
            <Icon name="play_arrow" size={18} fill /> Listen
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-md py-2.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low">
            <Icon name="ios_share" size={18} /> Share
          </button>
        </div>
      </div>

      {episode.status !== 'ready' || !episode.summary ? (
        <ProcessingPanel episode={episode} />
      ) : (
        <>
          <div className="mb-lg flex gap-lg overflow-x-auto border-b border-outline-variant">
            {TABS.filter((t) => t.show).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-[14px] transition-colors ${
                  tab === t.id ? 'border-primary font-semibold text-primary' : 'border-transparent text-secondary hover:text-on-surface'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'summary' && <SummaryTab episode={episode} />}
          {tab === 'takeaways' && <TakeawaysTab episode={episode} />}
          {tab === 'qa' && <QATab episode={episode} />}
          {tab === 'moments' && <MomentsTab episode={episode} hasTranscript={hasTranscript} onOpen={openTranscript} />}
          {tab === 'transcript' && <TranscriptTab episode={episode} />}
        </>
      )}
    </div>
  )
}

// Renders inline **bold** markup as emphasized spans, so summary data can stay plain strings.
function renderEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith('**') && chunk.endsWith('**') ? (
      <strong key={i} className="font-semibold text-on-surface">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      chunk
    ),
  )
}

// ── Summary tab — AI Summary + At a Glance ───────────────────────────────────
function SummaryTab({ episode }: { episode: Episode }) {
  const s = episode.summary!
  const wordCount = useMemo(() => {
    const text = [...s.synthesis, ...s.takeaways.flatMap((t) => [t.title, t.detail]), ...s.qa.flatMap((q) => [q.q, q.a])].join(' ')
    return text.trim().split(/\s+/).length
  }, [s])

  const glance = [
    { icon: 'star', label: 'Key Takeaways', value: s.takeaways.length },
    { icon: 'schedule', label: 'Interesting Moments', value: s.moments.length },
    { icon: 'help', label: 'Q&A', value: s.qa.length },
    { icon: 'text_fields', label: 'Word Count', value: wordCount.toLocaleString() },
  ]

  return (
    <div className="grid grid-cols-12 gap-gutter">
      <section className="col-span-12 rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-card md:col-span-8">
        <div className="mb-md flex items-center gap-2 text-primary">
          <Icon name="auto_awesome" fill />
          <h2 className="text-[19px] font-semibold text-on-surface">AI Summary</h2>
        </div>
        <div className="space-y-md text-body-md leading-relaxed text-on-surface-variant">
          {s.synthesis.map((p, i) => (
            <p key={i}>{renderEmphasis(p)}</p>
          ))}
        </div>
      </section>

      <aside className="col-span-12 md:col-span-4">
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-card">
          <div className="mb-md flex items-center gap-2 text-primary">
            <Icon name="visibility" />
            <h2 className="text-[17px] font-semibold text-on-surface">At a Glance</h2>
          </div>
          <ul className="flex flex-col gap-1">
            {glance.map((g) => (
              <li key={g.label} className="flex items-center gap-3 py-1.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg chip-signal">
                  <Icon name={g.icon} size={20} />
                </span>
                <div>
                  <p className="text-metadata text-secondary">{g.label}</p>
                  <p className="text-[20px] font-bold leading-tight text-on-surface">{g.value}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

// ── Takeaways tab — numbered, with copy ──────────────────────────────────────
function TakeawaysTab({ episode }: { episode: Episode }) {
  const s = episode.summary!
  return (
    <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-card">
      <ul className="divide-y divide-outline-variant">
        {s.takeaways.map((t, i) => (
          <li key={i} className="flex items-start gap-md p-md">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full chip-signal text-metadata font-bold">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body-md font-semibold text-on-surface">{t.title}</p>
              <p className="mt-0.5 text-body-md text-on-surface-variant">{t.detail}</p>
            </div>
            <CopyButton text={`${t.title} — ${t.detail}`} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Q&A tab ──────────────────────────────────────────────────────────────────
function QATab({ episode }: { episode: Episode }) {
  const s = episode.summary!
  return (
    <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-card">
      <ul className="divide-y divide-outline-variant">
        {s.qa.map((item, i) => (
          <li key={i} className="flex items-start gap-md p-md">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg chip-signal text-metadata font-bold">{i + 1}</span>
            <div>
              <h3 className="mb-1.5 text-body-md font-semibold text-on-surface">{item.q}</h3>
              <p className="text-body-md leading-relaxed text-on-surface-variant">{item.a}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Interesting Moments tab — colored tiles ──────────────────────────────────
function MomentsTab({
  episode,
  hasTranscript,
  onOpen,
}: {
  episode: Episode
  hasTranscript: boolean
  onOpen: (segmentId?: string) => void
}) {
  const moments = episode.summary!.moments
  return (
    <section>
      <div className="mb-md flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="auto_awesome" className="text-primary" fill />
          <div>
            <h2 className="text-[19px] font-semibold text-on-surface">Interesting Moments</h2>
            <p className="text-metadata text-secondary">Key highlights automatically identified from the episode.</p>
          </div>
        </div>
        <CopyButton text={moments.map((m) => `${m.timestamp} — ${m.title}: ${m.whyItMatters}`).join('\n')} label="Copy All Moments" />
      </div>

      <ul className="flex flex-col gap-2.5">
        {moments.map((m, i) => {
          const style = TILES[i % TILES.length]
          const clickable = hasTranscript && m.segmentId
          return (
            <li key={m.id}>
              <button
                onClick={() => clickable && onOpen(m.segmentId)}
                className={`flex w-full items-start gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-md text-left shadow-card transition-shadow ${
                  clickable ? 'hover:shadow-card-hover' : 'cursor-default'
                }`}
              >
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${style.tile}`}>
                  <Icon name={style.icon} size={22} className={style.text} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-md font-semibold text-on-surface">{m.title}</p>
                  <p className="mt-0.5 text-body-md text-on-surface-variant">{m.whyItMatters}</p>
                </div>
                <span className={`shrink-0 rounded-md px-2.5 py-1 text-metadata font-semibold ${style.pill}`}>{m.timestamp}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Transcript tab — Highlights list ↔ transcript ────────────────────────────
function TranscriptTab({ episode }: { episode: Episode }) {
  const [activeRef, setActiveRef] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const segments = episode.transcript ?? []
  const moments = episode.summary?.moments.filter((m) => m.segmentId) ?? []

  if (!segments.length) {
    return (
      <div className="grid place-items-center gap-sm rounded-2xl border border-dashed border-outline-variant bg-surface-container-low py-xl text-center">
        <Icon name="graphic_eq" size={32} className="text-outline" />
        <h3 className="text-[19px] font-semibold text-on-surface-variant">Transcript not ingested yet</h3>
        <p className="max-w-md text-body-md text-secondary">
          Once the transcription API returns this episode's text, the full transcript appears here with the summary's
          highlights linked inline.
        </p>
      </div>
    )
  }

  const needle = q.trim().toLowerCase()
  const visible = needle ? segments.filter((s) => s.text.toLowerCase().includes(needle)) : segments

  function jump(segmentId?: string, refId?: string) {
    if (refId) setActiveRef(refId)
    if (segmentId) document.getElementById(`seg-${segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="grid grid-cols-12 gap-gutter">
      {/* Highlights */}
      <aside className="col-span-12 md:col-span-4">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-on-surface">Highlights</h3>
          <span className="grid h-5 min-w-5 place-items-center rounded-full chip-signal px-1.5 text-[11px] font-bold">
            {moments.length}
          </span>
        </div>
        <ul className="flex flex-col gap-2">
          {moments.map((m) => {
            const active = activeRef === m.id
            return (
              <li key={m.id}>
                <button
                  onMouseEnter={() => setActiveRef(m.id)}
                  onClick={() => jump(m.segmentId, m.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    active ? 'border-l-4 border-primary bg-[#eff5ff]' : 'border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low'
                  }`}
                >
                  <p className="text-metadata font-semibold text-primary">{m.timestamp}</p>
                  <p className="mt-0.5 text-[14px] font-medium text-on-surface">{m.title}</p>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* Transcript */}
      <article className="col-span-12 rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-card md:col-span-8">
        <div className="relative mb-md">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search transcript…"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-low py-2 pl-10 pr-sm text-[14px] outline-none focus:border-primary focus:bg-surface"
          />
        </div>
        <div className="flex flex-col">
          {visible.map((seg) => (
            <TranscriptRow key={seg.id} seg={seg} activeRef={activeRef} onHover={setActiveRef} />
          ))}
          {visible.length === 0 && <p className="py-md text-center text-metadata text-secondary">No lines match “{q}”.</p>}
        </div>
      </article>
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
  const isActive = !!seg.highlight && activeRef === seg.highlight.refId
  return (
    <div
      id={`seg-${seg.id}`}
      className={`grid scroll-mt-24 grid-cols-[64px_84px_1fr] gap-2 rounded-lg px-2 py-3 transition-colors ${
        isActive ? 'bg-[#eff5ff]' : ''
      }`}
    >
      <span className="text-metadata font-semibold text-primary">{seg.timestamp}</span>
      <span className={`text-metadata font-semibold ${seg.role === 'guest' ? 'text-on-surface' : 'text-on-surface-variant'}`}>
        {seg.speaker}
      </span>
      <p className="text-body-md leading-relaxed text-on-surface">{renderText(seg, activeRef, onHover)}</p>
    </div>
  )
}

function renderText(seg: TranscriptSegment, activeRef: string | null, onHover: (ref: string | null) => void) {
  const hl = seg.highlight
  if (!hl) return seg.text
  const idx = seg.text.indexOf(hl.quote)
  if (idx === -1) return seg.text
  return (
    <>
      {seg.text.slice(0, idx)}
      <mark
        className={`transcript-mark ${activeRef === hl.refId ? 'is-active' : ''}`}
        onMouseEnter={() => onHover(hl.refId)}
        onMouseLeave={() => onHover(null)}
        title={hl.label}
      >
        {hl.quote}
      </mark>
      {seg.text.slice(idx + hl.quote.length)}
    </>
  )
}

// ── Copy button helper ───────────────────────────────────────────────────────
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      },
      () => {},
    )
  }
  if (label) {
    return (
      <button
        onClick={copy}
        className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-3 py-2 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={16} className={copied ? 'text-success' : ''} />
        {copied ? 'Copied' : label}
      </button>
    )
  }
  return (
    <button
      onClick={copy}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-secondary transition-colors hover:bg-surface-container hover:text-primary"
      aria-label="Copy"
    >
      <Icon name={copied ? 'check' : 'content_copy'} size={17} className={copied ? 'text-success' : ''} />
    </button>
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
    <section className="mx-auto max-w-reading rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-card">
      <div className="mb-lg flex items-center gap-sm">
        <span className="grid h-10 w-10 place-items-center rounded-full chip-signal">
          <Icon name={failed ? 'error' : statusMeta(episode.status).icon} className={failed ? 'text-error' : ''} />
        </span>
        <div>
          <h2 className="text-[19px] font-semibold text-on-surface">{failed ? 'Processing failed' : 'Working on this episode…'}</h2>
          <p className="text-metadata text-secondary">
            {failed
              ? 'Something went wrong during processing. You can retry the pipeline.'
              : 'Munshot is moving this episode through the pipeline. The summary will appear here when ready.'}
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
                <Icon name={done ? 'check' : errored ? 'priority_high' : step.icon} size={14} className={active ? 'motion-safe:animate-pulse' : ''} />
              </span>
              <div className="flex items-center justify-between">
                <p className={`text-body-md ${done || active ? 'font-semibold text-on-surface' : 'text-secondary'}`}>{step.label}</p>
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
