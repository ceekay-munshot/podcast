import type { Episode, Podcast, WeeklyAi, WeeklySummary } from './types'
import { apiFetch } from './apiFetch'
import { scopedKey } from './storageScope'
import { assembleWeekly, buildCitations, buildShowDigests, buildWeeklySources, hashKey, mergeWeeklyAi, rangeLabel } from './weeklyAssemble'

// ─────────────────────────────────────────────────────────────────────────────
// Real Weekly Summary — a "summary of summaries" built ONLY from analysed
// episodes (zero fake data). Two layers:
//
//   • Deterministic (always): the by-show digests, top themes, mentions, the
//     interesting pull-quote, source episodes, the date range — all in the pure,
//     runtime-agnostic engine (weeklyAssemble.ts), shared with the server-side
//     Monday digest so the emailed and on-screen editions are built the same way.
//   • AI narrative (when a key is configured): the cross-episode overview, the
//     key takeaways, and the open questions — synthesised by reusing the same
//     /api/summary endpoint the episodes use (no new backend). Falls back to the
//     deterministic layer's prose when there's no key or the call fails.
//
// Caching is layered. L1 (per browser): a memory map + user-scoped localStorage,
// keyed by the analysed-episode set — instant on return, never crosses users. L2
// (global): the AI synthesis posts a content-derived `id`, so the shared summary
// store reuses it across ALL users and browsers — the same episode set is run
// through the model ONCE total, not once per visitor.
// ─────────────────────────────────────────────────────────────────────────────

type ById = (id: string) => Podcast | undefined

// Re-exported so existing importers (and tests) keep a stable surface.
export { buildShowDigests }

const SESSION = new Map<string, WeeklySummary>()

// One user-scoped cache key for both layers (memory map + localStorage). The `:v4`
// namespace retires the comparison-table shape (replaced by per-episode investment
// readouts), so a stale cached edition is never read after this format change.
const cacheKey = (key: string): string => scopedKey('munshot:weekly:v4') + `:${key}`

export interface WeeklyOptions {
  /** Disambiguates the cache entry — pass the ISO week key (or 'all'). Keeps two
   *  different views over the same episode set (a single week vs. all-time) from
   *  colliding on the content hash. */
  scope?: string
  /** Canonical label to use instead of the episodes' min/max range (e.g. the
   *  week's Mon–Sun span for a per-week edition). */
  rangeLabel?: string
  /** Skip the cache READ and regenerate from scratch (still overwrites the cache).
   *  Powers the "Refresh" button: after a format/prompt change ships, a user can
   *  force the latest version instead of being served the stale cached edition. */
  force?: boolean
}

export async function generateWeekly(
  episodes: Episode[],
  podcastById: ById,
  opts: WeeklyOptions = {},
): Promise<WeeklySummary | null> {
  const ready = episodes
    .filter((e) => e.status === 'ready' && e.summary)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
  if (!ready.length) return null

  const key = hashKey(ready) + (opts.scope ? `:${opts.scope}` : '')
  const ck = cacheKey(key)
  if (!opts.force) {
    const cached = SESSION.get(ck) ?? readCache(ck)
    if (cached) {
      SESSION.set(ck, cached)
      return cached
    }
  }

  // Always-real deterministic base (shared engine), then the AI narrative on top.
  const range = opts.rangeLabel ?? rangeLabel(ready)
  const base = assembleWeekly(ready, podcastById, { rangeLabel: range, id: `wk-${key}` })

  // Guidepoint AI layer (overview, key themes, quant table, comparison, questions)
  // with the deterministic fallback baked into mergeWeeklyAi. The shared id makes
  // the result reusable across ALL users via the global summary store (same episode
  // set ⇒ same id ⇒ one LLM call total), not just this browser.
  const ai = await aiSynthesize(ready, range, podcastById, { id: `weekly:${key}`, force: opts.force })
  const weekly = ai ? mergeWeeklyAi(base, ai) : base

  SESSION.set(ck, weekly)
  writeCache(ck, weekly)
  return weekly
}

// ── AI narrative via the shared /api/summary endpoint (weekly mode) ───────────
// Builds the numbered source payload from the per-episode insights, posts it to
// /api/summary with mode:'weekly', and returns the WeeklyAi narrative (or null on
// timeout / no-key / failure, so the caller keeps the deterministic base).
async function aiSynthesize(
  ready: Episode[],
  range: string,
  podcastById: ById,
  opts: { id?: string; force?: boolean } = {},
): Promise<WeeklyAi | null> {
  const citations = buildCitations(ready, podcastById)
  const sources = buildWeeklySources(ready, citations, podcastById)

  try {
    // Bound the call so the edition never hangs on a slow/stuck endpoint — on
    // timeout we abort and fall through to the deterministic Guidepoint layer.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25_000)
    let res: Response
    try {
      res = await apiFetch('/api/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'weekly', id: opts.id, range, sources, force: opts.force }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const data = (await res.json()) as { weekly?: WeeklyAi }
    return data.weekly ?? null
  } catch {
    return null
  }
}

function readCache(storageKey: string): WeeklySummary | null {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as WeeklySummary) : null
  } catch {
    return null
  }
}

function writeCache(storageKey: string, w: WeeklySummary): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(w))
  } catch {
    /* storage unavailable — fine, session cache still applies */
  }
}
