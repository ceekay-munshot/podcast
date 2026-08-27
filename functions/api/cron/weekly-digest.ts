import { SEED_IDS, getAllEpisodes, getLiveEpisodes, parseMemberFeeds } from '../../../server/feeds'
import { collectTrackedChannels } from '../../../server/channelStore'
import { kvSummaryStore, type KVNamespace } from '../../../server/summaryStore'
import { kvSubscriberStore } from '../../../server/subscriberStore'
import { kvReportStore, reportUrl } from '../../../server/reportStore'
import { checkCronAuth, processPendingBatch, runWeeklyDigest } from '../../../server/weeklyDigest'
import { DEFAULT_SCHEDULE, dueToSend, kvScheduleStore } from '../../../server/scheduleStore'
import { sendRawEmail } from '../../../src/lib/email'
import { weeklyPdfBytes } from '../../../src/lib/pdfRender'

// Cloudflare Pages Function → /api/cron/weekly-digest (production).
// The Monday weekly-brief send. Pages can't run cron, so a scheduled GitHub
// Actions workflow POSTs here every Monday with the shared CRON_SECRET; this
// builds one shared edition (server/weeklyDigest.ts) and mails every subscriber.
//
// Env:
//   SUMMARIES          — KV namespace (shared summary cache + subscriber list)
//   CRON_SECRET        — required; the bearer token the workflow must present
//   MUNSHOT_EMAIL_TOKEN— service token for server-to-server sends. There is no
//                        user session in a cron, so the raw-email endpoint must
//                        accept this token; without it, sends will be rejected.
interface CronEnv {
  SUMMARIES?: KVNamespace
  CRON_SECRET?: string
  MUNSHOT_EMAIL_TOKEN?: string
  // LLM keys (already on this Pages project for /api/summary) — let the digest run
  // the SAME cross-episode synthesis the on-screen weekly uses.
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  SUMMARY_MODEL?: string
  // Opt-in Claude-via-Bedrock path (server/bedrock.ts) — same toggle as /api/summary.
  LLM_PROVIDER?: string
  temp_claude_token?: string
  BEDROCK_MODEL_ID?: string
  BEDROCK_REGION?: string
  // The deployed origin (e.g. https://podcast-afg.pages.dev) — required to build an
  // absolute, click-from-an-inbox link to the hosted PDF (a cron has no request).
  SITE_URL?: string
  // Set to "1" to ALSO attach the weekly PDF to each brief (not just link it). Leave
  // unset until the raw-email endpoint accepts an `attachments` field — otherwise the
  // extra field is simply never sent.
  EMAIL_ATTACHMENTS?: string
  // Optional "<showId>=<feedUrl>" list of member feeds. The digest is the one path
  // with no user session, so a paid show's episodes can only reach the emailed
  // brief through this. Read the MEMBER_FEEDS note in server/feeds.ts first — it
  // puts one subscriber's paid audio in a SHARED edition.
  MEMBER_FEEDS?: string
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export const onRequest = async (context: { request: Request; env: CronEnv }): Promise<Response> => {
  const { request, env } = context
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!checkCronAuth(request.headers.get('authorization'), env.CRON_SECRET)) return json(401, { error: 'unauthorized' })

