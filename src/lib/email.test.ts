import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  EMAIL_PART_MAX_BYTES,
  MAX_EMAIL_PARTS,
  episodeBriefEmailHtml,
  readEmailContent,
  sendRawEmail,
  sendRawEmailParts,
  welcomeEmailHtml,
  weeklyBriefEmailHtml,
  weeklyBriefEmailParts,
  bytesToBase64,
  cleanAttachments,
} from './email'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'
import { weeklyReportTitle } from './reportName'

const buf = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0))).buffer

const episodeById = (id: string) => EPISODES.find((e) => e.id === id)
const podcastById = (id: string) => PODCASTS.find((p) => p.id === id)

describe('sendRawEmail — contract + transport', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const ok = () => ({ ok: true, status: 200, json: async () => ({ data: { message: 'Email sent successfully!' }, message: '', success: true }) })

  it('posts to the raw-email endpoint with credentials and a JSON body', async () => {
    fetchMock.mockResolvedValue(ok())
    const res = await sendRawEmail({ email: 'a@b.com', subject: 'Hi', text: 'Body' })

    expect(res).toEqual({ ok: true, message: 'Email sent successfully!' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://devde.muns.io/email/send/raw')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include') // carries the muns.io user token
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.com', subject: 'Hi', text: 'Body' })
  })

  it('sends html (not text) when given html, and trims address/subject', async () => {
    fetchMock.mockResolvedValue(ok())
    await sendRawEmail({ email: '  a@b.com  ', subject: '  Subject  ', html: '<p>Hi</p>' })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ email: 'a@b.com', subject: 'Subject', html: '<p>Hi</p>' })
    expect(body.text).toBeUndefined()
  })

  it('attaches a bearer token when provided', async () => {
    fetchMock.mockResolvedValue(ok())
    await sendRawEmail({ email: 'a@b.com', subject: 'Hi', text: 'B' }, { token: 'tok_123' })
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok_123')
  })

  it('uses the confirmed root Message-ID for both reply headers', async () => {
    fetchMock.mockResolvedValue({ ...ok(), json: async () => ({ success: true, data: { messageId: '<reply@muns.io>' } }) })
    expect(await sendRawEmail({ email: 'a@b.com', subject: 'S', html: '<p>2</p>', inReplyTo: '<root@muns.io>' })).toMatchObject({ messageId: '<reply@muns.io>' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'a@b.com', subject: 'S', html: '<p>2</p>', inReplyTo: '<root@muns.io>', references: ['<root@muns.io>'] })
  })

  it('rejects unsafe reply IDs before making a request', async () => {
    for (const id of ['root@muns.io', '<root@muns.io>\r\nBcc: someone@else.io', '<a b@muns.io>', `<${'x'.repeat(1000)}@muns.io>`]) {
      expect(await sendRawEmail({ email: 'a@b.com', subject: 'S', text: 'T', inReplyTo: id })).toMatchObject({ ok: false })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces exactly one of text|html — rejects both, neither, and missing fields WITHOUT calling fetch', async () => {
    expect(await sendRawEmail({ email: 'a@b.com', subject: 'S', text: 'T', html: '<p>H</p>' } as never)).toMatchObject({ ok: false })
    expect(await sendRawEmail({ email: 'a@b.com', subject: 'S' } as never)).toMatchObject({ ok: false })
    expect(await sendRawEmail({ email: '', subject: 'S', text: 'T' })).toMatchObject({ ok: false })
    expect(await sendRawEmail({ email: 'a@b.com', subject: '', text: 'T' })).toMatchObject({ ok: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a non-2xx / unsuccessful response as a failure (best-effort, no throw)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized', success: false }) })
    const res = await sendRawEmail({ email: 'a@b.com', subject: 'Hi', text: 'B' })
    expect(res.ok).toBe(false)
    expect(res.message).toBe('Unauthorized')
  })

  it('degrades quietly when the network/CORS blocks the call', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await sendRawEmail({ email: 'a@b.com', subject: 'Hi', text: 'B' })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/couldn't reach/i)
  })

  it('includes attachments in the body when provided', async () => {
    fetchMock.mockResolvedValue(ok())
    const attachments = [{ filename: 'Munshot AI Podcasts.pdf', content: 'TWFu', contentType: 'application/pdf' }]
    await sendRawEmail({ email: 'a@b.com', subject: 'S', html: '<p>h</p>', attachments })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.attachments).toEqual(attachments)
  })

  it('omits the attachments key when empty — byte-for-byte the historical contract', async () => {
    fetchMock.mockResolvedValue(ok())
    await sendRawEmail({ email: 'a@b.com', subject: 'S', text: 'T', attachments: [] })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect('attachments' in body).toBe(false)
    expect(body).toEqual({ email: 'a@b.com', subject: 'S', text: 'T' })
  })
})

