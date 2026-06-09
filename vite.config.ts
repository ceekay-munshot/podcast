import { defineConfig, loadEnv } from 'vite'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { getLiveEpisodes } from './server/feeds'
import { summarizeEpisode } from './server/summarize'

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

// Serves the live-feed + summary API during `vite dev` / preview, mirroring the
// Cloudflare Pages Functions (functions/api/*) used in production. Both call the
// same shared server/* modules, so local and prod behave identically.
function liveApiPlugin(config: { openaiKey?: string; anthropicKey?: string; model?: string }): Plugin {
  return {
    name: 'munshot-live-api',
    configureServer(server) {
      server.middlewares.use('/api/episodes', async (_req, res) => {
        try {
          json(res, 200, await getLiveEpisodes())
        } catch {
          json(res, 200, [])
        }
      })

      server.middlewares.use('/api/summary', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
        if (!config.openaiKey && !config.anthropicKey) return json(res, 503, { error: 'no_api_key' })
        try {
          const input = JSON.parse((await readBody(req)) || '{}')
          json(res, 200, await summarizeEpisode(input, config))
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
