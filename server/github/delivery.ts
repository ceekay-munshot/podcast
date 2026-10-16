import { sendRawEmail, validMessageId, type EmailResult, type RawEmail } from '../../src/lib/email'
import { opaqueName } from './protocol'
import type { GitHubState } from './state'

interface Receipt { state: 'claimed' | 'accepted' | 'refused'; result?: EmailResult; at: string }
// One writer workflow + an acknowledged GitHub claim BEFORE provider I/O.
// Unknown outcomes stop for reconciliation: blindly retrying cannot ensure both
// delivery and no duplicates without a provider-supported idempotency contract.
export function durableSender(store: GitHubState, key: string, token: string, scope: string, transport = sendRawEmail) {
  return async (message: RawEmail): Promise<EmailResult> => {
    if (!token || store.failed) throw new Error('Email credentials or durable state are unavailable')
    const normalized = { email: message.email.trim().toLowerCase(), subject: message.subject.trim(), text: message.text ?? null, html: message.html ?? null, inReplyTo: message.inReplyTo ?? null, attachments: message.attachments ?? [] }
    const id = await opaqueName(JSON.stringify([scope, normalized]), key)
    const recordKey = `delivery:v1:${id}`
    const previous = await store.get(recordKey, 'json') as Receipt | null
    if (previous?.state === 'accepted') return previous.result!
    if (previous?.state === 'claimed') return { ok: false, message: 'Delivery confirmation is pending. This part is retained for reconciliation and will not be sent twice.' }
    await store.put(recordKey, JSON.stringify({ state: 'claimed', at: new Date().toISOString() } satisfies Receipt))
    await store.checkpoint()
    const result = await transport(message, { token })
    // A confirmed rejection is safe to retry; a timeout/unknown response is not.
    const state: Receipt['state'] = result.ok ? 'accepted' : result.retryable ? 'refused' : 'claimed'
    await store.put(recordKey, JSON.stringify({ state, result, at: new Date().toISOString() } satisfies Receipt))
    await store.checkpoint()
    if (result.ok && !validMessageId(result.messageId)) {
      // Preserve acceptance even if threading is unavailable. Never resend Part 1.
      return { ...result, message: 'Accepted; transport Message-ID is unavailable.' }
    }
    return result
  }
}
