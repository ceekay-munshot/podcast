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

  const reply = (success: boolean, message: string) => ({ ok: success, status: success ? 200 : 500, json: async () => ({ success, message }) })
  const parts = [1, 2, 3].map((n) => ({ email: 'a@b.com', subject: `S (Part ${n} of 3)`, html: `<p>${n}</p>` }))

  it('sends every part in order', async () => {
    fetchMock.mockResolvedValue(reply(true, 'Email sent successfully!'))
    expect(await sendRawEmailParts(parts)).toMatchObject({ ok: true })
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).subject)).toEqual(['S (Part 1 of 3)', 'S (Part 2 of 3)', 'S (Part 3 of 3)'])
  })

  it('stops at the first failed part and says how far it got', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, 'ok')).mockResolvedValueOnce(reply(false, 'rejected'))
    expect(await sendRawEmailParts(parts)).toEqual({ ok: false, message: 'Sent 1 of 3 parts — rejected' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // Part 3 never goes out without Part 2
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
      expect(p.subject).toBe(`${title} (Part ${i + 1} of ${n})`)
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
