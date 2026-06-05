import type { Episode, Podcast, Settings, WeeklySummary } from './types'
import { DEFAULT_SETTINGS, EPISODES, PODCASTS, WEEKLY } from './mock-data'

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
  return delay(clone(EPISODES))
}

export function getEpisode(id: string): Promise<Episode | undefined> {
  return delay(clone(EPISODES.find((e) => e.id === id)))
}

export function getWeekly(): Promise<WeeklySummary> {
  return delay(clone(WEEKLY))
}

export function getSettings(): Promise<Settings> {
  return delay(clone(DEFAULT_SETTINGS))
}

// ── Mutations — optimistic on the client, persisted here in a real backend ───

export function setPodcastTracked(id: string, tracked: boolean): Promise<{ id: string; tracked: boolean }> {
  // SEAM: POST /api/podcasts/:id/track
  return delay({ id, tracked })
}

export function updateSettings(next: Settings): Promise<Settings> {
  // SEAM: PUT /api/settings
  return delay(clone(next))
}

export interface TrackSourceInput {
  query: string // podcast name, RSS, or YouTube URL
}

export function addSource(input: TrackSourceInput): Promise<{ accepted: boolean; query: string }> {
  // SEAM: POST /api/sources  → server resolves the feed and starts detection
  return delay({ accepted: true, query: input.query })
}
