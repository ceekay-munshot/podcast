import { afterEach, describe, expect, it, vi } from 'vitest'
import { gateway } from './gateway'
import { GitHub, base64, open, seal, type PreparedResponse, type QueuedRequest } from './protocol'
const secret = base64(new Uint8Array(32).fill(41))
const env = { PODCAST_GITHUB_TOKEN: 'fixture', PODCAST_GATEWAY_KEY: secret, PODCAST_BACKGROUND_ENABLED: '1' }
describe('stateless transport gateway', () => {
  afterEach(() => vi.restoreAllMocks())
  it('does not invoke the Worker native fetch with a GitHub client receiver', async () => {
    const native = vi.spyOn(globalThis, 'fetch').mockImplementation(function (this: unknown) {
      if (this instanceof GitHub) throw new TypeError('Illegal invocation')
      return Promise.resolve(Response.json({ object: { sha: 'state-head' } }))
    })
    expect(await new GitHub('fixture').head()).toBe('state-head')
    expect(native).toHaveBeenCalledTimes(1)
  })
  it('saves an encrypted queue before dispatch and retains work if wakeup fails', async () => {
    vi.spyOn(GitHub.prototype, 'head').mockImplementation(async branch => branch ? null : 'state-head')
    const commit = vi.spyOn(GitHub.prototype, 'commit').mockResolvedValue('queue-commit')
    const publish = vi.spyOn(GitHub.prototype, 'publish').mockResolvedValue()
    const wake = vi.spyOn(GitHub.prototype, 'request').mockRejectedValue(new Error('dispatch unavailable'))
    const body = JSON.stringify({ to: 'private@example.com', parts: [{ subject: 'Week', html: 'complete private content' }] })
    const response = await gateway(new Request('https://podcast-afg.pages.dev/api/email/send', { method: 'POST', body, headers: { 'x-munshot-user': 'alice', 'x-podcast-request-id': 'same-operation', 'content-type': 'application/json' } }), env)
    expect(response.status).toBe(202)
    const result = await response.json() as { job: string }
    const encrypted = commit.mock.calls[0][0]['request.enc']
    expect(encrypted).not.toContain('private@example.com')
    expect(await open<QueuedRequest>(encrypted, secret)).toMatchObject({ id: result.job, user: 'alice', method: 'POST', body: base64(new TextEncoder().encode(body)) })
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(wake.mock.invocationCallOrder[0])
    expect(wake.mock.calls[0][2]).toEqual({ ref: 'main' }) // no private workflow inputs
  })
  it('refuses another user’s saved result', async () => {
    vi.spyOn(GitHub.prototype, 'head').mockResolvedValue('head')
    vi.spyOn(GitHub.prototype, 'file').mockResolvedValue(await seal({ status: 200, body: 'W10=', headers: {}, user: 'alice', preparedAt: Date.now() } satisfies PreparedResponse, secret))
    const response = await gateway(new Request(`https://podcast-afg.pages.dev/api/jobs/${'a'.repeat(64)}`, { headers: { 'x-munshot-user': 'bob' } }), env)
    expect(response.status).toBe(403)
  })
  it('serves the original PDF bytes and requested filename without running a job', async () => {
    vi.spyOn(GitHub.prototype, 'head').mockResolvedValue('head')
    vi.spyOn(GitHub.prototype, 'file').mockResolvedValue(await seal({ status: 200, body: base64(new Uint8Array([0, 255, 13, 10])), headers: { 'content-type': 'application/pdf' }, user: null, preparedAt: 1 } satisfies PreparedResponse, secret))
    const commit = vi.spyOn(GitHub.prototype, 'commit')
    const response = await gateway(new Request(`https://podcast-afg.pages.dev/api/report/${'b'.repeat(40)}?dl=Full%20edition.pdf`), env)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 13, 10])
    expect(response.headers.get('content-disposition')).toContain('Full edition.pdf')
    expect(response.headers.get('x-podcast-runtime')).toBe('github-actions')
    expect(commit).not.toHaveBeenCalled()
  })
  it('rejects foreign origins and the retired Cloudflare cron before queuing anything', async () => {
    const head = vi.spyOn(GitHub.prototype, 'head')
    expect((await gateway(new Request('https://podcast-afg.pages.dev/api/email/send', { method: 'POST', headers: { origin: 'https://elsewhere.example' } }), env)).status).toBe(403)
    expect((await gateway(new Request('https://podcast-afg.pages.dev/api/cron/weekly-digest', { method: 'POST' }), env)).status).toBe(410)
    expect(head).not.toHaveBeenCalled()
  })
})
