import { describe, it, expect, vi } from 'vitest'
import type { Episode, Summary } from '../src/lib/types'
import { checkCronAuth, readyThisWeek, runWeeklyDigest } from './weeklyDigest'
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

const memSubscriberStore = (list: Subscriber[] | null): SubscriberStore => ({
  get: async () => list,
  put: async () => {},
})

const subs = (...emails: string[]): Subscriber[] => emails.map((email) => ({ email, addedAt: 'x' }))

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

describe('runWeeklyDigest', () => {
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
    const sendEmail = vi.fn(async (_msg: { email: string; subject: string; html: string }) => ({ ok: true, message: 'sent' }))
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
    expect(calls[0][0].subject).toContain('Munshot Weekly')
    expect(calls[0][0].html).toContain('Weekly Summary')
  })

  it('counts failed sends without throwing, and reports ok:false', async () => {
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, message: 'sent' })
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
