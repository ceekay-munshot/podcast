import type { Podcast } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// User-added-podcast persistence (per browser/origin).
//
// The app has no backend store yet, so a podcast the user searches for and adds
// would vanish on reload. This keeps a localStorage record of the shows the user
// added themselves (each carrying its resolved `feedUrl`), re-hydrated on load and
// merged into the seed list. Seed/curated shows are NOT stored here — they always
// come from the seed data — so this only ever holds genuinely user-added feeds.
//
// Cross-device sync would need a real backend; wire it in behind these functions
// and the rest of the app is unchanged. Mirrors processedStore.ts.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'munshot:tracked:v1'
const MAX = 100 // guards the localStorage quota

function isValid(p: unknown): p is Podcast {
  if (!p || typeof p !== 'object') return false
  const x = p as Record<string, unknown>
  const str = (k: string) => typeof x[k] === 'string' && (x[k] as string).length >= 0
  return (
    typeof x.id === 'string' &&
    !!x.id &&
    str('title') &&
    str('author') &&
    str('category') &&
    str('description') &&
    str('color') &&
    str('monogram') &&
    typeof x.feedUrl === 'string' &&
    !!x.feedUrl &&
    (x.source === 'podcast' || x.source === 'youtube') &&
    x.tracked === true
  )
}

/** User-added podcasts, most-recent first. Never throws; drops malformed rows. */
export function loadTracked(): Podcast[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValid) : []
  } catch {
    return []
  }
}

/** Record a user-added podcast (idempotent by id, forced tracked:true). */
export function saveTracked(podcast: Podcast): void {
  if (!isValid({ ...podcast, tracked: true })) return
  const entry = { ...podcast, tracked: true }
  const next = [entry, ...loadTracked().filter((p) => p.id !== podcast.id)].slice(0, MAX)
  persist(next)
}

/** Forget a user-added podcast. */
export function removeTracked(id: string): void {
  persist(loadTracked().filter((p) => p.id !== id))
}

function persist(list: Podcast[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable (private mode) or over quota — adds still work in-session */
  }
}
