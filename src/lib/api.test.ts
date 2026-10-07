import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emailWeeklyEdition } from './api'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'

// The PDF render is jsPDF — irrelevant here, and slow; any bytes will do.
vi.mock('./pdfRender', () => ({ weeklyPdfBytes: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer) }))

const episodeById = (id: string) => EPISODES.find((e) => e.id === id)
const podcastById = (id: string) => PODCASTS.find((p) => p.id === id)

describe('emailWeeklyEdition — a split brief that stops part-way', () => {
  // Long enough to split into several emails.
  const BIG = { ...WEEKLY, episodeReadouts: Array.from({ length: 5 }, () => WEEKLY.episodeReadouts!).flat() }
  const fetchMock = vi.fn()
  const reply = (body: object, status = 200) => ({ ok: status < 300, status, json: async () => body })
  const sends = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/email/send')).map(([, init]) => JSON.parse(init.body) as { parts?: { subject: string }[]; threadMessageId?: string })

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/api/report') ? reply({ url: 'https://x.test/r/1.pdf' }) : reply({ ok: true, message: 'sent' })))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retrying sends only the parts that never went out, then starts fresh next time', async () => {
    fetchMock.mockImplementationOnce(async () => reply({ url: 'https://x.test/r/1.pdf' })) // PDF hosting
    fetchMock.mockImplementationOnce(async () => reply({ ok: false, message: 'Sent 1 of 2 parts — busy', sent: 1, threadMessageId: '<root@muns.io>' }, 502))
    const first = await emailWeeklyEdition('a@muns.io', BIG, episodeById, podcastById)
    expect(first.ok).toBe(false)
    expect(first.message).toBe('Sent 1 of 2 parts — busy. Try again to send the remaining parts.')
    const all = sends()[0].parts!
    expect(all.length).toBeGreaterThan(1)

    fetchMock.mockClear()
    const retry = await emailWeeklyEdition('a@muns.io', BIG, episodeById, podcastById)
    expect(retry.ok).toBe(true)
    expect(sends()[0].threadMessageId).toBe('<root@muns.io>')
    expect(sends()[0].parts!.map((p) => p.subject)).toEqual(all.slice(1).map((p) => p.subject)) // no Part 1 again
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/report'))).toBe(false) // same parts, no re-render

    fetchMock.mockClear()
    await emailWeeklyEdition('a@muns.io', BIG, episodeById, podcastById)
    expect(sends()[0].parts).toHaveLength(all.length) // done → a later send is a whole new brief
  })

  it('a failure before any part went out leaves nothing to resume', async () => {
    fetchMock.mockImplementationOnce(async () => reply({ url: 'https://x.test/r/1.pdf' }))
    fetchMock.mockImplementationOnce(async () => reply({ ok: false, message: 'Please wait a moment before emailing this address again.' }, 429))
    const res = await emailWeeklyEdition('b@muns.io', BIG, episodeById, podcastById)
    expect(res.message).toBe('Please wait a moment before emailing this address again.')
    fetchMock.mockClear()
    await emailWeeklyEdition('b@muns.io', BIG, episodeById, podcastById)
    expect(sends()[0].parts!.length).toBeGreaterThan(1)
    expect(sends()[0].parts![0].subject).not.toContain('(Part ')
  })
})
