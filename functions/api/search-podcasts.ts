import { searchPodcasts } from '../../server/search'

// Cloudflare Pages Function → GET /api/search-podcasts?q=… (production).
// Mirrors the Vite dev middleware; both call the shared server/search.ts.
// Plain-text searches are edge-cacheable; a URL query is per-user → no-store.
export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  try {
    const q = (new URL(context.request.url).searchParams.get('q') ?? '').trim()
    const isUrl = /^https?:\/\//i.test(q)
    return new Response(JSON.stringify(await searchPodcasts(q)), {
      headers: {
        'content-type': 'application/json',
        'cache-control': isUrl ? 'no-store' : 'public, max-age=300, s-maxage=900',
      },
    })
  } catch {
    return new Response('[]', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  }
}
