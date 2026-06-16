import type { Episode, Podcast, Takeaway, WeeklyIdea, WeeklyShowDigest, WeeklySummary } from './types'
import { keyHighlights } from './highlights'
import { topTopics } from './topics'
import { apiFetch } from './apiFetch'
import { scopedKey } from './storageScope'

// ─────────────────────────────────────────────────────────────────────────────
// Real Weekly Summary — a "summary of summaries" built ONLY from analysed
// episodes (zero fake data). Two layers:
//
//   • Deterministic (always): top themes, mentions, the interesting pull-quote
//     (a real spoken line when available), source episodes, the date range.
//   • AI narrative (when a key is configured): the cross-episode overview, the
//     key takeaways, and the open questions — synthesised by reusing the same
//     /api/summary endpoint the episodes use (no new backend). Falls back to a
//     faithful data-derived version when there's no key or the call fails.
//
// Cached per analysed-episode set (memory + localStorage), so it's generated
// once and instant on return. Both cache layers are scoped per Munshot user
// (scopedKey), so a mid-session user switch can never serve another user's
// digest — even though the content hash alone would usually differ anyway.
// ─────────────────────────────────────────────────────────────────────────────

type ById = (id: string) => Podcast | undefined

const SESSION = new Map<string, WeeklySummary>()

// One user-scoped cache key for both layers (memory map + localStorage). The `:v2`
// namespace retires the pre-by-show digest shape, so stale entries are never read.
const cacheKey = (key: string): string => scopedKey('munshot:weekly:v2') + `:${key}`

// Per-show caps — keep each show's digest scannable when it has several episodes.
const SHOW_TAKEAWAYS_CAP = 6
const SHOW_QUESTIONS_CAP = 5