  try {
    // The workflow now pings every 30 min; gate the actual send on the user's chosen
    // day/time/timezone (DEFAULT_SCHEDULE = the old Mon 13:00 UTC until one is set).
    // `?force=1` (a manual workflow_dispatch) bypasses the gate to send immediately.
    const force = new URL(request.url).searchParams.get('force') === '1'
    const scheduleStore = env.SUMMARIES ? kvScheduleStore(env.SUMMARIES) : null
    const summaryStore = env.SUMMARIES ? kvSummaryStore(env.SUMMARIES) : undefined
    const summarizeConfig = {
      openaiKey: env.OPENAI_API_KEY,
      anthropicKey: env.ANTHROPIC_API_KEY,
      model: env.SUMMARY_MODEL || undefined,
      store: summaryStore,
      llmProvider: env.LLM_PROVIDER,
      bedrockKey: env.temp_claude_token,
      bedrockModel: env.BEDROCK_MODEL_ID || undefined,
      bedrockRegion: env.BEDROCK_REGION || undefined,
    }

    // Auto-process the week, sustainably: on EVERY tick, summarise a bounded batch of
    // this week's pending episodes (writes to the shared store). Over the ticks the
    // backlog clears on its own, so nobody has to press "Process all" — that button
    // is only ever a "catch up right now" shortcut. Bounded so a tick never exceeds
    // the curl budget.
    //
    // The universe is the seed sources PLUS every user-added channel across the
    // stored rosters. Without the second half, anything added from Discover was
    // invisible here and its episodes sat "detected" forever, however many ticks ran.
    const memberFeeds = parseMemberFeeds(env.MEMBER_FEEDS)
    // Rotate the roster window per tick so a roster longer than CHANNELS_PER_TICK is
    // still covered completely, just spread over consecutive ticks.
    const tick = Math.floor(Date.now() / (30 * 60 * 1000))
    const channels = env.SUMMARIES ? await collectTrackedChannels(env.SUMMARIES, SEED_IDS).catch(() => []) : []
    const channelTitles = new Map(channels.map((c) => [c.id, c.title]))
    const batch = await processPendingBatch(
      {
        getEpisodes: (store?: typeof summaryStore) => getAllEpisodes(store, memberFeeds, channels, { offset: tick }),
        summaryStore,
        summarizeConfig,
        resolveShow: (id) => channelTitles.get(id),
      },
      { limit: 10, budgetMs: 150_000 },
      // A thrown batch used to be swallowed into {processed:0, remaining:0} — byte-for-byte
      // what a healthy idle tick looks like. Report the reason so the workflow can alarm.
    ).catch((e) => ({ processed: 0, remaining: 0, error: String(e).slice(0, 200) }))

    // The EMAILED edition stays seed-only. It is one edition shared by every
    // subscriber, and PODCASTS (the show lookup it renders from) knows only the seed
    // shows — so folding one user's private additions in here would both break the
    // lookup and put their channels in everyone else's inbox. Their episodes are
    // still summarised above, so the app shows them ready.
    const getEpisodes = (store?: typeof summaryStore) => getLiveEpisodes(store, memberFeeds)

    let sentMarker: string | null = null
    if (!force) {
      // No store ⇒ can't gate or de-dupe ⇒ refuse to send (but the batch above still ran).
      if (!scheduleStore) return json(200, { ok: true, skipped: 'no_schedule_store', batch, channels: channels.length })
      const schedule = (await scheduleStore.getSchedule()) ?? DEFAULT_SCHEDULE
      const gate = dueToSend(schedule, new Date(), await scheduleStore.getLastSent())
      if (!gate.due) return json(200, { ok: true, skipped: 'not_scheduled', schedule, batch, channels: channels.length })
      sentMarker = gate.dateStr
    }

    const subscriberStore = env.SUMMARIES ? kvSubscriberStore(env.SUMMARIES) : null
    // Host the PDF only when we can build an absolute link to it (KV + SITE_URL).
    const reportStore = env.SUMMARIES && env.SITE_URL ? kvReportStore(env.SUMMARIES) : null
    const siteUrl = env.SITE_URL
    const attachPdf = env.EMAIL_ATTACHMENTS === '1'
    const result = await runWeeklyDigest({
      getEpisodes,
      summaryStore,
      subscriberStore,
      // No browser session server-side, so authenticate the send with the service token.
      sendEmail: (msg) => sendRawEmail(msg, { token: env.MUNSHOT_EMAIL_TOKEN }),
      summarizeConfig,
      // Render the PDF when it will be used: hosted as a link (needs KV + origin) and/or
      // attached to the email (needs only the bytes).
      ...(reportStore && siteUrl
        ? {
            generatePdf: (weekly, episodeById, podcastById) => weeklyPdfBytes(weekly, episodeById, podcastById),
            storePdf: async (bytes, downloadName) => reportUrl(siteUrl, await reportStore.put(bytes), downloadName),
          }
        : attachPdf
          ? { generatePdf: (weekly, episodeById, podcastById) => weeklyPdfBytes(weekly, episodeById, podcastById) }
          : {}),
      attachPdf,
    })
    // Claim this week's slot only once an edition was actually built + mailed, so a
    // later tick the same day won't re-send; a skip (no subscribers / no ready
    // episodes) stays unmarked so a transient gap can still retry on the next tick.
    if (sentMarker && scheduleStore) {
      const recipients = (result.body as { recipients?: number }).recipients
      if (typeof recipients === 'number' && recipients > 0) await scheduleStore.setLastSent(sentMarker)
    }
    return json(result.status, { ...result.body, batch, channels: channels.length })
  } catch {
    return json(500, { error: 'digest_failed' })
  }
}
