import { handleChannels, kvChannelStore } from '../../server/channelStore'
import { SEED_IDS } from '../../server/feeds'
import type { KVNamespace } from '../../server/summaryStore'

// Cloudflare Pages Function → /api/channels (production).
// The durable channel roster — which shows are tracked, including user-added
// ones — lives in the SUMMARIES KV namespace (key channels:v1, no TTL), so it
// survives deploys and is the same for every browser/device. Mirrors the Vite
// dev middleware; both call the shared server/channelStore.ts.
//   GET  → the roster (always no-store: a deploy must never serve a stale list)
//   POST → upsert one channel  { podcast: Podcast }   (tracked:false = untrack)
//   PUT  → bulk merge          { podcasts: Podcast[] } (one-time localStorage migration)
export const onRequest = async (context: { request: Request; env: { SUMMARIES?: KVNamespace } }): Promise<Response> => {
  let result: { status: number; body: unknown }
  try {
    const store = context.env?.SUMMARIES ? kvChannelStore(context.env.SUMMARIES) : null
    result = await handleChannels(store, context.request.method, await context.request.text(), SEED_IDS)
  } catch {
    result = { status: 500, body: { error: 'channels_failed' } }
  }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
