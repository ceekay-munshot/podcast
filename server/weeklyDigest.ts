import type { Episode, Podcast } from '../src/lib/types'
import { PODCASTS } from '../src/lib/mock-data'
import { assembleWeekly } from '../src/lib/weeklyAssemble'
import { weeklyBriefEmailHtml } from '../src/lib/email'
import type { SummaryStore } from './summaryStore'
import type { SubscriberStore } from './subscriberStore'

// ─────────────────────────────────────────────────────────────────────────────
// The Monday weekly-digest job — runtime-agnostic (Vite dev middleware AND the
// Cloudflare Pages Function are thin wrappers). It builds ONE shared edition from
// the curated shows' episodes that are (a) summarised and (b) published in the
// last 7 days, renders it as a designed HTML email, and sends it to every
// subscriber. No browser needed: the digest is assembled entirely server-side
// from the deterministic engine (weeklyAssemble.ts) + the shared summary cache,
// so it never depends on anyone having opened the app this week.
//
// Triggered over HTTP by a scheduled GitHub Actions workflow (Cloudflare Pages
// can't run cron itself), guarded by a shared CRON_SECRET.
// ─────────────────────────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Constant-time-ish bearer check against the configured secret. No secret
 *  configured → always unauthorized (fail closed), so a misconfig can't open it. */
export function checkCronAuth(authHeader: string | null | undefined, secret: string | undefined): boolean {
  if (!secret) return false
  const m = /^Bearer\s+(.+)$/i.exec((authHeader ?? '').trim())
  return !!m && m[1] === secret
}

/** Episodes that belong in THIS week's edition: ready (summarised) and published
 *  within the last 7 days of `now`. */
export function readyThisWeek(episodes: Episode[], now: number): Episode[] {
  const cutoff = now - WEEK_MS
  return episodes.filter((e) => e.status === 'ready' && e.summary && +new Date(e.publishedAt) >= cutoff)
}

export interface DigestDeps {
  /** Source of the curated shows' episodes (summaries overlaid) — getLiveEpisodes. */
  getEpisodes: (store?: SummaryStore) => Promise<Episode[]>
  summaryStore?: SummaryStore
  subscriberStore: SubscriberStore | null
  /** Sends one email; returns whether it went out. Injected so tests don't hit the wire. */
  sendEmail: (msg: { email: string; subject: string; html: string }) => Promise<{ ok: boolean; message: string }>
  /** Overridable clock for tests. */
  now?: number
}

export interface DigestReport {
  ok: boolean
  sent: number
  failed: number
  recipients: number
  rangeLabel?: string
  episodeCount?: number
  /** Set when nothing was sent: 'no_ready_episodes' | 'no_subscribers'. */
  skipped?: string
}

/** Build this week's shared edition and mail it to every subscriber. Returns a
 *  report (also useful as the HTTP response body). Never throws on a single
 *  failed send — those are counted, not fatal. */
export async function runWeeklyDigest(deps: DigestDeps): Promise<{ status: number; body: DigestReport }> {
  const now = deps.now ?? Date.now()
  const podcastById = (id: string): Podcast | undefined => PODCASTS.find((p) => p.id === id)

  const all = await deps.getEpisodes(deps.summaryStore)
  const ready = readyThisWeek(all, now)
  if (!ready.length) {
    return { status: 200, body: { ok: true, sent: 0, failed: 0, recipients: 0, skipped: 'no_ready_episodes' } }
  }

  const subscribers = deps.subscriberStore ? (await deps.subscriberStore.get()) ?? [] : []
  if (!subscribers.length) {
    return { status: 200, body: { ok: true, sent: 0, failed: 0, recipients: 0, skipped: 'no_subscribers' } }
  }

  const weekly = assembleWeekly(ready, podcastById)
  const episodeById = (id: string): Episode | undefined => ready.find((e) => e.id === id)
  const html = weeklyBriefEmailHtml(weekly, episodeById, podcastById)
  const subject = `Munshot Weekly — ${weekly.rangeLabel}`

  let sent = 0
  let failed = 0
  for (const sub of subscribers) {
    const res = await deps.sendEmail({ email: sub.email, subject, html })
    if (res.ok) sent++
    else failed++
  }

  return {
    status: 200,
    body: { ok: failed === 0, sent, failed, recipients: subscribers.length, rangeLabel: weekly.rangeLabel, episodeCount: ready.length },
  }
}
