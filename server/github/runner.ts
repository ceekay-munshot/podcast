import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { USER_HEADER } from '../identity'
import { contentDispositionInline } from '../../src/lib/reportName'
import { kvSummaryStore } from '../summaryStore'
import { GitHub, QUEUE_PREFIX, STATE_BRANCH, base64, open, opaqueName, unbase64, viewIdentity, type PreparedResponse, type QueuedRequest } from './protocol'
import { GitHubState, type ArchivedRecord } from './state'
import { durableSender } from './delivery'
import { route, type RunnerEnv } from './router'
import { scheduledTick } from './scheduled'
import { testNewsletter } from './testNewsletter'
import { kvReportStore, reportUrl } from '../reportStore'
import { weeklyPdfBytes } from '../../src/lib/pdfRender'
import type { Episode } from '../../src/lib/types'

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value }
const github = new GitHub(required('GH_TOKEN'))
const stateKey = required('PODCAST_STATE_KEY'), gatewayKey = required('PODCAST_GATEWAY_KEY')
const state = new GitHubState(github, stateKey, gatewayKey)
const loaded = await state.load()
const mode = process.argv[2] || 'tick'
const env: RunnerEnv = {
  ...process.env, SUMMARIES: state, SITE_URL: process.env.SITE_URL || 'https://podcast-afg.pages.dev',
  SEND_EMAIL: durableSender(state, stateKey, process.env.MUNSHOT_EMAIL_TOKEN || '', 'podcast-delivery-v1'),
}
async function responseRecord(response: Response, user: string | null): Promise<PreparedResponse> {
  const headers: Record<string, string> = {}
  for (const name of ['content-type', 'content-disposition']) { const value = response.headers.get(name); if (value) headers[name] = value }
  return { status: response.status, headers, body: base64(new Uint8Array(await response.arrayBuffer())), preparedAt: Date.now(), user }
}
async function view(path: string, user: string | null, response?: Response) {
  const headers = user ? { [USER_HEADER]: user } : undefined
  const result = response ?? await route(new Request(new URL(path, env.SITE_URL), { headers }), env)
  await state.prepared(`views/${await opaqueName(viewIdentity('GET', path, user), gatewayKey)}.enc`, await responseRecord(result, user))
}
async function prepareStoredViews() {
  // No network or model calls: these routes read only the imported GitHub data.
  const users = new Set<string | null>([null])
  for (const name of state.names()) { const match = /^u:(.*):(?:channels|processed):v1$/.exec(name); if (match) users.add(match[1]) }
  for (const user of users) for (const path of ['/api/channels', '/api/processed', '/api/schedule/weekly', '/api/subscriptions/weekly']) await view(path, user)
  for (const name of state.names().filter(name => name.startsWith('rpt:'))) {
    const id = name.slice(4), path = `/api/report/${id}`
    // Preserve imported reports even when their former Cloudflare TTL elapses.
    const row = await state.record(name)
    for (const alias of [path, `${path}.pdf`]) {
      const viewPath = `views/${await opaqueName(viewIdentity('GET', alias, null), gatewayKey)}.enc`
      // Content-hash reports are immutable. Don't rewrite/re-encrypt megabytes
      // of unchanged PDFs on every tick (Git history would retain every copy).
      if (row && !await state.preparedRecord(viewPath)) await view(alias, null, new Response(unbase64(row.value), { headers: { 'content-type': 'application/pdf', 'content-disposition': contentDispositionInline(null) } }))
    }
  }
  await state.checkpoint()
}
if (mode === 'import') {
  if (loaded) throw new Error('Existing state found; import refuses to overwrite it')
  let archiveText: string
  if (process.env.PODCAST_IMPORT_FILE) archiveText = readFileSync(process.env.PODCAST_IMPORT_FILE, 'utf8')
  else {
    // Migration verification runs on GitHub too. The staging branch contains
    // only a compressed, encrypted snapshot, never plaintext source data.
    const snapshot = await github.file('snapshot.enc', 'codex/podcast-migration-snapshot')
    if (!snapshot) throw new Error('The encrypted migration snapshot is missing')
    const payload = await open<{ gzip: string }>(snapshot, stateKey)
    archiveText = gunzipSync(unbase64(payload.gzip)).toString('utf8')
  }
  const archive = JSON.parse(archiveText) as { records: ArchivedRecord[]; exportedAt: string }
  for (const row of archive.records) {
    if (!row.sha256) throw new Error('Import requires byte hashes for every record')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', unbase64(row.value))), b => b.toString(16).padStart(2, '0')).join('')
    if (hash !== row.sha256) throw new Error('Imported record hash mismatch')
  }
  await state.import(archive.records, archive.exportedAt)
  await prepareStoredViews()
  console.log(JSON.stringify({ imported: archive.records.length, prepared: true }))
} else {
  if (!loaded) throw new Error('Migration snapshot is not imported; refusing an empty state')
  if (mode === 'prepare') { await prepareStoredViews(); await view('/api/episodes', null); await state.checkpoint(); console.log(JSON.stringify({ prepared: true })); }
  else if (mode === 'verify') {
    // Purely read-only, no model calls, no sends and no state commits.
    let reports = 0, verified = 0
    for (const name of state.names()) {
      const row = await state.record(name); if (!row) throw new Error('Missing archived record')
      if (row.sha256) {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', unbase64(row.value))), b => b.toString(16).padStart(2, '0')).join('')
        if (hash !== row.sha256) throw new Error('Archived value hash mismatch')
      }
      if (name.startsWith('rpt:')) reports++; verified++
    }
    console.log(JSON.stringify({ runtime: 'github-actions', verified, reports, summaryStore: !!kvSummaryStore(state) }))
  } else if (mode === 'test-newsletter') {
    const id = required('PODCAST_TEST_ID')
    const result = await testNewsletter(state, {
      id, selector: required('PODCAST_TEST_RECIPIENT'), stateKey,
      getEpisodes: async () => {
        const stored = await state.preparedRecord(`views/${await opaqueName(viewIdentity('GET', '/api/episodes', null), gatewayKey)}.enc`)
        if (!stored || stored.status !== 200) throw new Error('Saved episode view is unavailable')
        const episodes = JSON.parse(new TextDecoder().decode(unbase64(stored.body))) as Episode[]
        if (!Array.isArray(episodes)) throw new Error('Saved episode view is invalid')
        return episodes
      },
      generatePdf: weeklyPdfBytes,
      publishPdf: async (bytes, filename) => {
        const report = await kvReportStore(state).put(bytes)
        await view(`/api/report/${report}`, null)
        await view(`/api/report/${report}.pdf`, null)
        await state.checkpoint()
        const url = reportUrl(env.SITE_URL, report, filename)
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
        const actual = new Uint8Array(await response.arrayBuffer()), expected = new Uint8Array(bytes)
        if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf') || actual.length !== expected.length || actual.some((b, i) => b !== expected[i])) throw new Error('Published full PDF could not be verified; no test mail sent')
        return url
      },
      sendEmail: durableSender(state, stateKey, required('MUNSHOT_EMAIL_TOKEN'), `podcast-test:${id}`),
    })
    console.log(JSON.stringify(result))
    if (!result.ok) throw new Error('Test delivery requires attention; saved parts must be reconciled before another test')
  } else if (mode === 'tick') {
    // Queues are durable refs. GitHub concurrency may replace a pending workflow,
    // but cannot replace or lose any queued browser request.
    const refs = await github.request<{ ref: string; object: { sha: string } }[]>(`git/matching-refs/heads/${QUEUE_PREFIX}`)
    let completed = 0, needsAttention = 0
    for (const ref of refs.slice(0, 20)) {
      const id = ref.ref.slice(`refs/heads/${QUEUE_PREFIX}`.length)
      if (!/^[a-f0-9]{64}$/.test(id)) continue
      const encrypted = await github.file('request.enc', ref.object.sha)
      if (!encrypted) throw new Error('Queued request is missing')
      const request = await open<QueuedRequest>(encrypted, gatewayKey)
      if (request.id !== id || !request.path.startsWith('/api/') || request.path.startsWith('/api/cron/')) throw new Error('Invalid queued request')
      const headers: Record<string, string> = { 'content-type': request.contentType }
      if (request.user) headers[USER_HEADER] = request.user
      let response: Response
      try {
        response = await route(new Request(new URL(request.path, env.SITE_URL), { method: request.method, headers, ...(request.method === 'GET' ? {} : { body: unbase64(request.body) }) }), env)
      } catch { response = Response.json({ error: 'processing_failed' }, { status: 502 }) }
      const result = await responseRecord(response, request.user)
      await state.put(`request:v1:${id}`, JSON.stringify(request))
      await state.prepared(`jobs/${id}.enc`, result)
      if (request.method === 'GET') await state.prepared(`views/${await opaqueName(viewIdentity('GET', request.path, request.user), gatewayKey)}.enc`, result)
      // Only an acknowledged state commit makes the result visible to the user.
      await state.checkpoint()
      const retry = response.status >= 500 || response.status === 429
      if (retry) { needsAttention++; continue }
      await github.request(`git/refs/heads/${QUEUE_PREFIX}${id}`, 'DELETE')
      completed++
    }
    const report = await scheduledTick(state, env)
    await prepareStoredViews()
    // The expensive feed fetch is once per scheduled tick on the GitHub runner.
    await view('/api/episodes', null)
    await state.checkpoint()
    console.log(JSON.stringify({ completed, needsAttention, report }))
    if (needsAttention || report.ok === false || ('skipped' in report.batch && report.batch.skipped === 'no_llm_key')) process.exitCode = 1
  } else throw new Error('Unknown runner mode')
}
