import { getLiveEpisodes } from '../../../server/feeds'
import { kvSummaryStore, type KVNamespace } from '../../../server/summaryStore'
import { kvSubscriberStore } from '../../../server/subscriberStore'
import { kvReportStore, reportUrl } from '../../../server/reportStore'
import { checkCronAuth, runWeeklyDigest } from '../../../server/weeklyDigest'
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
  // The deployed origin (e.g. https://podcast-afg.pages.dev) — required to build an
  // absolute, click-from-an-inbox link to the hosted PDF (a cron has no request).
  SITE_URL?: string
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export const onRequest = async (context: { request: Request; env: CronEnv }): Promise<Response> => {
  const { request, env } = context
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!checkCronAuth(request.headers.get('authorization'), env.CRON_SECRET)) return json(401, { error: 'unauthorized' })

  try {
    const summaryStore = env.SUMMARIES ? kvSummaryStore(env.SUMMARIES) : undefined
    const subscriberStore = env.SUMMARIES ? kvSubscriberStore(env.SUMMARIES) : null
    // Host the PDF only when we can build an absolute link to it (KV + SITE_URL).
    const reportStore = env.SUMMARIES && env.SITE_URL ? kvReportStore(env.SUMMARIES) : null
    const siteUrl = env.SITE_URL
    const result = await runWeeklyDigest({
      getEpisodes: getLiveEpisodes,
      summaryStore,
      subscriberStore,
      // No browser session server-side, so authenticate the send with the service token.
      sendEmail: (msg) => sendRawEmail(msg, { token: env.MUNSHOT_EMAIL_TOKEN }),
      summarizeConfig: { openaiKey: env.OPENAI_API_KEY, anthropicKey: env.ANTHROPIC_API_KEY, model: env.SUMMARY_MODEL || undefined, store: summaryStore },
      ...(reportStore && siteUrl
        ? {
            generatePdf: (weekly, episodeById, podcastById) => weeklyPdfBytes(weekly, episodeById, podcastById),
            storePdf: async (bytes) => reportUrl(siteUrl, await reportStore.put(bytes)),
          }
        : {}),
    })
    return json(result.status, result.body)
  } catch {
    return json(500, { error: 'digest_failed' })
  }
}
