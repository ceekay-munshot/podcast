import { getLiveEpisodes } from '../../server/feeds'
import { kvSummaryStore, type KVNamespace } from '../../server/summaryStore'

// Cloudflare Pages Function → GET /api/episodes (production).
// Mirrors the Vite dev middleware; both call the shared server/feeds.ts.
// The SUMMARIES KV binding (when present) lets the feed overlay episodes already
// processed by any user as READY — so the dashboard shows shared state.
export const onRequestGet = async (context: { env: { SUMMARIES?: KVNamespace } }): Promise<Response> => {
  try {
    const store = context.env?.SUMMARIES ? kvSummaryStore(context.env.SUMMARIES) : undefined
    const episodes = await getLiveEpisodes(store)
    return new Response(JSON.stringify(episodes), {
      headers: {
        'content-type': 'application/json',
        // Cache at the edge for 15 min so feed fetches aren't repeated per visit.
        'cache-control': 'public, max-age=300, s-maxage=900',
      },
    })
  } catch {
    return new Response('[]', { headers: { 'content-type': 'application/json' } })
  }
}
