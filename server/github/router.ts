import * as channels from '../api/channels'
import * as processed from '../api/processed'
import * as episodes from '../api/episodes'
import * as summary from '../api/summary'
import * as search from '../api/search-podcasts'
import * as video from '../api/resolve-video'
import * as schedule from '../api/schedule/weekly'
import * as subscribers from '../api/subscriptions/weekly'
import * as email from '../api/email/send'
import * as report from '../api/report/index'
import * as reportRead from '../api/report/[id]'
import type { KVNamespace } from '../summaryStore'
import type { EmailResult, RawEmail } from '../../src/lib/email'

export interface RunnerEnv {
  SUMMARIES: KVNamespace; SITE_URL: string; SEND_EMAIL: (message: RawEmail) => Promise<EmailResult>
  OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; SUMMARY_MODEL?: string
  GROQ_API_KEY?: string; DEEPGRAM_API_KEY?: string; DEEPGRAM_MODEL?: string
  LLM_PROVIDER?: string; temp_claude_token?: string; BEDROCK_MODEL_ID?: string; BEDROCK_REGION?: string
  EMAIL_ATTACHMENTS?: string; MEMBER_FEEDS?: string; MUNSHOT_EMAIL_TOKEN?: string
}
export async function route(request: Request, env: RunnerEnv): Promise<Response> {
  const path = new URL(request.url).pathname, method = request.method
  const context = { request, env }
  if (path === '/api/channels') return channels.onRequest(context)
  if (path === '/api/processed') return processed.onRequest(context)
  if (path === '/api/schedule/weekly') return schedule.onRequest(context)
  if (path === '/api/subscriptions/weekly') return subscribers.onRequest(context)
  if (path === '/api/episodes' && method === 'GET') return episodes.onRequestGet(context)
  if (path === '/api/summary' && method === 'POST') return summary.onRequestPost(context)
  if (path === '/api/search-podcasts' && method === 'GET') return search.onRequestGet(context)
  if (path === '/api/resolve-video' && method === 'GET') return video.onRequestGet(context)
  if (path === '/api/email/send' && method === 'POST') return email.onRequestPost(context)
  if (path === '/api/report' && method === 'POST') return report.onRequestPost(context)
  const match = /^\/api\/report\/([a-f0-9]{40})(?:\.pdf)?$/.exec(path)
  if (match && method === 'GET') return reportRead.onRequestGet({ ...context, params: { id: match[1] } })
  return Response.json({ error: 'not_found' }, { status: 404 })
}
