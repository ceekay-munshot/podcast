import { describe, it, expect, vi } from 'vitest'
import type { Episode, Summary } from '../src/lib/types'
import {
  MAX_RESUME_TICKS,
  checkCronAuth,
  pickBackfillTargets,
  pickPendingThisWeek,
  processPendingBatch,
  readyThisWeek,
  resumeOwedParts,
  runWeeklyDigest,
  type PendingDelivery,
  type PendingDeliveryStore,
} from './weeklyDigest'
import type { Subscriber, SubscriberStore } from './subscriberStore'

// The Monday digest job. The send transport and the data sources are injected, so
// these tests exercise the real assemble-and-send orchestration without the wire.

const NOW = Date.parse('2026-06-15T12:00:00Z') // a Monday
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

function sum(over: Partial<Summary> = {}): Summary {
  return {
    synthesis: ['A concrete synthesis of the week.'],
    highlights: [{ id: 'h1', title: 'Key point', timestamp: '—', detail: 'why it matters', key: true }],
    qa: [{ q: 'Is it a bubble?', a: 'No' }],
    ...over,
  }
}

function ep(id: string, podcastId: string, publishedAt: string, status: Episode['status'] = 'ready'): Episode {
  return {
    id,
    podcastId,
    title: `Episode ${id}`,
    publishedAt,
    durationSec: 1000,
    status,
    signal: 'normal',
    blurb: 'blurb',
    entities: { people: ['Sam Altman'], companies: ['OpenAI'], themes: [] },
    summary: status === 'ready' ? sum() : undefined,
  }
}

// A detected (not-yet-summarised) episode WITH source material — a valid backfill
// candidate (pickBackfillTargets skips items with no notes/transcript/audio).
const pending = (id: string, podcastId: string, publishedAt: string): Episode => ({
  ...ep(id, podcastId, publishedAt, 'detected'),
  notes: 'Real show notes with enough material to summarise from.',
})

const memSubscriberStore = (list: Subscriber[] | null): SubscriberStore => ({
  get: async () => list,
  put: async () => {},
})

const subs = (...emails: string[]): Subscriber[] => emails.map((email) => ({ email, addedAt: 'x' }))

const memPendingStore = (initial: PendingDelivery | null = null) => {
  let value = initial
  const store: PendingDeliveryStore = {
    get: async () => value,
    put: async (p) => {
      value = p
    },
  }
  return { store, value: () => value }
}

describe('checkCronAuth', () => {
  it('fails closed without a secret, and matches a correct bearer token', () => {
    expect(checkCronAuth('Bearer abc', undefined)).toBe(false) // no secret configured
    expect(checkCronAuth('Bearer abc', 'abc')).toBe(true)
    expect(checkCronAuth('bearer abc', 'abc')).toBe(true) // scheme is case-insensitive
    expect(checkCronAuth('Bearer wrong', 'abc')).toBe(false)
    expect(checkCronAuth(null, 'abc')).toBe(false)
    expect(checkCronAuth('abc', 'abc')).toBe(false) // missing scheme
  })
})

describe('readyThisWeek', () => {
  it('keeps only summarised episodes published within the last 7 days', () => {
    const eps = [
      ep('fresh', 'allin', daysAgo(2)),
      ep('old', 'allin', daysAgo(30)),
      ep('pending', 'oddlots', daysAgo(1), 'transcribing'),
    ]
    expect(readyThisWeek(eps, NOW).map((e) => e.id)).toEqual(['fresh'])
  })
})

describe('pickBackfillTargets', () => {
  it('picks one recent, summarisable pending episode per UNCOVERED channel', () => {
    const eps = [
      ep('allin-ready', 'allin', daysAgo(1)), // allin already covered this week → skip the channel
      pending('allin-older', 'allin', daysAgo(2)), // (same channel, ignored)
      pending('odd-new', 'oddlots', daysAgo(1)), // oddlots uncovered → pick the NEWEST pending
      pending('odd-old', 'oddlots', daysAgo(4)),
      pending('stale', 'bg2', daysAgo(20)), // out of the 7-day window → skip
      ep('bare', 'acquired', daysAgo(1), 'detected'), // no notes/transcript/audio → nothing to summarise → skip
    ]
    expect(pickBackfillTargets(eps, NOW).map((e) => e.id)).toEqual(['odd-new'])
  })
})

