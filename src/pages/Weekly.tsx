import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { downloadWeekly, printWeekly } from '../lib/exportWeekly'
import { subscribeWeekly, unsubscribeWeekly } from '../lib/api'
import { Icon } from '../components/Icon'

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'play_circle' },
  { id: 'themes', label: 'Top Themes', icon: 'sell' },
  { id: 'takeaways', label: 'Key Takeaways', icon: 'format_list_bulleted' },
  { id: 'interesting', label: 'Interesting Ideas', icon: 'lightbulb' },
  { id: 'contradictions', label: 'Contradictions', icon: 'balance' },
  { id: 'mentions', label: 'Mentions', icon: 'alternate_email' },
  { id: 'questions', label: 'Questions', icon: 'help' },
]

const THEME_STYLES = [
  { tile: 'bg-[#eff5ff] text-[#2563eb] border-[#dbeafe]', icon: 'cloud' },
  { tile: 'bg-[#ecfdf3] text-[#15803d] border-[#d1fadf]', icon: 'pie_chart' },
  { tile: 'bg-[#f5f3ff] text-[#7c3aed] border-[#e9e2ff]', icon: 'shield' },
  { tile: 'bg-[#fff4ec] text-[#c2410c] border-[#ffe5d3]', icon: 'memory' },
  { tile: 'bg-[#fefce8] text-[#a16207] border-[#fdf0bf]', icon: 'bolt' },
]

export default function Weekly() {
  const { weekly, episodes, podcasts, episodeById, podcastById } = useAppData()
  const [active, setActive] = useState('overview')
  if (!weekly) return null

  const interestingEpisode = episodeById(weekly.interesting.episodeId)
  const ready = episodes.filter((e) => e.status === 'ready')
  const stats = [
    { icon: 'play_circle', label: 'Episodes Processed', value: weekly.episodeCount, style: THEME_STYLES[0] },
    { icon: 'format_list_bulleted', label: 'Key Takeaways', value: ready.reduce((n, e) => n + (e.summary?.takeaways.length ?? 0), 0), style: THEME_STYLES[1] },
    { icon: 'lightbulb', label: 'Interesting Moments', value: ready.reduce((n, e) => n + (e.summary?.moments.length ?? 0), 0), style: THEME_STYLES[2] },
    { icon: 'podcasts', label: 'Podcasts', value: podcasts.filter((p) => p.tracked).length, style: THEME_STYLES[3] },
  ]

  function go(id: string) {
    setActive(id)
    document.getElementById(`wk-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-lg flex flex-wrap items-start justify-between gap-md">
        <div>
          <h1 className="text-display-lg tracking-tight text-on-surface">Weekly Summary</h1>
          <p className="mt-1 text-body-md text-secondary">{weekly.rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => downloadWeekly(weekly, episodeById, podcastById)}
            title="Download the structured summary document"
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-md py-2.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            <Icon name="ios_share" size={18} /> Share
          </button>
          <button
            onClick={() => printWeekly(weekly, episodeById, podcastById)}
            title="Print the structured document to PDF"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container"
          >
            <Icon name="picture_as_pdf" size={18} /> Export PDF
          </button>
        </div>
      </div>

      <WeeklySubscribe />

      <div className="grid grid-cols-12 gap-gutter">
        {/* In-page sub-nav */}
        <nav className="col-span-12 md:col-span-3">
          <ul className="sticky top-20 flex flex-col gap-0.5">
            {NAV.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => go(n.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border-l-2 px-3 py-2 text-left text-[14px] transition-colors ${
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
            <section id="wk-overview" className="scroll-mt-20">
              <h2 className="mb-md text-[22px] font-bold tracking-tight text-on-surface">This Week in Summary</h2>
              <div className="space-y-md text-body-md leading-relaxed text-on-surface-variant">
                {weekly.overview.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>

            {/* Themes */}
            <section id="wk-themes" className="mt-lg scroll-mt-20 border-t border-outline-variant pt-lg">
              <h3 className="mb-md text-[17px] font-semibold text-on-surface">Top Themes</h3>
              <div className="flex flex-wrap gap-2.5">
                {weekly.topThemes.map((t, i) => {
                  const s = THEME_STYLES[i % THEME_STYLES.length]
                  return (
                    <Link
                      key={t.label}
                      to={`/search?q=${encodeURIComponent(t.label)}`}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px] font-medium ${s.tile}`}
                    >
                      <Icon name={s.icon} size={16} /> {t.label}
                    </Link>
                  )
                })}
              </div>
            </section>

            {/* Key takeaways */}
            <section id="wk-takeaways" className="mt-lg scroll-mt-20 border-t border-outline-variant pt-lg">
              <h3 className="mb-md text-[17px] font-semibold text-on-surface">Key Takeaways Across All Podcasts</h3>
              <ul className="space-y-2.5">
                {weekly.takeaways.map((t, i) => (
                  <li key={i} className="flex gap-2.5 text-body-md text-on-surface-variant">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>
                      <span className="font-semibold text-on-surface">{t.title}.</span> {t.detail}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Stat tiles */}
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

            {/* Interesting ideas */}
            <section id="wk-interesting" className="mt-lg scroll-mt-20 border-t border-outline-variant pt-lg">
              <h3 className="mb-md text-[17px] font-semibold text-on-surface">What Was Actually Interesting</h3>
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-metadata font-semibold backdrop-blur transition-colors hover:bg-white/25"
                    >
                      <Icon name="open_in_new" size={16} /> Double-click this
                    </Link>
                  )}
                </div>
              </div>
            </section>

            {/* Contradictions */}
            <section id="wk-contradictions" className="mt-lg scroll-mt-20 border-t border-outline-variant pt-lg">
              <h3 className="mb-md text-[17px] font-semibold text-on-surface">Contradictions & Disagreements</h3>
              <div className="space-y-2.5">
                {weekly.contradictions.map((c, i) => (
                  <div key={i} className="flex gap-2.5 rounded-xl border border-outline-variant bg-surface-container-low p-md">
                    <Icon name="balance" size={20} className="shrink-0 text-tertiary" />
                    <p className="text-body-md text-on-surface-variant">{c}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Mentions */}
            <section id="wk-mentions" className="mt-lg scroll-mt-20 border-t border-outline-variant pt-lg">
              <h3 className="mb-md text-[17px] font-semibold text-on-surface">Mentions</h3>
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                <MentionGroup title="People" icon="person" items={weekly.mentions.people} />
                <MentionGroup title="Companies" icon="domain" items={weekly.mentions.companies} />
              </div>
            </section>

            {/* Questions */}
            <section id="wk-questions" className="mt-lg scroll-mt-20 border-t border-outline-variant pt-lg">
              <h3 className="mb-md text-[17px] font-semibold text-on-surface">Questions Worth Investigating</h3>
              <ul className="space-y-2.5">
                {weekly.questions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2.5 rounded-xl border border-outline-variant bg-surface-container-low p-md">
                    <Icon name="help" size={20} className="shrink-0 text-primary" />
                    <p className="text-body-md text-on-surface">{q}</p>
                  </li>
                ))}
              </ul>
            </section>

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
    </div>
  )
}

