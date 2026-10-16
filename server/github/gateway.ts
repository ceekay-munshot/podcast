import { USER_HEADER, userKeyFrom } from '../identity'
import { contentDispositionInline } from '../../src/lib/reportName'
import { GitHub, GitHubError, QUEUE_PREFIX, STATE_BRANCH, base64, open, opaqueName, seal, unbase64, viewIdentity, type PreparedResponse, type QueuedRequest } from './protocol'

export interface GatewayEnv { PODCAST_GITHUB_TOKEN?: string; PODCAST_GATEWAY_KEY?: string; SITE_URL?: string; PODCAST_BACKGROUND_ENABLED?: string }
const json = (status: number, value: unknown) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
const MAX_BODY = 12_000_000
async function boundedBody(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new Error('too_large')
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  if (reader) for (;;) {
    const item = await reader.read(); if (item.done) break
    size += item.value.length
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('too_large') }
    chunks.push(item.value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
export async function gateway(request: Request, env: GatewayEnv): Promise<Response> {
  if (!env.PODCAST_GITHUB_TOKEN || !env.PODCAST_GATEWAY_KEY || env.PODCAST_BACKGROUND_ENABLED !== '1') return json(503, { error: 'migration_not_enabled' })
  const url = new URL(request.url), user = userKeyFrom(request.headers.get(USER_HEADER)), secret = env.PODCAST_GATEWAY_KEY
  if (url.pathname.startsWith('/api/cron/')) return json(410, { error: 'background_work_moved_to_github' })
  // Retain the existing identity boundary and reject foreign browser mutations.
  const origin = request.headers.get('origin')
  if (origin && !new Set([url.origin, env.SITE_URL, 'https://chat.muns.io', 'https://muns.io']).has(origin)) return json(403, { error: 'forbidden_origin' })
  const github = new GitHub(env.PODCAST_GITHUB_TOKEN)
  try {
    const head = await github.head()
    if (!head) return json(503, { error: 'state_not_imported' })
    const job = /^\/api\/jobs\/([a-f0-9]{64})$/.exec(url.pathname)
    if (job) {
      const text = await github.file(`jobs/${job[1]}.enc`, head)
      if (!text) return json(202, { pending: true, job: job[1] })
      const response = await open<PreparedResponse>(text, secret)
      if (response.user !== user) return json(403, { error: 'forbidden' })
      return prepared(response)
    }
    if (!/^\/api\/(channels|processed|episodes|summary|search-podcasts|resolve-video|email\/send|report(?:\/[a-f0-9]{40}(?:\.pdf)?)?|schedule\/weekly|subscriptions\/weekly)$/.test(url.pathname)) return json(404, { error: 'not_found' })
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) return json(405, { error: 'method_not_allowed' })
    // Reports use content-hash IDs and preserve all existing inbox links.
    const path = url.pathname + (url.pathname.startsWith('/api/report/') ? '' : url.search)
    const view = `views/${await opaqueName(viewIdentity('GET', path, url.pathname.startsWith('/api/report/') ? null : user), secret)}.enc`
    let cached: PreparedResponse | null = null
    if (request.method === 'GET') {
      const text = await github.file(view, head)
      if (text) cached = await open<PreparedResponse>(text, secret)
      if (cached && (Date.now() - cached.preparedAt < 900_000 || url.pathname.startsWith('/api/report/'))) return prepared(cached, url.searchParams.get('dl'))
    }
    const body = base64(await boundedBody(request))
    // A stale GET has one durable refresh request per 15-minute window. Browser
    // mutations carry an idempotency key retained throughout polling/retries.
    const nonce = request.method === 'GET' ? String(Math.floor(Date.now() / 900_000)) : request.headers.get('x-podcast-request-id') || crypto.randomUUID()
    if (nonce.length > 100) return json(400, { error: 'invalid_request_id' })
    const id = await opaqueName(JSON.stringify([request.method, path, user, body, nonce]), secret)
    const branch = `${QUEUE_PREFIX}${id}`
    if (!await github.head(branch)) {
      const queued: QueuedRequest = { id, method: request.method, path, user, body, contentType: request.headers.get('content-type') || '', createdAt: Date.now() }
      const sha = await github.commit({ 'request.enc': await seal(queued, secret) }, null, 'Queue encrypted podcast request')
      try { await github.publish(branch, sha, false) } catch (error) { if (!(error instanceof GitHubError && error.status === 422)) throw error }
      // Dispatch only after a durable queue acknowledgement. Scheduled ticks also
      // drain every outstanding queue ref, so a lost dispatch cannot lose work.
      await github.request('actions/workflows/weekly-digest.yml/dispatches', 'POST', { ref: 'main' }).catch(() => undefined)
    }
    return cached ? prepared(cached) : json(202, { pending: true, job: id })
  } catch (error) {
    const status = error instanceof Error && error.message === 'too_large' ? 413 : 503
    const code = error instanceof GitHubError ? `github_${error.status}` : error instanceof Error ? error.name : 'unknown'
    // Diagnostic class only: never return request bodies, user keys or secrets.
    return Response.json({ error: 'github_gateway_unavailable', code }, { status, headers: { 'cache-control': 'no-store' } })
  }
}
function prepared(value: PreparedResponse, downloadName?: string | null): Response {
  const headers = new Headers(value.headers)
  headers.set('cache-control', 'no-store')
  headers.set('x-podcast-runtime', 'github-actions')
  if (downloadName && headers.get('content-type') === 'application/pdf') headers.set('content-disposition', contentDispositionInline(downloadName))
  return new Response(unbase64(value.body), { status: value.status, headers })
}
