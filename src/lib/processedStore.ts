import type { Episode } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Processed-history persistence.
//
// The dashboard has no backend store yet (api.ts is a seam; summaries are
// generated client-side but never saved). So an episode you've processed lives
// only in memory and vanishes on reload — or when a code push redeploys the app.
//
// This keeps a per-browser record (localStorage) of the episodes you've actually
// processed, so that history survives reloads and redeploys. Persisted entries
// are re-hydrated on load and overlaid onto the freshly-fetched feed; any that
// have since rolled off the feed are added back, so nothing is lost.
//
// Scope: per browser/origin. Cross-device history would need a real backend —
// wire it in behind these two functions and the rest of the app is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'munshot:processed:v1'
const MAX = 200 // most-recent processed episodes to keep (guards localStorage quota)

/** Episodes the user has processed, most-recent first. Never throws. */
export function loadProcessed(): Episode[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Keep only well-formed, genuinely-processed entries. The highlights check
    // also drops summaries persisted before the takeaways+moments merge — those
    // would crash the UI; the shared server store re-serves them on next open.
    return parsed.filter(
      (e): e is Episode =>
        !!e &&
        typeof (e as Episode).id === 'string' &&
        typeof (e as Episode).podcastId === 'string' &&
        (e as Episode).status === 'ready' &&
        Array.isArray((e as Episode).summary?.highlights),
    )
  } catch {
    return []
  }
}

/** Record a freshly-processed episode (idempotent by id). No-op if not ready. */
export function saveProcessed(episode: Episode): void {
  if (episode.status !== 'ready' || !episode.summary) return
  const next = [episode, ...loadProcessed().filter((e) => e.id !== episode.id)].slice(0, MAX)
  if (persist(next)) return
  // Quota exceeded: drop the bulky transcripts but keep every summary — the
  // summary is the core of "what I've processed". (JSON.stringify omits the
  // undefined key, so the stored shape simply has no transcript.)
  persist(next.map((e) => ({ ...e, transcript: undefined })))
}

function persist(list: Episode[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false // storage unavailable (private mode) or still over quota
  }
}
