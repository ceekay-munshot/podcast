import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendRawEmail, welcomeEmailHtml, weeklyBriefEmailHtml } from './email'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'

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

  it('renders the header, date range, and by-show content from the real summary', () => {
    expect(html).toContain('Weekly Summary')
    expect(html).toContain(WEEKLY.rangeLabel)
    expect(html).toContain('By Show')
    expect(html).toContain('All-In')
    expect(html).toContain('Ideas Pitched')
    expect(html).toContain('Long Nvidia (NVDA) into the capex supercycle')
    expect(html).toContain('David Sacks')
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
