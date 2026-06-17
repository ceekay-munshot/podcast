import { getLiveEpisodes } from '../../../server/feeds'
import { kvSummaryStore, type KVNamespace } from '../../../server/summaryStore'
import { kvSubscriberStore } from '../../../server/subscriberStore'
import { checkCronAuth, runWeeklyDigest } from '../../../server/weeklyDigest'
import { sendRawEmail } from '../../../src/lib/email'

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
    const result = await runWeeklyDigest({
      getEpisodes: getLiveEpisodes,
      summaryStore,
      subscriberStore,
      // No browser session server-side, so authenticate the send with the service token.
      sendEmail: (msg) => sendRawEmail(msg, { token: env.MUNSHOT_EMAIL_TOKEN }),
    })
    return json(result.status, result.body)
  } catch {
    return json(500, { error: 'digest_failed' })
  }
}
