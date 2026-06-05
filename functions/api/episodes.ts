import { getLiveEpisodes } from '../../server/feeds'

// Cloudflare Pages Function → GET /api/episodes (production).
// Mirrors the Vite dev middleware; both call the shared server/feeds.ts.
export const onRequestGet = async (): Promise<Response> => {
  try {
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
