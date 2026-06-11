import { defineConfig, loadEnv } from 'vite'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { episodesForFeed, getLiveEpisodes, SEED_IDS } from './server/feeds'
import { searchPodcasts } from './server/search'
import { summarizeEpisode } from './server/summarize'
import { fileSummaryStore } from './server/summaryStore.node'
import { handleChannels } from './server/channelStore'
import { fileChannelStore } from './server/channelStore.node'
import { handleProcessed } from './server/processedStore'
import { fileProcessedStore } from './server/processedStore.node'
import { USER_HEADER, userKeyFrom } from './server/identity'
import { resolveVideoId } from './server/resolveVideo'

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

// The Munshot identity header, canonicalized — Node lowercases incoming header
// names, and USER_HEADER is already lowercase. Null = anonymous (legacy stores).
function userOf(req: Connect.IncomingMessage): string | null {
  const h = req.headers[USER_HEADER]
  return userKeyFrom(Array.isArray(h) ? h[0] : h)
}

// Serves the live-feed + summary API during `vite dev` / preview, mirroring the
// Cloudflare Pages Functions (functions/api/*) used in production. Both call the
// same shared server/* modules, so local and prod behave identically.
function liveApiPlugin(config: {
  openaiKey?: string
  anthropicKey?: string
  model?: string
  deepgramKey?: string
  deepgramModel?: string
  groqKey?: string
}): Plugin {
  // Shared summary store for dev: a filesystem mirror of the prod KV namespace, so
  // a summary generated once is reused across reloads and across every browser that
  // hits this dev server — exactly like the deployed app.
  const store = fileSummaryStore(path.resolve(process.cwd(), '.cache/summaries'))
  // Durable channel roster for dev: file mirrors of the prod KV entries, so the
  // tracked-show lists survive restarts — exactly like the deployed app. The
  // anonymous roster keeps its legacy single file; each identified user gets
  // their own file (mirroring the per-user KV keys). The `u-` filename prefix
  // defuses dot-only ids; the canonical key charset already excludes `/`.
  const channels = fileChannelStore(path.resolve(process.cwd(), '.cache/channels.json'))
  const channelStoreFor = (uid: string | null) =>
    uid ? fileChannelStore(path.resolve(process.cwd(), '.cache/channels', `u-${uid}.json`)) : channels
  // Per-user processed history for dev (no anonymous variant — mirrors prod,
  // where anonymous history lives only in the browser).
  const processedStoreFor = (uid: string | null) =>
    uid ? fileProcessedStore(path.resolve(process.cwd(), '.cache/processed', `u-${uid}.json`)) : null
  return {
    name: 'munshot-live-api',
    configureServer(server) {
      server.middlewares.use('/api/channels', async (req, res) => {
        try {
          const method = req.method ?? 'GET'
          const { status, body } = await handleChannels(channelStoreFor(userOf(req)), method, method === 'GET' ? '' : await readBody(req), SEED_IDS)
          json(res, status, body)
        } catch {
          if (req.method === 'GET') json(res, 200, [])
          else json(res, 500, { error: 'channels_failed' })
        }
      })

      server.middlewares.use('/api/processed', async (req, res) => {
        try {
          const method = req.method ?? 'GET'
          const { status, body } = await handleProcessed(
            processedStoreFor(userOf(req)),
            store, // the shared summary cache — GETs re-hydrate entries against it
            method,
            method === 'GET' ? '' : await readBody(req),
          )
          json(res, status, body)
        } catch {
          if (req.method === 'GET') json(res, 200, [])
          else json(res, 500, { error: 'processed_failed' })
        }
      })

      server.middlewares.use('/api/episodes', async (req, res) => {
        try {
          // req.url is the remainder after the mount prefix; base it to read query params.
          const params = new URL(req.url ?? '', 'http://localhost').searchParams
          const feed = params.get('feed')
          const id = params.get('id')
          // The summary store rides along on both paths, so episodes already
          // processed by ANY user come back ready — shared state for everyone.
          json(res, 200, feed && id ? await episodesForFeed(feed, id, store) : await getLiveEpisodes(store))
        } catch {
          json(res, 200, [])
        }
      })

      server.middlewares.use('/api/resolve-video', async (req, res) => {
        try {
          const params = new URL(req.url ?? '', 'http://localhost').searchParams
          json(res, 200, { videoId: await resolveVideoId(params.get('q') ?? '') })
        } catch {
          json(res, 200, { videoId: null })
        }
      })

      server.middlewares.use('/api/search-podcasts', async (req, res) => {
        try {
          const params = new URL(req.url ?? '', 'http://localhost').searchParams
          json(res, 200, await searchPodcasts(params.get('q') ?? '', Number(params.get('limit')) || undefined))
        } catch {
          json(res, 200, [])
        }
      })

      server.middlewares.use('/api/summary', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
        if (!config.openaiKey && !config.anthropicKey) return json(res, 503, { error: 'no_api_key' })
        try {
          const input = JSON.parse((await readBody(req)) || '{}')
          json(res, 200, await summarizeEpisode(input, { ...config, store }))
        } catch (e) {
          json(res, 502, { error: 'summarize_failed', detail: String(e).slice(0, 200) })
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Loads .env / .env.local (gitignored) so the dev server + preview can reach
  // the Anthropic API without exporting env vars by hand.
  const env = loadEnv(mode, process.cwd(), '')
  const pick = (k: string) => env[k] || process.env[k] || ''
  const summaryConfig = {
    openaiKey: pick('OPENAI_API_KEY'),
    anthropicKey: pick('ANTHROPIC_API_KEY'),
    model: pick('SUMMARY_MODEL') || undefined,
    deepgramKey: pick('DEEPGRAM_API_KEY'), // transcription for long episodes
    deepgramModel: pick('DEEPGRAM_MODEL') || undefined,
    groqKey: pick('GROQ_API_KEY'), // free-tier Whisper (short episodes)
  }

  return {
    plugins: [react(), liveApiPlugin(summaryConfig)],
    // Bind on all interfaces and honor the PORT assigned by the preview harness so
    // the hosted preview can reach the dev server (it proxies in from beyond
    // loopback). allowedHosts lets the proxied preview hostname through Vite's
    // host-header check instead of being rejected as a "blocked request".
    server: {
      host: true,
      port: Number(process.env.PORT) || 5173,
      strictPort: false,
      allowedHosts: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
