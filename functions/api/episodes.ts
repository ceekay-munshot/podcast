import { episodesForFeed, getLiveEpisodes } from '../../server/feeds'

// Cloudflare Pages Function → GET /api/episodes (production).
// Mirrors the Vite dev middleware; both call the shared server/feeds.ts.
//   default                → all seed shows' recent episodes (edge-cached)
//   ?feed=<url>&id=<podId> → recent episodes for ONE user-added feed (no-store,
//                            per-user; SSRF-validated inside episodesForFeed)
export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  try {
    const params = new URL(context.request.url).searchParams
    const feed = params.get('feed')
    const id = params.get('id')
    if (feed && id) {
      const episodes = await episodesForFeed(feed, id)
      return new Response(JSON.stringify(episodes), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      })
    }
    const episodes = await getLiveEpisodes()
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