// Weekly-digest email subscription. Persists locally; the actual send is wired
// through api.subscribeWeekly (see the SEAM in lib/api.ts).
const SUB_KEY = 'munshot:weekly-subscription'

function WeeklySubscribe() {
  const [stored, setStored] = useState<string | null>(null)
  const [email, setEmail] = useState('ceekay@muns.io')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SUB_KEY)
      if (saved) {
        setStored(saved)
        setEmail(saved)
      }
    } catch {
      /* localStorage unavailable — fine, just won't persist */
    }
  }, [])

  async function subscribe(e: FormEvent) {
    e.preventDefault()
    const addr = email.trim()
    if (!addr || busy) return
    setBusy(true)
    try {
      const res = await subscribeWeekly(addr)
      if (res.subscribed) {
        try {
          localStorage.setItem(SUB_KEY, res.email)
        } catch {
          /* ignore */
        }
        setStored(res.email)
      }
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    if (busy) return
    setBusy(true)
    try {
      await unsubscribeWeekly(stored ?? email)
      try {
        localStorage.removeItem(SUB_KEY)
      } catch {
        /* ignore */
      }
      setStored(null)
    } finally {
      setBusy(false)
    }
  }

  if (stored) {
    return (
      <div className="mb-lg flex flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-primary-fixed/40 p-md">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
          <Icon name="mark_email_read" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-md font-semibold text-on-surface">You're subscribed to the weekly brief</p>
          <p className="text-metadata text-secondary">
            One email every Monday to <span className="font-medium text-on-surface">{stored}</span> with this summary.
          </p>
        </div>
        <button
          onClick={unsubscribe}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-md py-2.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Unsubscribe'}
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={subscribe}
      className="mb-lg flex flex-wrap items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-lowest p-md shadow-card"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full chip-signal">
        <Icon name="mail" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-md font-semibold text-on-surface">Get the weekly brief in your inbox</p>
        <p className="text-metadata text-secondary">One email a week from Munshot — every Monday, this whole summary.</p>
      </div>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-56 rounded-lg border border-outline-variant bg-surface px-3 py-2.5 text-[14px] outline-none focus:border-primary"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-50"
      >
        <Icon name="notifications_active" size={18} /> {busy ? 'Subscribing…' : 'Subscribe'}
      </button>
    </form>
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
            className="rounded-full border border-outline-variant bg-surface px-2.5 py-1 text-[12px] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            {it}
          </Link>
        ))}
      </div>
    </div>
  )
}
