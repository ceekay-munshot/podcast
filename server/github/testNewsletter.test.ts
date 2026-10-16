import { describe, expect, it, vi } from 'vitest'
import type { Episode } from '../../src/lib/types'
import type { RawEmail } from '../../src/lib/email'
import { durableSender } from './delivery'
import { opaqueName } from './protocol'
import type { GitHubState } from './state'
import { testNewsletter } from './testNewsletter'

const secret = Buffer.alloc(32, 7).toString('base64')
const id = '4fa76771-41b4-42ea-9e16-a1be19bc1937'
const now = Date.parse('2026-10-16T13:00:00Z')
function fixture() {
  const initial = {
    'weekly:subscribers:v1': JSON.stringify([{ email: 'owner@example.com', addedAt: 'today' }, { email: 'other@example.com', addedAt: 'today' }]),
    'weekly:last-sent:v1': '2026-10-12', 'weekly:schedule:v1': '{"dayOfWeek":1}',
    'weekly:pending-delivery:v1': '{"untouched":true}',
  }
  const rows = new Map<string, string>(Object.entries(initial))
  const state = {
    failed: false,
    get: vi.fn(async (key: string, type?: string) => { const value = rows.get(key); return value === undefined ? null : type === 'json' ? JSON.parse(value) : value }),
    put: vi.fn(async (key: string, value: string) => { rows.set(key, value) }),
    checkpoint: vi.fn(async () => {}),
  } as unknown as GitHubState
  const episodes: Episode[] = Array.from({ length: 3 }, (_, n) => ({
    id: `episode-${n}`, podcastId: 'allin', title: `Full source ${n}`, publishedAt: '2026-10-15', durationSec: 100,
    status: 'ready', signal: 'normal', blurb: 'Saved real content', entities: { people: [], companies: [], themes: [] },
    summary: { synthesis: [`Complete insight ${n}. `.repeat(400)], highlights: [{ id: `h${n}`, title: `Final highlight ${n}`, timestamp: '1:00', detail: `Evidence ${n}`, key: true }], qa: [{ q: `Final question ${n}`, a: `Complete answer ${n}` }] },
  }))
  const transport = vi.fn(async (_message: RawEmail) => ({ ok: true, message: 'accepted', messageId: `<part-${transport.mock.calls.length}@example.com>` }))
  const deps = {
    id, selector: '', stateKey: secret, now,
    getEpisodes: vi.fn(async () => episodes),
    generatePdf: vi.fn(async () => new TextEncoder().encode('%PDF-1.4 complete edition').buffer),
    publishPdf: vi.fn(async () => 'https://podcast.example/api/report/full.pdf'),
    sendEmail: durableSender(state, secret, 'fixture-token', `podcast-test:${id}`, transport),
  }
  return { state, rows, initial, transport, deps }
}

describe('single-subscriber manual newsletter', () => {
  it('sends every complete part on one root, publishes the PDF first, and reusing the ID sends nothing twice', async () => {
    const f = fixture()
    f.deps.selector = await opaqueName('newsletter-test:owner@example.com', secret)
    f.transport.mockImplementation(async message => {
      expect(f.deps.publishPdf).toHaveBeenCalledOnce()
      expect(f.rows.has(`newsletter-test:v1:${id}`)).toBe(true)
      expect(message.email).toBe('owner@example.com')
      return { ok: true, message: 'accepted', messageId: `<part-${f.transport.mock.calls.length}@example.com>` }
    })
    const result = await testNewsletter(f.state, f.deps)
    expect(result.ok).toBe(true)
    expect(result.parts).toBeGreaterThan(1)
    expect(f.transport).toHaveBeenCalledTimes(result.parts)
    const messages = f.transport.mock.calls.map(call => call[0])
    expect(new Set(messages.map(m => m.subject)).size).toBe(1)
    expect(messages.every(m => m.subject.startsWith('[TEST '))).toBe(true)
    expect(messages[0].inReplyTo).toBeUndefined()
    expect(messages.slice(1).every(m => m.inReplyTo === '<part-1@example.com>')).toBe(true)
    expect(messages.every(m => m.html?.includes(result.pdfUrl))).toBe(true)
    expect(messages.map(m => m.html).join('')).toContain('Final question 2')
    expect(await testNewsletter(f.state, f.deps)).toEqual(result)
    expect(f.transport).toHaveBeenCalledTimes(result.parts)
    expect(f.deps.getEpisodes).toHaveBeenCalledOnce()
    for (const [key, value] of Object.entries(f.initial)) expect(f.rows.get(key)).toBe(value)
  })

  it('sends nothing if the recipient does not match or the complete PDF cannot be published', async () => {
    const f = fixture()
    f.deps.selector = '0'.repeat(64)
    await expect(testNewsletter(f.state, f.deps)).rejects.toThrow('exactly one')
    f.deps.selector = await opaqueName('newsletter-test:owner@example.com', secret)
    f.deps.publishPdf.mockRejectedValue(new Error('PDF unavailable'))
    await expect(testNewsletter(f.state, f.deps)).rejects.toThrow('PDF unavailable')
    expect(f.transport).not.toHaveBeenCalled()
  })

  it('retains a lost provider response without resending that part or losing the original root', async () => {
    const f = fixture()
    f.deps.selector = await opaqueName('newsletter-test:owner@example.com', secret)
    f.transport.mockResolvedValueOnce({ ok: true, message: 'accepted', messageId: '<original@example.com>' }).mockRejectedValue(new Error('lost response'))
    const first = await testNewsletter(f.state, f.deps)
    expect(first).toMatchObject({ ok: false, acceptedParts: 1, owed: 1, threadMessageId: '<original@example.com>' })
    const resumed = await testNewsletter(f.state, f.deps)
    expect(resumed).toMatchObject({ ok: false, acceptedParts: 1, owed: 1, threadMessageId: '<original@example.com>' })
    expect(f.transport).toHaveBeenCalledTimes(2)
    expect(f.deps.publishPdf).toHaveBeenCalledOnce()
  })
})
