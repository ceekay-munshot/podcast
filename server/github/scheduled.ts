import { SEED_IDS, getAllEpisodes, getLiveEpisodes, parseMemberFeeds } from '../feeds'
import { collectTrackedChannels } from '../channelStore'
import { kvSummaryStore } from '../summaryStore'
import { kvSubscriberStore } from '../subscriberStore'
import { kvReportStore, reportUrl } from '../reportStore'
import { PENDING_DELIVERY_KEY, processPendingBatch, resumeOwedParts, runWeeklyDigest, type PendingDelivery, type PendingDeliveryStore } from '../weeklyDigest'
import { DEFAULT_SCHEDULE, dueToSend, kvScheduleStore } from '../scheduleStore'
import { weeklyPdfBytes } from '../../src/lib/pdfRender'
import type { GitHubState } from './state'
import type { RunnerEnv } from './router'

export async function scheduledTick(state: GitHubState, env: RunnerEnv) {
  if (!env.MUNSHOT_EMAIL_TOKEN || !(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || (env.LLM_PROVIDER === 'claude' && env.temp_claude_token))) throw new Error('Required email/model credentials are missing')
  const pendingStore: PendingDeliveryStore = {
    get: async () => {
      const value = await state.get(PENDING_DELIVERY_KEY, 'json') as PendingDelivery | null
      return value ? { ...value, durable: true } : null
    },
    put: async value => { await state.put(PENDING_DELIVERY_KEY, JSON.stringify(value ? { ...value, durable: true } : null)); await state.checkpoint() },
  }
  // Browser wakeups must not increase paid model usage beyond the old maximum
  // of one ten-episode batch per 30 minutes. Claim the time bucket durably.
  const bucket = String(Math.floor(Date.now() / 1_800_000))
  if (await state.get('runner:last-background-bucket:v1') === bucket) return { ok: true, skipped: 'already_processed_this_tick', batch: { processed: 0, remaining: 0 } }
  await state.put('runner:last-background-bucket:v1', bucket)
  await state.checkpoint()
  // Includes the migrated legacy remainder with its exact next index and root ID.
  const resumed = await resumeOwedParts({ pendingStore, sendEmail: env.SEND_EMAIL })
  const summaryStore = kvSummaryStore(state)
  const summarizeConfig = { openaiKey: env.OPENAI_API_KEY, anthropicKey: env.ANTHROPIC_API_KEY, model: env.SUMMARY_MODEL, store: summaryStore, llmProvider: env.LLM_PROVIDER, bedrockKey: env.temp_claude_token, bedrockModel: env.BEDROCK_MODEL_ID, bedrockRegion: env.BEDROCK_REGION }
  const memberFeeds = parseMemberFeeds(env.MEMBER_FEEDS)
  const channels = await collectTrackedChannels(state, SEED_IDS)
  const titles = new Map(channels.map(channel => [channel.id, channel.title]))
  const batch = await processPendingBatch({ getEpisodes: store => getAllEpisodes(store, memberFeeds, channels, { offset: Math.floor(Date.now() / 1_800_000) }), summaryStore, summarizeConfig, resolveShow: id => titles.get(id) }, { limit: 10, budgetMs: 150_000 })
  await state.checkpoint()
  if ((await pendingStore.get())?.owed.length) return { ok: false, skipped: 'delivery_needs_attention', owed: resumed?.owed, batch }
  const schedules = kvScheduleStore(state)
  const schedule = (await schedules.getSchedule()) ?? DEFAULT_SCHEDULE
  const gate = dueToSend(schedule, new Date(), await schedules.getLastSent())
  if (!gate.due) return { ok: true, skipped: 'not_scheduled', batch, resumed }
  const reports = kvReportStore(state)
  const result = await runWeeklyDigest({
    getEpisodes: store => getLiveEpisodes(store, memberFeeds), summaryStore,
    subscriberStore: kvSubscriberStore(state), pendingStore, sendEmail: env.SEND_EMAIL,
    summarizeConfig, durableDelivery: true, attachPdf: env.EMAIL_ATTACHMENTS === '1',
    generatePdf: weeklyPdfBytes,
    storePdf: async (bytes, filename) => reportUrl(env.SITE_URL, await reports.put(bytes), filename),
    // The frozen edition is saved first. Claim the schedule before sending;
    // interrupted runs finish the saved edition instead of generating a new one.
    // No separate commit: pendingStore.put publishes the marker AND exact
    // frozen edition in the same atomic GitHub state commit before any send.
    onDeliveryPrepared: async () => { await schedules.setLastSent(gate.dateStr) },
  })
  await state.checkpoint()
  return { ...result.body, batch, resumed }
}
