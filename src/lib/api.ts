import type { Episode, Podcast, PodcastSearchResult, Summary, TranscriptSegment, WeeklySummary } from './types'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'

// ─────────────────────────────────────────────────────────────────────────────
// THE SEAM.
//
// Every function here returns the same shape a real backend would. Today they
// resolve from in-memory mock data after a tiny simulated latency. To go live,
// replace each body with a `fetch()` — e.g.
//
//     export const listEpisodes = () =>
//       fetch('/api/episodes').then((r) => r.json() as Promise<Episode[]>)
//
// No component imports mock data directly, so nothing else has to change.
// ─────────────────────────────────────────────────────────────────────────────

const LATENCY = 240 // ms — just enough to exercise loading states.

function delay<T>(value: T, ms = LATENCY): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// Clone so the UI can mutate its own copy without corrupting the "server".
function clone<T>(value: T): T {
  return structuredClone(value)
}

export function listPodcasts(): Promise<Podcast[]> {
  return delay(clone(PODCASTS))
}

export function listEpisodes(): Promise<Episode[]> {
  // Live: real episodes from the shows' feeds via /api/episodes (Vite middleware
  // in dev, Cloudflare Pages Function in prod). Falls back to the seeded episodes
  // if the endpoint is unreachable or returns nothing.
  return fetch('/api/episodes')
    .then((r) => (r.ok ? (r.json() as Promise<Episode[]>) : Promise.reject(new Error('feed endpoint unavailable'))))
    .then((eps) => (Array.isArray(eps) && eps.length > 0 ? eps : clone(EPISODES)))
    .catch(() => clone(EPISODES))
}

export function getEpisode(id: string): Promise<Episode | undefined> {
  return delay(clone(EPISODES.find((e) => e.id === id)))
}

export function getWeekly(): Promise<WeeklySummary> {
  return delay(clone(WEEKLY))
}

// ── Mutations — optimistic on the client, persisted here in a real backend ───

export function setPodcastTracked(id: string, tracked: boolean): Promise<{ id: string; tracked: boolean }> {
  // SEAM: POST /api/podcasts/:id/track
  return delay({ id, tracked })
}

export class NoApiKeyError extends Error {}

// Generate a real AI summary via /api/summary. Returns the one-page summary AND
// the full transcript it was built from (when a transcript source exists), so the
// Transcript tab can render the real thing. Throws NoApiKeyError when the server
// has no LLM key set, so the UI can show a "connect a key" hint.
export async function generateSummary(input: {
  id?: string // stable episode id → the shared cache key (so all users reuse the result)
  title: string
  show: string
  notes?: string
  transcriptUrl?: string
  audioUrl?: string
}): Promise<{ summary: Summary; transcript?: TranscriptSegment[] }> {
  const r = await fetch('/api/summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (r.status === 503) throw new NoApiKeyError('no_api_key')
  if (!r.ok) throw new Error(`summary failed: ${r.status}`)
  return (await r.json()) as { summary: Summary; transcript?: TranscriptSegment[] }
}

// SEAM: weekly-digest email subscription. Wire your email-sending mechanism in
// here (Cloudflare Email, Resend, SES, …); the server schedules one email a week.
export function subscribeWeekly(email: string): Promise<{ subscribed: boolean; email: string }> {
  // SEAM: POST /api/subscriptions/weekly
  return delay({ subscribed: true, email })
}

export function unsubscribeWeekly(email: string): Promise<{ subscribed: boolean; email: string }> {
  // SEAM: DELETE /api/subscriptions/weekly
  return delay({ subscribed: false, email })
}

// Search a real podcast directory (Apple/iTunes — keyless), or resolve a pasted
// RSS / Apple-show / YouTube-channel URL, via /api/search-podcasts (Vite
// middleware in dev, Cloudflare Pages Function in prod). Returns [] for an empty
// query or any failure. Pass an AbortSignal to cancel a superseded keystroke —
// AbortError is re-thrown so the caller can ignore it rather than clobber state.
export function searchPodcasts(query: string, signal?: AbortSignal): Promise<PodcastSearchResult[]> {
  const q = query.trim()
  if (!q) return Promise.resolve([])
  return fetch(`/api/search-podcasts?q=${encodeURIComponent(q)}`, { signal })
    .then((r) => (r.ok ? (r.json() as Promise<PodcastSearchResult[]>) : []))
    .catch((err) => {
      if ((err as { name?: string })?.name === 'AbortError') throw err
      return []
    })
}

// Recent episodes for a single user-added feed. The server validates the URL
// (SSRF guard) and parses RSS or YouTube/Atom. Returns [] on any failure.
export function fetchFeedEpisodes(feedUrl: string, podcastId: string): Promise<Episode[]> {
  return fetch(`/api/episodes?feed=${encodeURIComponent(feedUrl)}&id=${encodeURIComponent(podcastId)}`)
    .then((r) => (r.ok ? (r.json() as Promise<Episode[]>) : []))
    .catch(() => [])
}
