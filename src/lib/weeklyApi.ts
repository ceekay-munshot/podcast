import type { Episode, Podcast, Takeaway, WeeklySummary } from './types'
import { keyHighlights } from './highlights'
import { apiFetch } from './apiFetch'
import { scopedKey } from './storageScope'
import { assembleWeekly, buildShowDigests, hashKey, rangeLabel } from './weeklyAssemble'

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

// One user-scoped cache key for both layers (memory map + localStorage). The `:v2`
// namespace retires the pre-by-show digest shape, so stale entries are never read.
const cacheKey = (key: string): string => scopedKey('munshot:weekly:v2') + `:${key}`

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

  // AI narrative layer (overview, takeaways, questions) with a real fallback. The
  // shared id makes the result reusable across ALL users via the global summary
  // store (same episode set ⇒ same id ⇒ one LLM call total), not just this browser.
  const ai = await aiSynthesize(ready, range, podcastById, { id: `weekly:${key}`, force: opts.force })
  const overview = ai?.overview.length ? ai.overview : base.overview
  const takeaways = ai?.takeaways.length ? ai.takeaways : base.takeaways
  const questions = ai?.questions ?? []

  const words = [...overview, ...takeaways.flatMap((t) => [t.title, t.detail])].join(' ').trim().split(/\s+/).length
  const weekly: WeeklySummary = {
    ...base,
    overview,
    takeaways,
    questions,
    readMinutes: Math.max(1, Math.round(words / 200)),
  }
  SESSION.set(ck, weekly)
  writeCache(ck, weekly)
  return weekly
}

// ── AI narrative via the shared /api/summary endpoint ────────────────────────
async function aiSynthesize(
  ready: Episode[],
  range: string,
  podcastById: ById,
  opts: { id?: string; force?: boolean } = {},
): Promise<{ overview: string[]; takeaways: Takeaway[]; questions: string[] } | null> {
  const body = ready
    .map((e) => {
      const s = e.summary!
      const show = podcastById(e.podcastId)?.title ?? 'Unknown show'
      const syn = s.synthesis.join(' ').replace(/\*\*/g, '')
      const tk = keyHighlights(s).map((h) => `- ${h.title}: ${h.detail}`).join('\n')
      const ideas = (s.ideas ?? [])
        .map((i) => `- ${i.idea}${i.proponent && i.proponent !== '—' ? ` (${i.proponent})` : ''}: ${i.thesis.join('; ')}`)
        .join('\n')
      const ideasBlock = ideas ? `\nIdeas pitched:\n${ideas}` : ''
      return `### ${show} — ${e.title}\n${syn}\nKey points:\n${tk}${ideasBlock}`
    })
    .join('\n\n')

  const notes =
    `This is a WEEKLY ROUNDUP across ${ready.length} podcast episode${ready.length === 1 ? '' : 's'} from ${range}. ` +
    `Your job is to PRESERVE and ORGANISE the specific substance of the week — NOT to abstract it into generic themes. ` +
    `Write a tight 2-3 paragraph overview that LEADS with the most important concrete ideas and calls actually pitched this week: name them, name who made them, and name the real numbers, companies, and people involved. ` +
    `Never write generic filler like "the market is maturing" or "AI continues to grow". In "qa", put the sharpest open QUESTIONS the week raises (with a one-line answer if known). ` +
    `Base everything ONLY on the material below; do not invent.\n\n${body}`

  try {
    // Bound the call so the edition never hangs on a slow/stuck endpoint — on
    // timeout we abort and fall through to the deterministic by-show layer.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    let res: Response
    try {
      res = await apiFetch('/api/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: opts.id, title: `Munshot Weekly Roundup — ${range}`, show: 'Munshot Weekly', notes, force: opts.force }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const data = (await res.json()) as {
      summary?: { synthesis?: string[]; highlights?: { title?: string; detail?: string; key?: boolean }[]; qa?: { q: string; a: string }[] }
    }
    const sum = data.summary
    if (!sum) return null
    // The endpoint returns episode-shaped highlights; the weekly digest keeps the
    // key ones (all, when none are flagged) as its plain cross-episode takeaways.
    const hl = (sum.highlights ?? []).filter((h) => h?.title)
    const keyed = hl.filter((h) => h.key)
    return {
      overview: (sum.synthesis ?? []).filter(Boolean),
      takeaways: (keyed.length ? keyed : hl).map((h) => ({ title: h.title!, detail: h.detail ?? '' })),
      questions: (sum.qa ?? []).map((x) => x.q).filter(Boolean),
    }
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