export async function generateWeekly(episodes: Episode[], podcastById: ById): Promise<WeeklySummary | null> {
  const ready = episodes
    .filter((e) => e.status === 'ready' && e.summary)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
  if (!ready.length) return null

  const key = hashKey(ready)
  const ck = cacheKey(key)
  const cached = SESSION.get(ck) ?? readCache(ck)
  if (cached) {
    SESSION.set(ck, cached)
    return cached
  }

  // Always-real, deterministic layer.
  const shows = buildShowDigests(ready, podcastById)
  const topThemes = topTopics(ready, 6).map((t) => ({ label: t.label, momentum: t.count }))
  const mentions = aggregateMentions(ready)
  const interesting = pickInteresting(ready, podcastById)
  const range = rangeLabel(ready)

  // AI narrative layer (overview, takeaways, questions) with a real fallback.
  const ai = await aiSynthesize(ready, range, podcastById)
  const overview = ai?.overview.length ? ai.overview : derivedOverview(ready, topThemes, podcastById)
  const takeaways = ai?.takeaways.length ? ai.takeaways : derivedTakeaways(ready)
  const questions = ai?.questions ?? []

  const words = [...overview, ...takeaways.flatMap((t) => [t.title, t.detail])].join(' ').trim().split(/\s+/).length
  const weekly: WeeklySummary = {
    id: `wk-${key}`,
    rangeLabel: range,
    episodeCount: ready.length,
    readMinutes: Math.max(1, Math.round(words / 200)),
    overview,
    shows,
    topThemes,
    interesting,
    takeaways,
    contradictions: [], // never fabricated — section hidden when empty
    mentions,
    questions,
    sourceEpisodeIds: ready.map((e) => e.id),
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
    const res = await apiFetch('/api/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `Munshot Weekly Roundup — ${range}`, show: 'Munshot Weekly', notes }),
    })
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

// ── Deterministic builders (real data, no fabrication) ───────────────────────

// Group the week's episodes by show into per-show mini-digests — the weekly's
// primary structure. Everything here is lifted straight from the per-episode
// summaries (no AI re-abstraction), so specifics like a stock pitch survive intact.
// Exported for unit testing.
export function buildShowDigests(ready: Episode[], podcastById: ById): WeeklyShowDigest[] {
  const byShow = new Map<string, Episode[]>()
  for (const e of ready) {
    const arr = byShow.get(e.podcastId) ?? []
    arr.push(e)
    byShow.set(e.podcastId, arr)
  }

  const built: { digest: WeeklyShowDigest; newest: number }[] = []
  for (const [podcastId, eps] of byShow) {
    // High-signal episodes lead, then newest-first within the show.
    const sorted = [...eps].sort(
      (a, b) =>
        (b.signal === 'high' ? 1 : 0) - (a.signal === 'high' ? 1 : 0) ||
        +new Date(b.publishedAt) - +new Date(a.publishedAt),
    )
    const show = podcastById(podcastId)?.title ?? 'Unknown show'

    const ideas: WeeklyIdea[] = sorted.flatMap((e) =>
      (e.summary?.ideas ?? []).map((idea) => ({ ...idea, episodeId: e.id })),
    )

    const takeaways: Takeaway[] = []
    for (const e of sorted) {
      for (const h of e.summary ? keyHighlights(e.summary) : []) {
        if (takeaways.length >= SHOW_TAKEAWAYS_CAP) break
        takeaways.push({ title: h.title.replace(/\*\*/g, '').trim(), detail: h.detail })
      }
    }

    const seenQ = new Set<string>()
    const questions: string[] = []
    for (const e of sorted) {
      for (const { q } of e.summary?.qa ?? []) {
        if (questions.length >= SHOW_QUESTIONS_CAP) break
        const norm = q.trim().toLowerCase()
        if (!norm || seenQ.has(norm)) continue
        seenQ.add(norm)
        questions.push(q.trim())
      }
    }

    built.push({
      digest: { show, podcastId, episodeIds: sorted.map((e) => e.id), episodeCount: sorted.length, ideas, takeaways, questions },
      newest: +new Date(sorted[0].publishedAt),
    })
  }

  // Shows that actually pitched ideas lead; then by episode count; then recency.
  return built
    .sort(
      (a, b) =>
        (b.digest.ideas.length ? 1 : 0) - (a.digest.ideas.length ? 1 : 0) ||
        b.digest.episodeCount - a.digest.episodeCount ||
        b.newest - a.newest,
    )
    .map((b) => b.digest)
}

function derivedOverview(ready: Episode[], themes: { label: string }[], podcastById: ById): string[] {
  const shows = [...new Set(ready.map((e) => podcastById(e.podcastId)?.title).filter(Boolean) as string[])]
  const themeList = themes.slice(0, 4).map((t) => t.label)
  const lead = ready[0]
  const leadShow = podcastById(lead.podcastId)?.title
  const leadThesis = (lead.summary?.synthesis?.[0] ?? lead.blurb ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()

  const p1 =
    `This week, Munshot analysed ${ready.length} episode${ready.length === 1 ? '' : 's'} across ${shows.length} show${shows.length === 1 ? '' : 's'}` +
    (shows.length ? ` — ${listJoin(shows)}` : '') +
    '.' +
    (themeList.length ? ` The recurring topics were ${listJoin(themeList)}.` : '')
  const p2 = leadThesis ? `${leadShow ? `${leadShow} set the tone: ` : ''}${trim(leadThesis, 300)}` : ''
  return [p1, p2].filter(Boolean)
}

function derivedTakeaways(ready: Episode[]): Takeaway[] {
  const sorted = [...ready].sort((a, b) => (b.signal === 'high' ? 1 : 0) - (a.signal === 'high' ? 1 : 0))
  const out: Takeaway[] = []
  for (const e of sorted) {
    const h = e.summary ? keyHighlights(e.summary)[0] : undefined
    if (h) out.push({ title: h.title, detail: h.detail })
    if (out.length >= 5) break
  }
  return out
}

function aggregateMentions(ready: Episode[]): { people: string[]; companies: string[] } {
  const rank = (pick: (e: Episode) => string[]) => {
    const m = new Map<string, number>()
    ready.forEach((e) => pick(e).forEach((v) => {
      const k = v.trim()
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }
  return {
    people: rank((e) => e.entities?.people ?? []).slice(0, 10),
    companies: rank((e) => e.entities?.companies ?? []).slice(0, 10),
  }
}

function pickInteresting(ready: Episode[], podcastById: ById): WeeklySummary['interesting'] {
  const ep =
    ready.find((e) => e.signal === 'high' && e.summary?.highlights?.length) ??
    ready.find((e) => e.summary?.highlights?.length) ??
    ready[0]
  const h = ep.summary?.highlights?.[0]
  const pod = podcastById(ep.podcastId)
  // Surface the curated highlight — its headline plus the why-it-matters insight.
  // (Never the raw transcript segment: spoken lines are mid-sentence fragments
  // that read as nonsense out of context.)
  const title = (h?.title ?? ep.title).replace(/\*\*/g, '').trim()
  const insight = (h?.detail ?? ep.blurb ?? '').replace(/\*\*/g, '').trim()
  return {
    title: trim(title, 120),
    quote: trim(insight, 260),
    speaker: pod?.title ?? 'The hosts',
    role: ep.title,
    episodeId: ep.id,
  }
}

// ── small utilities ──────────────────────────────────────────────────────────
function rangeLabel(ready: Episode[]): string {
  const times = ready.map((e) => +new Date(e.publishedAt)).sort((a, b) => a - b)
  const start = new Date(times[0])
  const end = new Date(times[times.length - 1])
  const short = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const full = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return times[0] === times[times.length - 1] ? full(end) : `${short(start)} – ${full(end)}`
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function trim(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.lastIndexOf(' ', n)
  return `${s.slice(0, cut > 0 ? cut : n).trim()}…`
}

function hashKey(ready: Episode[]): string {
  const sig = ready
    .map((e) => `${e.id}:${e.summary?.synthesis?.join('').length ?? 0}:${e.summary?.highlights?.length ?? 0}:${e.summary?.ideas?.length ?? 0}`)
    .join('|')
  let h = 5381
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0
  return h.toString(36)
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
