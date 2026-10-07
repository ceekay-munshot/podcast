import { describe, it, expect, vi, afterEach } from 'vitest'
import { onRequestPost } from '../functions/api/email/send'

const request = (body: object) => new Request('https://podcast.pages.dev/api/email/send', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://chat.muns.io' }, body: JSON.stringify(body),
})

describe('email proxy — one conversation per multipart edition', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the root on a partial send and uses it on a later one-part resume', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, data: { messageId: '<first@muns.io>' } }))
      .mockResolvedValueOnce(Response.json({ success: false, message: 'unavailable' }, { status: 504 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { messageId: '<second@muns.io>' } }))
    vi.stubGlobal('fetch', send)
    const parts = [{ subject: 'Week', html: '<p>1</p>' }, { subject: 'Week', html: '<p>2</p>' }]
    const first = await onRequestPost({ request: request({ to: 'reader@muns.io', parts }), env: { MUNSHOT_EMAIL_TOKEN: 'fixture-token' } })
    expect(first.status).toBe(502)
    expect(await first.json()).toMatchObject({ ok: false, sent: 1, threadMessageId: '<first@muns.io>' })
    const resumed = await onRequestPost({ request: request({ to: 'reader@muns.io', parts: parts.slice(1), threadMessageId: '<first@muns.io>' }), env: { MUNSHOT_EMAIL_TOKEN: 'fixture-token' } })
    expect(resumed.status).toBe(200)
    const bodies = send.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies.map(b => b.subject)).toEqual(['Week', 'Week', 'Week'])
    expect(bodies[0]).not.toHaveProperty('inReplyTo')
    for (const body of bodies.slice(1)) expect(body).toMatchObject({ inReplyTo: '<first@muns.io>', references: ['<first@muns.io>'] })
  })

  it('rejects unsafe resume headers before rate-limit storage or transport', async () => {
    const send = vi.fn(), get = vi.fn(), put = vi.fn()
    vi.stubGlobal('fetch', send)
    const response = await onRequestPost({ request: request({ to: 'reader@muns.io', subject: 'S', text: 'T', threadMessageId: '<a@muns.io>\r\nBcc: other@else.io' }), env: { SUMMARIES: { get, put } } })
    expect(response.status).toBe(400)
    expect(send).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })
})
