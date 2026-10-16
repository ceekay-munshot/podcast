import { describe, expect, it, vi } from 'vitest'
import { GitHubState } from './state'
import { GitHub, STATE_BRANCH, base64, open, opaqueName, seal } from './protocol'
import { durableSender } from './delivery'
import { sendInOrder, type RawEmail } from '../../src/lib/email'
import { resumeOwedParts, type PendingDelivery } from '../weeklyDigest'

const key = base64(new Uint8Array(32).fill(17)), readKey = base64(new Uint8Array(32).fill(29))
function repository() {
  const github = new GitHub('fixture')
  let head: string | null = null
  const commits = new Map<string, Record<string, string>>()
  vi.spyOn(github, 'head').mockImplementation(async () => head)
  vi.spyOn(github, 'file').mockImplementation(async (path, ref) => commits.get(ref)?.[path] ?? null)
  vi.spyOn(github, 'commit').mockImplementation(async (files, parent) => {
    const sha = String(commits.size + 1).padStart(40, '0')
    commits.set(sha, { ...(parent ? commits.get(parent) : {}), ...files }); return sha
  })
  vi.spyOn(github, 'publish').mockImplementation(async branch => { expect(branch).toBe(STATE_BRANCH); head = String(commits.size).padStart(40, '0') })
  vi.spyOn(github, 'commitReceipt').mockImplementation(async (path, content) => {
    const sha = String(commits.size + 1).padStart(40, '0')
    commits.set(sha, { ...(head ? commits.get(head) : {}), [path]: content }); head = sha; return sha
  })
  return { github, commits, state: () => new GitHubState(github, key, readKey, () => 100_000) }
}
describe('encrypted GitHub state migration', () => {
  it('preserves binary values, key names, metadata and expiration across a restart, with no plaintext in published files', async () => {
    const repo = repository(), state = repo.state()
    expect(await state.load()).toBe(false)
    await state.import([{ name: 'weekly:subscribers:v1', value: base64(new TextEncoder().encode('[{"email":"private@example.com"}]')), metadata: { imported: true } }, { name: 'rpt:abc', value: base64(new Uint8Array([0, 255, 13, 10])), expiration: 50 }], '2026-10-16')
    await state.checkpoint()
    const text = JSON.stringify([...repo.commits.values()])
    expect(text).not.toContain('private@example.com'); expect(text).not.toContain('weekly:subscribers')
    const restored = repo.state(); await restored.load()
    expect(await restored.get('weekly:subscribers:v1', 'json')).toEqual([{ email: 'private@example.com' }])
    expect(await restored.get('rpt:abc', 'arrayBuffer')).toBeNull() // TTL read semantics retained
    expect(await restored.record('rpt:abc')).toMatchObject({ value: 'AP8NCg==', expiration: 50 }) // archive never dropped
    expect(await restored.record('weekly:subscribers:v1')).toMatchObject({ metadata: { imported: true } })
    await expect(restored.import([], '')).rejects.toThrow('overwrite')
  })
  it('authenticates ciphertext and isolates private prepared-view names', async () => {
    const text = await seal({ email: 'private@example.com' }, key)
    expect(await open(text, key)).toEqual({ email: 'private@example.com' })
    await expect(open(text, readKey)).rejects.toThrow()
    expect(await opaqueName('alice/api/channels', readKey)).not.toBe(await opaqueName('bob/api/channels', readKey))
  })
})
describe('durable multipart sending', () => {
  it('replays accepted receipts after a runner restart and keeps replies on the original root', async () => {
    const repo = repository(), state = repo.state()
    await state.import([], 'today'); await state.put('initialized', 'yes'); await state.checkpoint()
    const transport = vi.fn().mockResolvedValueOnce({ ok: true, message: 'sent', messageId: '<root@muns.io>' }).mockResolvedValue({ ok: true, message: 'sent', messageId: '<reply@muns.io>' })
    const parts: RawEmail[] = Array.from({ length: 12 }, (_, n) => ({ email: 'reader@example.com', subject: 'Week', html: `<p>Complete part ${n + 1}</p>` }))
    const first = await sendInOrder(parts.slice(0, 3), durableSender(state, key, 'fixture', 'weekly', transport))
    expect(first.sent).toBe(3)
    const restored = repo.state(); await restored.load()
    const sender = durableSender(restored, key, 'fixture', 'weekly', transport)
    const result = await sendInOrder(parts, sender)
    expect(result).toMatchObject({ ok: true, sent: 12, threadMessageId: '<root@muns.io>' })
    expect(transport).toHaveBeenCalledTimes(12) // three accepted parts weren't sent again
    for (const [message] of transport.mock.calls.slice(1)) expect(message.inReplyTo).toBe('<root@muns.io>')
    expect(transport.mock.calls.at(-1)![0].html).toContain('part 12')
  })
  it('does not call the mail service if the pre-send GitHub claim fails', async () => {
    const repo = repository(), state = repo.state(), transport = vi.fn()
    vi.mocked(repo.github.publish).mockRejectedValueOnce(new Error('unavailable'))
    const sender = durableSender(state, key, 'fixture', 'weekly', transport)
    await expect(sender({ email: 'reader@example.com', subject: 'Week', text: 'Body' })).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
  })
  it('retains uncertain delivery and never resends after a restart', async () => {
    const repo = repository(), state = repo.state()
    const transport = vi.fn().mockResolvedValue({ ok: false, message: 'Lost response' })
    const message: RawEmail = { email: 'reader@example.com', subject: 'Week', text: 'Complete body' }
    await durableSender(state, key, 'fixture', 'weekly', transport)(message)
    const restored = repo.state(); await restored.load()
    const result = await durableSender(restored, key, 'fixture', 'weekly', transport)(message)
    expect(result.ok).toBe(false); expect(result.message).toContain('reconciliation')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('safely retries explicit refusals and retains all remaining parts beyond the old six-tick cutoff', async () => {
    let pending: PendingDelivery | null = { durable: true, parts: [{ subject: 'Week', html: 'part 1' }, { subject: 'Week', html: 'part 2' }, { subject: 'Week', html: 'part 3' }], attachments: [{ filename: 'full.pdf', contentType: 'application/pdf', content: 'AA==' }], owed: [{ email: 'reader@example.com', next: 1, threadMessageId: '<original@muns.io>' }], tries: 7 }
    const pendingStore = { get: async () => pending, put: async (value: PendingDelivery | null) => { pending = value } }
    const send = vi.fn().mockResolvedValue({ ok: false, message: 'busy', retryable: true })
    await resumeOwedParts({ pendingStore, sendEmail: send, retryDelayMs: 0 })
    expect(pending).toMatchObject({ tries: 8, owed: [{ next: 1, threadMessageId: '<original@muns.io>' }] })
    send.mockResolvedValue({ ok: true, message: 'sent', messageId: '<reply@muns.io>' })
    await resumeOwedParts({ pendingStore, sendEmail: send, retryDelayMs: 0 })
    expect(pending).toBeNull()
    for (const [message] of send.mock.calls) { expect(message.inReplyTo).toBe('<original@muns.io>'); expect(message.attachments?.[0].filename).toBe('full.pdf') }
  })
})
