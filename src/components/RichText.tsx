import { useMemo } from 'react'
import type { ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// RichText — automatic emphasis for a text-heavy dashboard.
//
// Reduces "see → process → understand" time by giving the eye anchors. Three
// purposeful tiers, applied to plain (often machine-generated) strings:
//
//   1. **key clause**  → heaviest, near-black   (the gist, if you read nothing else)
//   2. metrics/numbers → semibold BLUE          ($1.7T, 90%, 10x, 2,000-day, 2027)
//   3. named entities  → gentle weight bump      (companies / people you pass in)
//
// Numbers are detected conservatively (must carry a %, $, ×, comma, decimal, or
// be a 19xx/20xx year) so bare counts like "3 questions" stay calm. Use on dark
// text over light surfaces — not inside colored callouts (blue-on-blue vanishes).
// ─────────────────────────────────────────────────────────────────────────────

const NUMBER = [
  String.raw`\$\d[\d,]*(?:\.\d+)?(?:[KMBT]|bn|bps)?`, //   $1.7T  $50M  $5bn
  String.raw`\d[\d,]*(?:\.\d+)?%`, //                       90%  1.5%
  String.raw`\d+(?:\.\d+)?x\b`, //                          10x  1.5x
  String.raw`\d{1,3}(?:,\d{3})+(?:-[A-Za-z]+)?`, //         2,000  2,000-day
  String.raw`\d+\.\d+`, //                                  3.14
  String.raw`\b(?:19|20)\d{2}s?\b`, //                      2027  1990s
].join('|')

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Drop any leftover markdown asterisks (the model sometimes emits an unbalanced
// ** ) so they can never render as literal characters in the UI.
function stripStars(s: string): string {
  return s.replace(/\*+/g, '')
}

export function RichText({ text, terms = [] }: { text: string; terms?: string[] }) {
  const nodes = useMemo(() => tokenize(text, terms), [text, terms.join('')])
  return <>{nodes}</>
}

function tokenize(text: string, terms: string[]): ReactNode[] {
  // Longer entities first so "Invest Like the Best" wins over "Best".
  const cleaned = [...new Set(terms)]
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length)
  const termAlt = cleaned.length ? `|\\b(?:${cleaned.map(escapeRe).join('|')})\\b` : ''

  let re: RegExp
  try {
    re = new RegExp(`(\\*\\*[^*]+\\*\\*)|(${NUMBER})${termAlt}`, 'g')
  } catch {
    return [stripStars(text)] // never let a bad entity string break rendering
  }

  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(stripStars(text.slice(last, m.index)))
    const tok = m[0]
    if (m[1]) {
      out.push(
        <strong key={key++} className="font-semibold text-on-surface">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (m[2]) {
      out.push(
        <span key={key++} className="font-semibold tabular-nums text-primary">
          {tok}
        </span>,
      )
    } else {
      out.push(
        <span key={key++} className="font-medium text-on-surface">
          {tok}
        </span>,
      )
    }
    last = m.index + tok.length
    if (m.index === re.lastIndex) re.lastIndex++ // guard against any zero-length match
  }
  if (last < text.length) out.push(stripStars(text.slice(last)))
  return out
}

/** Convenience: the entity terms worth highlighting in a body of text. */
export function entityTerms(entities?: { people: string[]; companies: string[] }): string[] {
  if (!entities) return []
  return [...entities.companies, ...entities.people]
}
