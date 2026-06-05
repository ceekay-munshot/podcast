import type { Episode, TranscriptSegment } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Topic intelligence — derived from REAL episode data, never hardcoded.
//
//   topTopics()   → the most-mentioned themes/companies across ready episodes,
//                   so every topic chip is backed by an actual analysed episode.
//   findExcerpts()→ the real transcript lines where a topic is discussed, with
//                   the episode + timestamp they came from.
//
// A topic chip therefore always leads somewhere: clicking it surfaces the exact
// passages it was drawn from.
// ─────────────────────────────────────────────────────────────────────────────

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'is', 'are', 'was', 'were', 'be', 'been',
  'with', 'at', 'by', 'as', 'vs', 'from', 'this', 'that', 'it', 'its', 'into', 'about', 'over', 'than',
])

/** Break a query/topic into meaningful, searchable terms (drops punctuation + stopwords). */
export function tokenizeQuery(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOP.has(t)),
    ),
  ]
}

export interface Topic {
  label: string
  count: number
}

/** Most-mentioned topics across ready episodes — real themes + companies, frequency-ranked. */
export function topTopics(episodes: Episode[], limit = 6): Topic[] {
  const counts = new Map<string, Topic>()
  for (const e of episodes) {
    if (e.status !== 'ready') continue
    const labels = [...(e.entities?.themes ?? []), ...(e.entities?.companies ?? [])]
    for (const raw of labels) {
      const label = raw.trim()
      if (label.length < 2) continue
      const key = label.toLowerCase()
      const cur = counts.get(key)
      if (cur) cur.count++
      else counts.set(key, { label, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit)
}

export interface Excerpt {
  episode: Episode
  segment: TranscriptSegment
  /** Which query terms this passage actually contains. */
  matched: string[]
  score: number
}

/** Real transcript passages discussing a topic, ranked by how many query terms they hit. */
export function findExcerpts(episodes: Episode[], query: string, limit = 30): Excerpt[] {
  const tokens = tokenizeQuery(query)
  if (!tokens.length) return []
  const out: Excerpt[] = []
  for (const e of episodes) {
    if (!e.transcript?.length) continue
    for (const segment of e.transcript) {
      const text = segment.text.toLowerCase()
      const matched = tokens.filter((t) => text.includes(t))
      if (!matched.length) continue
      // Distinct terms hit, with a small bonus for a longer, substantive passage.
      const score = matched.length * 10 + Math.min(segment.text.length / 200, 1)
      out.push({ episode: e, segment, matched, score })
    }
  }
  out.sort((a, b) => b.score - a.score || +new Date(b.episode.publishedAt) - +new Date(a.episode.publishedAt))
  return out.slice(0, limit)
}

/** Trim a long passage to a readable window centred on the first matched term. */
export function excerptWindow(text: string, terms: string[], radius = 160): string {
  if (text.length <= radius * 2) return text
  const lower = text.toLowerCase()
  let idx = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (idx === -1 || i < idx)) idx = i
  }
  if (idx === -1) return text.slice(0, radius * 2) + '…'
  let start = Math.max(0, idx - radius)
  let end = Math.min(text.length, idx + radius)
  // Snap to word boundaries.
  if (start > 0) start = text.indexOf(' ', start) + 1 || start
  if (end < text.length) end = text.lastIndexOf(' ', end)
  return `${start > 0 ? '… ' : ''}${text.slice(start, end).trim()}${end < text.length ? ' …' : ''}`
}