describe('sendRawEmailParts — a split brief, in order', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const reply = (success: boolean, message: string, status = success ? 200 : 500) => ({ ok: success, status, json: async () => ({ success, message, data: { messageId: '<root@muns.io>' } }) })
  const parts = [1, 2, 3].map((n) => ({ email: 'a@b.com', subject: `S (Part ${n} of 3)`, html: `<p>${n}</p>` }))

  it('sends every part in order', async () => {
    fetchMock.mockResolvedValue(reply(true, 'Email sent successfully!'))
    expect(await sendRawEmailParts(parts)).toMatchObject({ ok: true })
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).subject)).toEqual(['S', 'S', 'S'])
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies[0]).not.toHaveProperty('inReplyTo')
    expect(bodies.slice(1).map(b => [b.inReplyTo, b.references])).toEqual(Array(2).fill(['<root@muns.io>', ['<root@muns.io>']]))
  })

  it('keeps replying to the first part even when each reply returns a different ID', async () => {
    for (const id of ['root', 'reply-2', 'reply-3']) fetchMock.mockResolvedValueOnce({ ...reply(true, 'sent'), json: async () => ({ success: true, data: { messageId: `<${id}@muns.io>` } }) })
    expect(await sendRawEmailParts(parts)).toMatchObject({ ok: true, sent: 3, threadMessageId: '<root@muns.io>' })
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).inReplyTo)).toEqual([undefined, '<root@muns.io>', '<root@muns.io>'])
  })

  it('stops after Part 1 when its response has no valid Message-ID', async () => {
    for (const id of [undefined, 'not-an-id', '<bad\n@muns.io>']) {
      fetchMock.mockReset().mockResolvedValue({ ...reply(true, 'sent'), json: async () => ({ success: true, data: { messageId: id } }) })
      expect(await sendRawEmailParts(parts)).toMatchObject({ ok: false, sent: 1 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('resumes even a single remaining part using the stored root, and retries definite refusals', async () => {
    fetchMock.mockResolvedValueOnce(reply(false, 'busy', 503)).mockResolvedValueOnce(reply(true, 'sent'))
    expect(await sendRawEmailParts(parts.slice(2), { threadMessageId: '<original@muns.io>', retryDelayMs: 0 })).toMatchObject({ ok: true, sent: 1, threadMessageId: '<original@muns.io>' })
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).inReplyTo)).toEqual(['<original@muns.io>', '<original@muns.io>'])
  })

  it('rejects unrelated recipients or editions and legacy continuations without a root', async () => {
    expect(await sendRawEmailParts([parts[0], { ...parts[1], email: 'other@b.com' }])).toMatchObject({ ok: false, sent: 0 })
    expect(await sendRawEmailParts([parts[0], { ...parts[1], subject: 'Another edition' }])).toMatchObject({ ok: false, sent: 0 })
    expect(await sendRawEmailParts(parts.slice(1))).toMatchObject({ ok: false, sent: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves a single episode subject containing a part label', async () => {
    fetchMock.mockResolvedValue(reply(true, 'sent'))
    const chapter = { email: 'a@b.com', subject: 'Podcast episode (Part 2 of 3)', text: 'Summary' }
    expect(await sendRawEmailParts([chapter])).toMatchObject({ ok: true, sent: 1 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject).toBe(chapter.subject)
    fetchMock.mockClear()
    expect(await sendRawEmailParts([parts[2]], { threaded: true })).toMatchObject({ ok: false, sent: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-sends a later part the endpoint refused as busy (429/503), so a hiccup never strands half the brief', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, 'ok')).mockResolvedValueOnce(reply(false, 'busy', 503)).mockResolvedValue(reply(true, 'ok'))
    expect(await sendRawEmailParts(parts, { retryDelayMs: 0 })).toMatchObject({ ok: true, sent: 3 })
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).subject)).toEqual(['S', 'S', 'S', 'S'])
  })

  it('never re-sends a part that may already have been delivered (a 5xx or lost response)', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, 'ok')).mockResolvedValueOnce(reply(false, 'gateway timeout', 504))
    expect(await sendRawEmailParts(parts, { retryDelayMs: 0 })).toEqual({ ok: false, message: 'Sent 1 of 3 parts — gateway timeout', sent: 1, threadMessageId: '<root@muns.io>' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // no retry of Part 2, and Part 3 never goes out without Part 2
    fetchMock.mockReset().mockResolvedValueOnce(reply(true, 'ok')).mockRejectedValueOnce(new Error('connection reset'))
    expect(await sendRawEmailParts(parts, { retryDelayMs: 0 })).toMatchObject({ ok: false, sent: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up on a later part still refused after two retries, and says how far it got', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, 'ok')).mockResolvedValue(reply(false, 'rate limited', 429))
    expect(await sendRawEmailParts(parts, { retryDelayMs: 0 })).toMatchObject({ ok: false, message: 'Sent 1 of 3 parts — rate limited', sent: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(4) // Part 1, then Part 2 + 2 retries
  })

  it('does not retry Part 1 — failing there leaves nothing half-sent', async () => {
    fetchMock.mockResolvedValue(reply(false, 'busy', 503))
    expect(await sendRawEmailParts(parts, { retryDelayMs: 0 })).toMatchObject({ ok: false, message: 'busy', sent: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('readEmailContent — proxy request body', () => {
  it('reads the single-message form', () => {
    expect(readEmailContent({ subject: 'S', html: '<p>h</p>' })).toEqual([{ subject: 'S', html: '<p>h</p>' }])
    expect(readEmailContent({ subject: 'S', text: 'T' })).toEqual([{ subject: 'S', text: 'T' }])
  })

  it('reads an ordered parts list', () => {
    const parts = [
      { subject: 'S (Part 1 of 2)', html: '<p>1</p>' },
      { subject: 'S (Part 2 of 2)', html: '<p>2</p>' },
    ]
    expect(readEmailContent({ parts })).toEqual(parts)
  })

  it('rejects a malformed message or parts list', () => {
    expect(readEmailContent({ subject: 'S' })).toBeNull() // neither text nor html
    expect(readEmailContent({ subject: 'S', text: 'T', html: '<p>h</p>' })).toBeNull() // both
    expect(readEmailContent({ subject: 'a\r\nBcc: x@y.z', html: '<p>h</p>' })).toBeNull() // header injection
    expect(readEmailContent({ parts: [] })).toBeNull()
    expect(readEmailContent({ parts: 'nope' })).toBeNull()
    expect(readEmailContent({ parts: [{ subject: 'ok', html: '<p>1</p>' }, { subject: 'bad\n', html: '<p>2</p>' }] })).toBeNull()
    expect(readEmailContent({ parts: Array.from({ length: MAX_EMAIL_PARTS + 1 }, () => ({ subject: 'S', html: '<p>h</p>' })) })).toBeNull()
  })
})

describe('bytesToBase64', () => {
  it('encodes with correct padding for every remainder', () => {
    expect(bytesToBase64(buf(''))).toBe('')
    expect(bytesToBase64(buf('M'))).toBe('TQ==') // 1 byte → 2 pad
    expect(bytesToBase64(buf('Ma'))).toBe('TWE=') // 2 bytes → 1 pad
    expect(bytesToBase64(buf('Man'))).toBe('TWFu') // 3 bytes → none
    expect(bytesToBase64(buf('Munshot'))).toBe('TXVuc2hvdA==')
  })

  it('handles high bytes (round-trips through atob)', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x25]).buffer
    const b64 = bytesToBase64(bytes)
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    expect([...back]).toEqual([0x00, 0xff, 0x80, 0x7f, 0x25])
  })
})

describe('cleanAttachments — hardening', () => {
  const a = (over: Record<string, unknown> = {}) => ({ filename: 'f.pdf', content: 'TWFu', contentType: 'application/pdf', ...over })

  it('returns [] for non-arrays', () => {
    expect(cleanAttachments(undefined)).toEqual([])
    expect(cleanAttachments('nope')).toEqual([])
  })

  it('keeps valid entries and strips whitespace from base64 content', () => {
    expect(cleanAttachments([a({ content: 'TW\nFu ' })])).toEqual([a({ content: 'TWFu' })])
  })

  it('drops entries missing fields, with CRLF in filename/type, or non-base64 content', () => {
    expect(cleanAttachments([{ filename: 'f', content: 'TWFu' }])).toEqual([]) // no contentType
    expect(cleanAttachments([a({ filename: 'a\nb' })])).toEqual([])
    expect(cleanAttachments([a({ contentType: 'x\r\ny' })])).toEqual([])
    expect(cleanAttachments([a({ content: 'not base64!' })])).toEqual([])
  })

  it('caps the number of attachments at 5', () => {
    expect(cleanAttachments(Array.from({ length: 8 }, () => a()))).toHaveLength(5)
  })
})

describe('welcomeEmailHtml', () => {
  it('is a branded, self-contained HTML email (inline styles, greets by first name)', () => {
    const html = welcomeEmailHtml({ name: 'Asha Iyer' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Hi Asha,') // first name only
    expect(html).toContain("You're subscribed")
    expect(html).toContain('#14233c') // navy house colour
    expect(html).toContain('#b8902f') // gold
    expect(html).not.toContain('<style') // Gmail strips <style>; everything must be inline
  })

  it('falls back to a neutral greeting with no name', () => {
    expect(welcomeEmailHtml()).toContain('Hello,')
  })
})

describe('weeklyBriefEmailHtml — real edition rendering', () => {
  const html = weeklyBriefEmailHtml(WEEKLY, episodeById, podcastById)

  it('renders the header, date range, and the synthesised Guidepoint sections', () => {
    expect(html).toContain('Weekly Summary')
    expect(html).toContain(WEEKLY.rangeLabel)
    expect(html).toContain('Overview')
    expect(html).toContain('Key Points') // synthesised cross-episode body
    expect(html).toContain('Quantitative Summary') // the hard-numbers table
    expect(html).toContain('Power, not silicon, is the binding constraint') // a key theme heading
  })

  it('drives back to the chat.muns.io dashboard with a CTA + linked citations + linked sources', () => {
    expect(html).toContain('https://chat.muns.io/dashboards') // the dashboard URL
    expect(html).toContain('Open the live dashboard') // the primary CTA
    // Inline [n] citations are turned into links back to the dashboard.
    expect(html).toMatch(/<a href="https:\/\/chat\.muns\.io\/dashboards"[^>]*>\[\d+\]<\/a>/)
    // Source rows link back too.
    expect(html).toContain('Open all of these on your Munshot dashboard')
  })

  it('shows the Download PDF button only when a report URL is provided', () => {
    expect(html).not.toContain('Download PDF')
    const withPdf = weeklyBriefEmailHtml(WEEKLY, episodeById, podcastById, { pdfUrl: 'https://example.test/api/report/abc.pdf' })
    expect(withPdf).toContain('Download PDF')
    expect(withPdf).toContain('https://example.test/api/report/abc.pdf')
  })

  it('falls back to the by-show body when there are no synthesised key themes', () => {
    const noThemes = weeklyBriefEmailHtml({ ...WEEKLY, keyThemes: [] }, episodeById, podcastById)
    expect(noThemes).toContain('By Show')
    expect(noThemes).toContain('All-In')
    expect(noThemes).toContain('Long Nvidia (NVDA) into the capex supercycle')
  })

  it('promotes **bold** to gold <strong> and keeps everything inline (no class selectors)', () => {
    expect(html).toContain(`<strong style="color:#b8902f`) // emphasis rule, inlined
    expect(html).not.toContain('class="')
  })

  it('escapes HTML-special characters in content', () => {
    const hostile = {
      ...WEEKLY,
      interesting: { ...WEEKLY.interesting, quote: 'A <script>alert(1)</script> & "co"' },
    }
    const out = weeklyBriefEmailHtml(hostile, episodeById, podcastById)
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<script>alert(1)</script>')
  })
})

describe("weeklyBriefEmailParts — splitting a long edition under Gmail's clip", () => {
  const pdfUrl = 'https://example.test/api/report/abc.pdf'
  const title = weeklyReportTitle(WEEKLY.rangeLabel)
  const bytes = (s: string) => new TextEncoder().encode(s).length
  // A 25-episode week: the readouts and sources are what push a real edition past
  // Gmail's ~102KB clip. Names are unique so each piece can be tracked across parts.
  const readouts = Array.from({ length: 5 }, (_, k) => WEEKLY.episodeReadouts!.map((r, i) => ({ ...r, episode: `Readout ${k}-${i}` }))).flat()
  const BIG = { ...WEEKLY, episodeReadouts: readouts }

  it('sends a short edition as ONE email, byte-identical to the single-document render', () => {
    const parts = weeklyBriefEmailParts(WEEKLY, episodeById, podcastById, { pdfUrl })
    expect(parts).toEqual([{ subject: title, html: weeklyBriefEmailHtml(WEEKLY, episodeById, podcastById, { pdfUrl }) }])
    expect(parts[0].html).not.toContain('Part 1 of')
  })

  it('splits a long edition into standalone emails, each under the byte budget', () => {
    expect(bytes(weeklyBriefEmailHtml(BIG, episodeById, podcastById, { pdfUrl }))).toBeGreaterThan(EMAIL_PART_MAX_BYTES)
    const parts = weeklyBriefEmailParts(BIG, episodeById, podcastById, { pdfUrl })
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) {
      expect(bytes(p.html)).toBeLessThanOrEqual(EMAIL_PART_MAX_BYTES)
      expect(p.html.startsWith('<!doctype html>')).toBe(true)
      expect(p.html.trimEnd().endsWith('</html>')).toBe(true)
      // A table split across parts is closed in one and re-opened in the next.
      expect(p.html.split('<table').length).toBe(p.html.split('</table>').length)
    }
  })

  it('titles each part and keeps the dashboard CTA + the full-PDF download in every one', () => {
    const parts = weeklyBriefEmailParts(BIG, episodeById, podcastById, { pdfUrl })
    const n = parts.length
    parts.forEach((p, i) => {
      expect(p.subject).toBe(title)
      expect(p.html).toContain(`Part ${i + 1} of ${n}`) // header chip + notice
      expect(p.html).toContain('Open the live dashboard')
      expect(p.html).toContain('Download PDF')
      expect(p.html).toContain(pdfUrl) // the SAME, complete PDF in every part
      if (i < n - 1) expect(p.html).toContain(`Continued in Part ${i + 2} of ${n}`)
      else expect(p.html).not.toContain('Continued in Part')
    })
  })

  it('keeps every piece exactly once, in order, re-opening a split section as "(continued)"', () => {
    const parts = weeklyBriefEmailParts(BIG, episodeById, podcastById, { pdfUrl })
    const all = parts.map((p) => p.html).join('')
    let from = 0
    for (const r of readouts) {
      expect(all.split(`>${r.episode}<`).length - 1).toBe(2) // its table row + its card, never dropped or repeated
      const at = all.indexOf(`>${r.episode}<`, from)
      expect(at).toBeGreaterThanOrEqual(from)
      from = at
    }
    expect(all).toContain('(continued)')
    expect(parts[0].html).toContain('>Overview<')
    expect(parts.slice(1).some((p) => p.html.includes('>Overview<'))).toBe(false)
    expect(parts[parts.length - 1].html).toContain('Open all of these on your Munshot dashboard')
  })

  it('stands a pointer to the full edition in for a block too big for any one email', () => {
    const huge = { ...WEEKLY, episodeReadouts: [{ ...WEEKLY.episodeReadouts![0], evidence: 'A runaway paragraph. '.repeat(6_000) }, ...WEEKLY.episodeReadouts!.slice(1)] }
    const parts = weeklyBriefEmailParts(huge, episodeById, podcastById, { pdfUrl })
    for (const p of parts) expect(bytes(p.html)).toBeLessThanOrEqual(EMAIL_PART_MAX_BYTES)
    const all = parts.map((p) => p.html).join('')
    expect(all).not.toContain('A runaway paragraph.')
    expect(all).toContain('too long to show in an email')
    expect(all).toContain(`>${WEEKLY.episodeReadouts![1].episode}<`) // the rest of the section still goes out
  })

  it('never returns more parts than the proxy accepts, ending on a pointer to the full edition', () => {
    const parts = weeklyBriefEmailParts(BIG, episodeById, podcastById, { pdfUrl, maxBytes: 12_000 })
    expect(parts).toHaveLength(MAX_EMAIL_PARTS)
    expect(readEmailContent({ parts })).not.toBeNull() // sendable through /api/email/send
    const last = parts[parts.length - 1]
    expect(last.subject).toBe(title)
    expect(last.html).not.toContain('Continued in Part')
    expect(last.html).toContain("That's all that fits in email")
    expect(last.html).toContain(pdfUrl)
    for (const p of parts) expect(bytes(p.html)).toBeLessThanOrEqual(12_000)
  })

  it('respects a tighter budget by using more parts', () => {
    const parts = weeklyBriefEmailParts(BIG, episodeById, podcastById, { pdfUrl, maxBytes: 25_000 })
    expect(parts.length).toBeGreaterThan(weeklyBriefEmailParts(BIG, episodeById, podcastById, { pdfUrl }).length)
    for (const p of parts) expect(bytes(p.html)).toBeLessThanOrEqual(25_000)
  })
})

describe('episodeBriefEmailHtml — single episode rendering', () => {
  const episode = EPISODES.find((e) => e.summary)!
  const podcast = podcastById(episode.podcastId)
  const html = episodeBriefEmailHtml(episode, podcast)

  it('is a branded, self-contained HTML email in the weekly house style (all inline)', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain(episode.title) // the subject/hero title
    expect(html).toContain('AI Summary') // the lead section, mirroring the Word/PDF export
    expect(html).toContain('Episode Intelligence') // episode-specific header kicker
    expect(html).toContain('#14233c') // navy house colour
    expect(html).toContain('#b8902f') // gold
    expect(html).not.toContain('<style') // Gmail strips <style>; everything must be inline
    expect(html).not.toContain('class="') // no class selectors survive email clients
  })

  it('drives back to the chat.muns.io dashboard with the same CTA as the weekly brief', () => {
    expect(html).toContain('https://chat.muns.io/dashboards')
    expect(html).toContain('Open the live dashboard')
  })

  it('returns an empty string for an episode with no summary (nothing to send)', () => {
    const bare = EPISODES.find((e) => !e.summary)
    if (bare) expect(episodeBriefEmailHtml(bare, podcastById(bare.podcastId))).toBe('')
    // And explicitly for a stripped episode, regardless of the mock set.
    expect(episodeBriefEmailHtml({ ...episode, summary: undefined }, podcast)).toBe('')
  })

  it('escapes HTML-special characters in episode content', () => {
    const hostile = { ...episode, title: 'A <script>alert(1)</script> & "co"' }
    const out = episodeBriefEmailHtml(hostile, podcast)
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<script>alert(1)</script>')
  })
})