describe('runWeeklyDigest', () => {
  it('backfills uncovered channels before sending so the brief is never empty', async () => {
    const sendEmail = vi.fn(async (_msg: { email: string; subject: string; html: string }) => ({ ok: true, message: 'sent', messageId: '<root@muns.io>' }))
    const processEpisode = vi.fn(async (e: Episode) => sum({ synthesis: [`processed ${e.id}`] }))
    const res = await runWeeklyDigest({
      getEpisodes: async () => [pending('fresh', 'allin', daysAgo(1))], // nothing ready yet this week
      subscriberStore: memSubscriberStore(subs('a@muns.io')),
      sendEmail,
      processEpisode,
      now: NOW,
    })
    expect(processEpisode).toHaveBeenCalledTimes(1)
    expect(processEpisode.mock.calls[0][0].id).toBe('fresh')
    expect(res.body).toMatchObject({ ok: true, sent: 1, backfilled: 1, episodeCount: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('is best-effort per channel: one failed processing never blocks the send', async () => {
    const sendEmail = vi.fn(async (_msg: { email: string; subject: string; html: string }) => ({ ok: true, message: 'sent', messageId: '<root@muns.io>' }))
    const processEpisode = vi.fn(async (e: Episode) => {
      if (e.podcastId === 'oddlots') throw new Error('provider down')
      return sum({ synthesis: [`processed ${e.id}`] })
    })
    const res = await runWeeklyDigest({
      getEpisodes: async () => [pending('a', 'allin', daysAgo(1)), pending('o', 'oddlots', daysAgo(1))],
      subscriberStore: memSubscriberStore(subs('a@muns.io')),
      sendEmail,
      processEpisode,
      now: NOW,
    })
    expect(processEpisode).toHaveBeenCalledTimes(2)
    expect(res.body).toMatchObject({ ok: true, sent: 1, backfilled: 1, episodeCount: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('does not backfill channels already covered this week', async () => {
    const sendEmail = vi.fn(async (_msg: { email: string; subject: string; html: string }) => ({ ok: true, message: 'sent', messageId: '<root@muns.io>' }))
    const processEpisode = vi.fn(async (e: Episode) => sum({ synthesis: [`processed ${e.id}`] }))
    const res = await runWeeklyDigest({
      getEpisodes: async () => [ep('ready', 'allin', daysAgo(1))], // already summarised → no work needed
      subscriberStore: memSubscriberStore(subs('a@muns.io')),
      sendEmail,
      processEpisode,
      now: NOW,
    })
    expect(processEpisode).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({ ok: true, sent: 1, backfilled: 0, episodeCount: 1 })
  })

  it('skips (sends nothing) when no episodes are ready this week', async () => {
    const sendEmail = vi.fn()
    const res = await runWeeklyDigest({
      getEpisodes: async () => [ep('old', 'allin', daysAgo(40))],
      subscriberStore: memSubscriberStore(subs('a@muns.io')),
      sendEmail,
      now: NOW,
    })
    expect(res.body).toMatchObject({ sent: 0, skipped: 'no_ready_episodes' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips when there are episodes but no subscribers', async () => {
    const sendEmail = vi.fn()
    const res = await runWeeklyDigest({
      getEpisodes: async () => [ep('fresh', 'allin', daysAgo(1))],
      subscriberStore: memSubscriberStore([]),
      sendEmail,
      now: NOW,
    })
    expect(res.body).toMatchObject({ sent: 0, skipped: 'no_subscribers' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('mails the shared edition to every subscriber', async () => {
    const sendEmail = vi.fn(async (_msg: { email: string; subject: string; html: string }) => ({ ok: true, message: 'sent', messageId: '<root@muns.io>' }))
    const res = await runWeeklyDigest({
      getEpisodes: async () => [ep('e1', 'allin', daysAgo(1)), ep('e2', 'oddlots', daysAgo(3))],
      subscriberStore: memSubscriberStore(subs('a@muns.io', 'b@muns.io')),
      sendEmail,
      now: NOW,
    })
    expect(res.body).toMatchObject({ ok: true, sent: 2, failed: 0, recipients: 2, episodeCount: 2 })
    expect((res.body as { rangeLabel?: string }).rangeLabel).toBeTruthy()
    expect(sendEmail).toHaveBeenCalledTimes(2)
    // Every subscriber gets the SAME edition (same subject + html).
    const calls = sendEmail.mock.calls
    expect(calls[0][0].email).toBe('a@muns.io')
    expect(calls[1][0].email).toBe('b@muns.io')
    expect(calls[0][0].subject).toBe(calls[1][0].subject)
    expect(calls[0][0].html).toBe(calls[1][0].html)
    expect(calls[0][0].subject).toContain('Munshot AI Podcasts')
    expect(calls[0][0].html).toContain('Weekly Summary')
    expect(calls[0][0].subject).not.toContain('Part') // a normal week is still ONE email
    expect(res.body).toMatchObject({ parts: 1 })
  })

  // A heavy week (30 long summaries) renders well past Gmail's ~102KB clip.
  const heavyWeek = () =>
    Array.from({ length: 30 }, (_, i) => ({
      ...ep(`h${i}`, i % 2 ? 'allin' : 'oddlots', daysAgo(1)),
      summary: sum({
        synthesis: ['A concrete synthesis of the week. '.repeat(20)],
        highlights: Array.from({ length: 6 }, (_, k) => ({ id: `h${k}`, title: `Key point ${k}`, timestamp: '—', detail: 'why it matters '.repeat(20), key: true })),
      }),
    }))

  it('splits a long edition into ordered parts for every subscriber', async () => {
    const sendEmail = vi.fn(async (msg: { email: string; subject: string; html: string; inReplyTo?: string }) => ({ ok: true, message: 'sent', messageId: `<${msg.email.split('@')[0]}${msg.inReplyTo ? '-reply' : '-root'}@muns.io>` }))
    const res = await runWeeklyDigest({
      getEpisodes: async () => heavyWeek(),
      subscriberStore: memSubscriberStore(subs('a@muns.io', 'b@muns.io')),
      sendEmail,
      now: NOW,
    })
    const parts = (res.body as { parts?: number }).parts ?? 0
    expect(parts).toBeGreaterThan(1)
    expect(res.body).toMatchObject({ ok: true, sent: 2, failed: 0, recipients: 2 })
    expect(sendEmail).toHaveBeenCalledTimes(2 * parts)
    const calls = sendEmail.mock.calls.map(([m]) => m)
    // Recipients may overlap, but each one's parts arrive strictly in order.
    for (const email of ['a@muns.io', 'b@muns.io']) {
      const mine = calls.filter((m) => m.email === email)
      expect(mine).toHaveLength(parts)
      mine.forEach(m => expect(m.subject).toBe(mine[0].subject))
      expect(mine[0].inReplyTo).toBeUndefined()
      expect(mine.slice(1).every(m => m.inReplyTo === `<${email.split('@')[0]}-root@muns.io>`)).toBe(true)
    }
  })

  it('a complete send supersedes an older remainder, so no stale part follows the new brief', async () => {
    const pending = memPendingStore({ parts: [{ subject: 'Old (Part 3 of 3)', html: '<p>old</p>' }], owed: [{ email: 'a@muns.io', next: 0 }], tries: 1 })
    const sendEmail = vi.fn(async (_msg: { email: string; subject: string; html: string }) => ({ ok: true, message: 'sent', messageId: '<root@muns.io>' }))
    await runWeeklyDigest({
      getEpisodes: async () => heavyWeek(),
      subscriberStore: memSubscriberStore(subs('a@muns.io')),
      sendEmail,
      pendingStore: pending.store,
      now: NOW,
    })
    expect(pending.value()).toBeNull()
  })

  it('sends to several recipients at once', async () => {
    let inFlight = 0
    let peak = 0
    const sendEmail = vi.fn(async (_msg: { email: string; subject: string; html: string }) => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { ok: true, message: 'sent', messageId: '<root@muns.io>' }
    })
    const res = await runWeeklyDigest({
      getEpisodes: async () => [ep('e1', 'allin', daysAgo(1))],
      subscriberStore: memSubscriberStore(subs('a@muns.io', 'b@muns.io', 'c@muns.io', 'd@muns.io', 'e@muns.io', 'f@muns.io')),
      sendEmail,
      now: NOW,
    })
    expect(res.body).toMatchObject({ ok: true, sent: 6 })
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4) // bounded, so the endpoint isn't flooded
  })

  it('stops a subscriber at a failed part and counts them as failed', async () => {
    const sendEmail = vi.fn(async (msg: { email: string; subject: string; html: string }) =>
      msg.email === 'a@muns.io' && !('inReplyTo' in msg) ? { ok: false, message: 'rejected' } : { ok: true, message: 'sent', messageId: '<root@muns.io>' },
    )
    const res = await runWeeklyDigest({
      getEpisodes: async () => heavyWeek(),
      subscriberStore: memSubscriberStore(subs('a@muns.io', 'b@muns.io')),
      sendEmail,
      now: NOW,
    })
    const parts = (res.body as { parts?: number }).parts ?? 0
    expect(res.body).toMatchObject({ ok: false, sent: 1, failed: 1 })
    expect(sendEmail.mock.calls.filter(([m]) => m.email === 'a@muns.io')).toHaveLength(1) // no Part 2 after a failed Part 1
    expect(sendEmail.mock.calls.filter(([m]) => m.email === 'b@muns.io')).toHaveLength(parts)
  })

  it('retries a later part the endpoint refused as busy, so a transient failure still completes the brief', async () => {
    let failedOnce = false
    const sendEmail = vi.fn(async (msg: { email: string; subject: string; html: string }) => {
      if (!failedOnce && new RegExp('<title>[^<]*\\(Part 2 of \\d+\\)</title>').test(msg.html)) {
        failedOnce = true
        return { ok: false, message: 'busy', retryable: true }
      }
      return { ok: true, message: 'sent', messageId: '<root@muns.io>' }
    })
    const res = await runWeeklyDigest({
      getEpisodes: async () => heavyWeek(),
      subscriberStore: memSubscriberStore(subs('a@muns.io')),
      sendEmail,
      retryDelayMs: 0,
      now: NOW,
    })
    const parts = (res.body as { parts?: number }).parts ?? 0
    expect(res.body).toMatchObject({ ok: true, sent: 1, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(parts + 1) // every part, plus the one retry
  })

  it('saves what a reader is still owed when a send stops part-way, and the next tick finishes it', async () => {
    const pending = memPendingStore()
    let down = true
    const sendEmail = vi.fn(async (msg: { email: string; subject: string; html: string }) =>
      down && msg.email === 'a@muns.io' && new RegExp('<title>[^<]*\\(Part 2 of \\d+\\)</title>').test(msg.html) ? { ok: false, message: 'timeout' } : { ok: true, message: 'sent', messageId: '<root@muns.io>' },
    )
    const res = await runWeeklyDigest({
      getEpisodes: async () => heavyWeek(),
      subscriberStore: memSubscriberStore(subs('a@muns.io', 'b@muns.io')),
      sendEmail,
      pendingStore: pending.store,
      now: NOW,
    })
    const parts = (res.body as { parts?: number }).parts ?? 0
    expect(res.body).toMatchObject({ ok: false, sent: 1, failed: 1, owed: 1 })
    expect(pending.value()).toMatchObject({ owed: [{ email: 'a@muns.io', next: 1, threadMessageId: '<root@muns.io>' }], tries: 0 })
    expect(pending.value()!.parts).toHaveLength(parts)

    // Next tick: the SAME stored parts, from Part 2 on, to that reader only.
    down = false
    sendEmail.mockClear()
    expect(await resumeOwedParts({ pendingStore: pending.store, sendEmail, retryDelayMs: 0 })).toEqual({ delivered: 1, owed: 0 })
    expect(sendEmail.mock.calls.map(([m]) => m.email)).toEqual(Array(parts - 1).fill('a@muns.io'))
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ inReplyTo: '<root@muns.io>' })
    expect(pending.value()).toBeNull() // cleared once delivered
  })

  it('does not save anything for a reader who got no part at all (nothing half-sent)', async () => {
    const pending = memPendingStore()
    const sendEmail = vi.fn(async (msg: { email: string; subject: string; html: string }) =>
      msg.email === 'a@muns.io' ? { ok: false, message: 'rejected' } : { ok: true, message: 'sent', messageId: '<root@muns.io>' },
    )
    const res = await runWeeklyDigest({
      getEpisodes: async () => heavyWeek(),
      subscriberStore: memSubscriberStore(subs('a@muns.io', 'b@muns.io')),
      sendEmail,
      pendingStore: pending.store,
      now: NOW,
    })
    expect(res.body).toMatchObject({ sent: 1, failed: 1 })
    expect(res.body).not.toHaveProperty('owed')
    expect(pending.value()).toBeNull()
  })

  it('counts failed sends without throwing, and reports ok:false', async () => {
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, message: 'sent', messageId: '<root@muns.io>' })
      .mockResolvedValueOnce({ ok: false, message: 'rejected' })
    const res = await runWeeklyDigest({
      getEpisodes: async () => [ep('e1', 'allin', daysAgo(1))],
      subscriberStore: memSubscriberStore(subs('a@muns.io', 'b@muns.io')),
      sendEmail,
      now: NOW,
    })
    expect(res.body).toMatchObject({ ok: false, sent: 1, failed: 1, recipients: 2 })
  })
})

describe('resumeOwedParts — finishing a split brief on later ticks', () => {
  const parts = [1, 2, 3].map((n) => ({ subject: `S (Part ${n} of 3)`, html: `<p>${n}</p>` }))

  it('is a no-op when nothing is pending', async () => {
    const sendEmail = vi.fn()
    expect(await resumeOwedParts({ pendingStore: memPendingStore().store, sendEmail })).toBeNull()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('keeps what still fails, advancing past what went out, and gives up after MAX_RESUME_TICKS', async () => {
    const pending = memPendingStore({ parts, owed: [{ email: 'a@muns.io', next: 1, threadMessageId: '<root@muns.io>' }], tries: 0 })
    // Part 2 goes out, Part 3 keeps failing.
    const sendEmail = vi.fn(async (msg: { email: string; subject: string; html: string }) => (msg.html === '<p>3</p>' ? { ok: false, message: 'down' } : { ok: true, message: 'sent', messageId: '<reply@muns.io>' }))
    expect(await resumeOwedParts({ pendingStore: pending.store, sendEmail, retryDelayMs: 0 })).toEqual({ delivered: 0, owed: 1 })
    expect(pending.value()).toMatchObject({ owed: [{ email: 'a@muns.io', next: 2 }], tries: 1 })
    expect(pending.value()!.owed[0].threadMessageId).toBe('<root@muns.io>')
    for (let t = 2; t < MAX_RESUME_TICKS; t++) await resumeOwedParts({ pendingStore: pending.store, sendEmail, retryDelayMs: 0 })
    expect(pending.value()).toMatchObject({ tries: MAX_RESUME_TICKS - 1 })
    await resumeOwedParts({ pendingStore: pending.store, sendEmail, retryDelayMs: 0 })
    expect(pending.value()).toBeNull() // given up — never retried forever
    expect(sendEmail.mock.calls.filter(([m]) => m.html === '<p>2</p>')).toHaveLength(1) // Part 2 sent once, not re-sent
  })

  it('never sends an old queued remainder without its root Message-ID', async () => {
    const pending = memPendingStore({ parts, owed: [{ email: 'a@muns.io', next: 1 }], tries: 0 })
    const sendEmail = vi.fn()
    expect(await resumeOwedParts({ pendingStore: pending.store, sendEmail })).toEqual({ delivered: 0, owed: 1 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(pending.value()).toMatchObject({ tries: 1, owed: [{ next: 1 }] })
  })
})

describe('pickPendingThisWeek — the auto-processor target set', () => {
  it('returns ALL in-window pending episodes (NOT one-per-channel like backfill)', () => {
    const eps = [
      pending('a1', 'allin', daysAgo(1)),
      pending('a2', 'allin', daysAgo(2)), // same channel — backfill caps to one; auto-processor keeps both
      pending('o1', 'oddlots', daysAgo(3)),
      pending('old', 'allin', daysAgo(20)), // out of window → excluded
    ]
    const ids = pickPendingThisWeek(eps, NOW).map((e) => e.id)
    expect(ids.sort()).toEqual(['a1', 'a2', 'o1'])
    // contrast: the one-per-channel backfill takes only ONE 'allin' episode
    expect(pickBackfillTargets(eps, NOW).filter((e) => e.podcastId === 'allin')).toHaveLength(1)
  })
  it('excludes already-ready and source-less episodes', () => {
    const eps = [ep('r1', 'allin', daysAgo(1)), ep('x', 'oddlots', daysAgo(1), 'detected')] // ready, and detected-without-source
    expect(pickPendingThisWeek(eps, NOW)).toHaveLength(0)
  })
})

describe('processPendingBatch — bounded auto-processing', () => {
  it('processes up to `limit`, leaves the rest, reports counts', async () => {
    const eps = [pending('a1', 'allin', daysAgo(1)), pending('a2', 'allin', daysAgo(2)), pending('o1', 'oddlots', daysAgo(3))]
    const processEpisode = vi.fn(async () => sum())
    const res = await processPendingBatch({ getEpisodes: async () => eps, processEpisode, now: NOW }, { limit: 2 })
    expect(res).toEqual({ processed: 2, remaining: 1 })
    expect(processEpisode).toHaveBeenCalledTimes(2)
  })
  it('no-ops when nothing is pending', async () => {
    const processEpisode = vi.fn(async () => sum())
    const res = await processPendingBatch({ getEpisodes: async () => [ep('r', 'allin', daysAgo(1))], processEpisode, now: NOW })
    expect(res.processed).toBe(0)
    expect(processEpisode).not.toHaveBeenCalled()
  })
  it('no-ops without a processor (no LLM key)', async () => {
    const res = await processPendingBatch({ getEpisodes: async () => [pending('a', 'allin', daysAgo(1))], now: NOW })
    expect(res.processed).toBe(0)
  })
  it('respects the wall-clock budget before the first episode', async () => {
    const processEpisode = vi.fn(async () => sum())
    const res = await processPendingBatch({ getEpisodes: async () => [pending('a', 'allin', daysAgo(1))], processEpisode, now: NOW }, { budgetMs: -1 })
    expect(res.processed).toBe(0)
    expect(processEpisode).not.toHaveBeenCalled()
  })
})

// A broken auto-processor must never be indistinguishable from an idle one — that
// silence is how it stayed dead. These pin the health signals the cron workflow alarms on.
describe('processPendingBatch — health reporting', () => {
  it('flags a missing LLM key rather than looking idle', async () => {
    const res = await processPendingBatch({ getEpisodes: async () => [pending('a', 'allin', daysAgo(1))], now: NOW })
    expect(res.skipped).toBe('no_llm_key')
  })

  it('flags a missing key even on a tick with nothing pending', async () => {
    // The quiet-tick case: without this, a revoked key only surfaces once a backlog
    // has already built up unprocessed.
    const res = await processPendingBatch({ getEpisodes: async () => [ep('r', 'allin', daysAgo(1))], now: NOW })
    expect(res).toEqual({ processed: 0, remaining: 0, skipped: 'no_llm_key' })
  })

  it('stays silent on a healthy tick — no skipped, no failed', async () => {
    const res = await processPendingBatch(
      { getEpisodes: async () => [pending('a', 'allin', daysAgo(1))], processEpisode: async () => sum(), now: NOW },
      { limit: 5 },
    )
    expect(res).toEqual({ processed: 1, remaining: 0 })
  })

  it('stays silent when there was simply nothing to do', async () => {
    const res = await processPendingBatch(
      { getEpisodes: async () => [ep('r', 'allin', daysAgo(1))], processEpisode: async () => sum(), now: NOW },
    )
    expect(res).toEqual({ processed: 0, remaining: 0 })
  })

  it('counts a thrown episode as failed and keeps going', async () => {
    const eps = [pending('a1', 'allin', daysAgo(1)), pending('a2', 'allin', daysAgo(2))]
    const processEpisode = vi.fn(async (e: { id: string }) => {
      if (e.id === 'a1') throw new Error('provider down')
      return sum()
    })
    const res = await processPendingBatch({ getEpisodes: async () => eps, processEpisode, now: NOW })
    expect(res.processed).toBe(1)
    expect(res.failed).toBe(1)
    expect(processEpisode).toHaveBeenCalledTimes(2) // the throw did not abort the batch
  })

  it('counts an empty summary as failed, not a silent skip', async () => {
    const res = await processPendingBatch({
      getEpisodes: async () => [pending('a', 'allin', daysAgo(1))],
      processEpisode: async () => null,
      now: NOW,
    })
    expect(res).toMatchObject({ processed: 0, failed: 1 })
  })

  it('marks a budget-exhausted batch distinctly from a broken one', async () => {
    const res = await processPendingBatch(
      { getEpisodes: async () => [pending('a', 'allin', daysAgo(1))], processEpisode: async () => sum(), now: NOW },
      { budgetMs: -1 },
    )
    expect(res.skipped).toBe('budget_spent') // NOT no_llm_key — this one is self-healing
  })
})
