// ─────────────────────────────────────────────────────────────────────────────
// Tone — rolls the per-word sentiment up into one decision-useful read for a
// whole episode (or the week). The inline coloring shows you *where*; this shows
// you the net *lean*, with the underlying counts so it's never a black box.
//
// Aggregation is per-text (paragraph / highlight / answer), summed — not one giant
// concatenation — so the inline span cap in `findSentimentSpans` can never
// undercount a long body, and the score reflects every signal.
// ─────────────────────────────────────────────────────────────────────────────

import type { Episode, WeeklySummary } from './types'
import { analyzeSentiment } from './sentiment'

export type ToneLabel = 'positive' | 'cautious' | 'mixed' | 'neutral'

export interface Tone {
  label: ToneLabel
  /** Net signed weight across all analysed text (positive minus negative). */
  score: number
  posHits: number
  negHits: number
  /** Share of the signal that is positive, 0..1 — drives the proportion bar. */
  posRatio: number
  /** Total sentiment hits (pos + neg): how much there is to read at all. */
  signal: number
}

const NEUTRAL: Tone = { label: 'neutral', score: 0, posHits: 0, negHits: 0, posRatio: 0.5, signal: 0 }

function combine(texts: string[]): Tone {
  let score = 0
  let posHits = 0
  let negHits = 0
  for (const t of texts) {
    if (!t) continue
    const s = analyzeSentiment(t)
    score += s.score
    posHits += s.posHits
    negHits += s.negHits
  }
  const signal = posHits + negHits
  if (signal < 2) return NEUTRAL // one stray hit isn't a tone
  let label: ToneLabel
  if (score >= 2) label = 'positive'
  else if (score <= -2) label = 'cautious'
  else label = 'mixed' // real signal on both sides, no clear net lean
  return { label, score, posHits, negHits, posRatio: posHits / signal, signal }
}

/** An episode's tone, drawn from its *analysis* (not the raw transcript). */
export function episodeTone(ep: Episode): Tone {
  const s = ep.summary
  if (!s) return NEUTRAL
  return combine([
    ...s.synthesis,
    ...s.highlights.flatMap((h) => [h.title, h.detail]),
    ...s.qa.map((q) => q.a),
  ])
}

/** The week's net tone, synthesised across the weekly summary's prose. */
export function weeklyTone(w: WeeklySummary): Tone {
  return combine([
    ...w.overview,
    ...w.takeaways.flatMap((t) => [t.title, t.detail]),
    ...w.contradictions,
    ...w.questions,
  ])
}
