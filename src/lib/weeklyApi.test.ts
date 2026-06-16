import { describe, it, expect } from 'vitest'
import { buildShowDigests } from './weeklyApi'
import type { Episode, Highlight, Idea, Podcast, Summary } from './types'

// buildShowDigests is the deterministic heart of the by-show weekly: it groups the
// week's episodes by show and lifts each show's pitched ideas, key takeaways, and
// open questions straight from the per-episode summaries — no AI, no re-abstraction.

function pod(id: string, title: string): Podcast {
  return {
    id,
    title,
    author: 'author',
    category: 'Business',
    description: '',
    cadence: 'Weekly',
    episodeCount: 1,
    source: 'podcast',
    color: '#000000',
    monogram: 'X',
    tracked: true,
  }
}

function hl(id: string, title: string, key: boolean): Highlight {
  return { id, title, timestamp: '—', detail: `${title} — why it matters`, key }
}

function sum(over: Partial<Summary>): Summary {
  return { synthesis: [], highlights: [], qa: [], ...over }
}

function ep(id: string, podcastId: string, summary: Summary, publishedAt = '2026-06-10'): Episode {
  return {
    id,
    podcastId,
    title: id,
    publishedAt,
    durationSec: 100,
    status: 'ready',
    signal: 'normal',
    blurb: '',
    entities: { people: [], companies: [], themes: [] },
    summary,
  }
}

const idea = (over: Partial<Idea> = {}): Idea => ({ idea: 'Long NVDA', proponent: 'Sacks', thesis: ['real demand'], ...over })

const podcasts = new Map([
  ['allin', pod('allin', 'All-In')],
  ['oddlots', pod('oddlots', 'Odd Lots')],
])
const podcastById = (id: string) => podcasts.get(id)

describe('buildShowDigests', () => {
  it('groups by show and lifts ideas, key takeaways, and questions from each episode', () => {
    const allin = ep(
      'ep-allin',
      'allin',
      sum({
        highlights: [hl('h1', 'Key one', true), hl('h2', 'Key two', true), hl('h3', 'Not key', false)],
        qa: [{ q: 'Is it a bubble?', a: 'No' }, { q: 'What reopens?', a: 'IPOs' }],
        ideas: [idea(), idea({ idea: 'Fade levered names', kind: 'trade' })],
      }),
    )
    const oddlots = ep(
      'ep-oddlots',
      'oddlots',
      sum({ highlights: [hl('h4', 'Power is the bottleneck', true)], qa: [{ q: 'Why not build grid?', a: 'Permitting' }] }),
    )

    const digests = buildShowDigests([oddlots, allin], podcastById)

    // Shows that pitched ideas lead.
    expect(digests.map((d) => d.show)).toEqual(['All-In', 'Odd Lots'])

    const a = digests[0]
    expect(a.podcastId).toBe('allin')
    expect(a.episodeCount).toBe(1)
    expect(a.episodeIds).toEqual(['ep-allin'])
    // Ideas carry an episode backlink; only the two pitched ideas, in order.
    expect(a.ideas).toEqual([
      { ...idea(), episodeId: 'ep-allin' },
      { ...idea({ idea: 'Fade levered names', kind: 'trade' }), episodeId: 'ep-allin' },
    ])
    // Takeaways come from the AI-flagged key highlights (not the non-key one).
    expect(a.takeaways).toEqual([
      { title: 'Key one', detail: 'Key one — why it matters' },
      { title: 'Key two', detail: 'Key two — why it matters' },
    ])
    expect(a.questions).toEqual(['Is it a bubble?', 'What reopens?'])

    const o = digests[1]
    expect(o.ideas).toEqual([])
    expect(o.takeaways).toEqual([{ title: 'Power is the bottleneck', detail: 'Power is the bottleneck — why it matters' }])
  })

  it('merges a show with multiple episodes, dedupes questions, and caps the lists', () => {
    const episodes = [
      ep('e1', 'allin', sum({
        highlights: Array.from({ length: 5 }, (_, i) => hl(`a${i}`, `A takeaway ${i}`, true)),
        qa: [{ q: 'Shared question?', a: '1' }, { q: 'Unique A?', a: '2' }],
        ideas: [idea()],
      }), '2026-06-12'),
      ep('e2', 'allin', sum({
        highlights: Array.from({ length: 5 }, (_, i) => hl(`b${i}`, `B takeaway ${i}`, true)),
        qa: [{ q: 'shared question?', a: 'dupe (case-insensitive)' }, { q: 'Unique B?', a: '3' }],
      }), '2026-06-09'),
    ]

    const [digest] = buildShowDigests(episodes, podcastById)
    expect(digest.episodeCount).toBe(2)
    // Takeaways capped at 6 across the show's 10 key highlights.
    expect(digest.takeaways).toHaveLength(6)
    // Questions deduped case-insensitively and capped at 5.
    expect(digest.questions).toEqual(['Shared question?', 'Unique A?', 'Unique B?'])
  })
})
