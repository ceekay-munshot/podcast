import type { Episode, Podcast } from '../../src/lib/types'
import { PODCASTS } from '../../src/lib/mock-data'
import { assembleWeekly, hashKey, mergeWeeklyAi } from '../../src/lib/weeklyAssemble'
import { weeklyBriefEmailParts, validMessageId, type EmailResult, type RawEmail } from '../../src/lib/email'
import { weeklyReportFilename } from '../../src/lib/reportName'
import { kvSubscriberStore } from '../subscriberStore'
import { kvSummaryStore, sharedSummaryKey } from '../summaryStore'
import { readyThisWeek, resumeOwedParts, type PendingDelivery } from '../weeklyDigest'
import { opaqueName } from './protocol'
import type { GitHubState } from './state'
import type { weeklyPdfBytes } from '../../src/lib/pdfRender'

interface Acceptance { part: number; messageId?: string; inReplyTo?: string }
interface TestEdition {
  selector: string
  pdfUrl: string
  episodeCount: number
  pending: PendingDelivery | null
  parts: number
  subject: string
  accepted: Acceptance[]
  completedAt?: string
}
interface Deps {
  id: string
  selector: string
  stateKey: string
  getEpisodes: () => Promise<Episode[]>
  generatePdf: typeof weeklyPdfBytes
  /** Must publish and verify the complete PDF before returning its URL. */
  publishPdf: (bytes: ArrayBuffer, filename: string) => Promise<string>
  /** A durable sender scoped to this test ID, independent of scheduled mail. */
  sendEmail: (message: RawEmail) => Promise<EmailResult>
  now?: number
}

/** A manual, single-subscriber delivery check. No model calls, subscriber edits,
 *  schedule markers or regular delivery remainders are touched. Reusing an ID
 *  resumes the frozen edition through durable receipts, never a fresh resend. */
export async function testNewsletter(state: Pick<GitHubState, 'get' | 'put' | 'checkpoint'>, deps: Deps) {
  if (!/^[a-f0-9-]{36}$/.test(deps.id) || !/^[a-f0-9]{64}$/.test(deps.selector)) throw new Error('Invalid test request')
  const key = `newsletter-test:v1:${deps.id}`
  let edition = await state.get(key, 'json') as TestEdition | null
  if (edition && edition.selector !== deps.selector) throw new Error('Test recipient cannot change')
  const save = async () => { await state.put(key, JSON.stringify(edition)); await state.checkpoint() }
  if (!edition) {
    const subscribers = await kvSubscriberStore(state).get()
    const matches = []
    for (const subscriber of subscribers ?? []) {
      if (await opaqueName(`newsletter-test:${subscriber.email.trim().toLowerCase()}`, deps.stateKey) === deps.selector) matches.push(subscriber)
    }
    if (matches.length !== 1) throw new Error('Test must identify exactly one existing subscriber')
    const ready = readyThisWeek(await deps.getEpisodes(), deps.now ?? Date.now())
    if (!ready.length) throw new Error('No saved ready episodes for this week')
    const podcastById = (id: string): Podcast | undefined => PODCASTS.find(p => p.id === id)
    const episodeById = (id: string) => ready.find(e => e.id === id)
    let weekly = assembleWeekly(ready, podcastById)
    // Reuse an existing weekly synthesis if available; never invoke a provider.
    const cached = await kvSummaryStore(state).get(sharedSummaryKey(`weekly:${hashKey(ready)}`))
    if (cached?.weekly) weekly = mergeWeeklyAi(weekly, cached.weekly)
    const bytes = await deps.generatePdf(weekly, episodeById, podcastById)
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Complete PDF generation failed')
    const pdfUrl = await deps.publishPdf(bytes, weeklyReportFilename(weekly.rangeLabel))
    if (!/^https:\/\//.test(pdfUrl)) throw new Error('A verified hosted PDF is required')
    let parts = weeklyBriefEmailParts(weekly, episodeById, podcastById, { pdfUrl })
    // Exercise threading even when this week's edition fits in one normal email.
    for (let maxBytes = 35_000; parts.length < 2 && maxBytes >= 4_375; maxBytes /= 2) {
      parts = weeklyBriefEmailParts(weekly, episodeById, podcastById, { pdfUrl, maxBytes })
    }
    if (parts.length < 2) throw new Error('Test edition must contain multiple complete parts')
    const subject = `[TEST ${deps.id.slice(0, 8)}] ${parts[0].subject}`
    edition = { selector: deps.selector, pdfUrl, episodeCount: ready.length, parts: parts.length, subject, accepted: [], pending: {
      parts: parts.map(part => ({ ...part, subject })), owed: [{ email: matches[0].email, next: 0 }], tries: 0, durable: true,
    } }
    await save()
  }
  if (!edition.completedAt) {
    const frozen = edition
    await resumeOwedParts({
      pendingStore: {
        get: async () => frozen.pending,
        put: async pending => { frozen.pending = pending; if (!pending) frozen.completedAt = new Date().toISOString(); await save() },
      },
      sendEmail: async message => {
        const part = frozen.pending!.parts.findIndex(p => p.html === message.html && p.subject === message.subject) + 1
        if (!part) throw new Error('Only frozen test parts may be sent')
        const result = await deps.sendEmail(message)
        if (result.ok) {
          frozen.accepted = [...frozen.accepted.filter(p => p.part !== part), { part, messageId: result.messageId, inReplyTo: message.inReplyTo }].sort((a, b) => a.part - b.part)
          await save()
        }
        return result
      },
    })
  }
  const root = validMessageId(edition.accepted[0]?.messageId)
  const threaded = !!root && edition.accepted.slice(1).every(p => p.inReplyTo === root)
  return { ok: !!edition.completedAt && edition.accepted.length === edition.parts && threaded, testId: deps.id,
    subject: edition.subject, parts: edition.parts, acceptedParts: edition.accepted.length,
    episodeCount: edition.episodeCount, pdfUrl: edition.pdfUrl, threadMessageId: root, threaded,
    owed: edition.pending?.owed.length ?? 0 }
}
