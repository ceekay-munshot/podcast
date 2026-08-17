import { describe, expect, it } from 'vitest'
import { feedsOf, feedUrlsOf, mergeFeeds, poolEpisodes, poolKey, sameFeed } from './pool'
import type { Episode } from './types'
import { parseMemberFeeds } from '../../server/feeds'

// One instalment ships three ways — members-only audio, a free video, a written
// post — and each platform writes its title slightly differently. If the key
// doesn't see through that, the user gets three rows for one thing.
describe('poolKey', () => {
  it('matches the same instalment across a show’s platforms', () => {
    const keys = [
      poolKey('Who’s Afraid of Chinese Models? | Stratechery by Ben Thompson'), // YouTube
      poolKey('Who’s Afraid of Chinese Models?'), // member audio feed
      poolKey("Who's Afraid of Chinese Models?"), // straight apostrophe
    ]
    expect(new Set(keys).size).toBe(1)
  })

  it('strips the show or author as a dash/colon suffix, but keeps a real one', () => {
    const show = { title: 'Stratechery', author: 'Ben Thompson' }
    expect(poolKey('Nvidia’s Risky Business — Stratechery', show)).toBe(poolKey('Nvidia’s Risky Business'))
    expect(poolKey('Nvidia’s Risky Business: Ben Thompson', show)).toBe(poolKey('Nvidia’s Risky Business'))
    // A colon-suffixed phrase that ISN'T the brand is part of the title.
    expect(poolKey('Nvidia’s Risky Business: The Vendor Financing Problem', show)).not.toBe(poolKey('Nvidia’s Risky Business'))
  })

  it('strips a leading "Show:" prefix', () => {
    expect(poolKey('Stratechery: The iPhone’s Last Stand', { title: 'Stratechery' })).toBe(poolKey('The iPhone’s Last Stand'))
  })

  it('keeps genuinely different titles apart', () => {
    expect(poolKey('Anthropic’s Watermarking')).not.toBe(poolKey('Anthropic’s Safety Superpower'))
    expect(poolKey('')).toBe('')
  })
})

describe('feedsOf / mergeFeeds / sameFeed', () => {
  it('normalizes both shapes to a feed list, in priority order', () => {
    expect(feedUrlsOf({ feedUrl: 'https://a/1' })).toEqual(['https://a/1'])
    expect(feedUrlsOf({ feedUrl: 'https://a/1', feeds: [{ feedUrl: 'https://b/2' }, { feedUrl: 'https://c/3' }] })).toEqual([
      'https://b/2',
      'https://c/3',
    ])
    expect(feedsOf({})).toEqual([])
  })

  it('appends only feeds not already present, keeping order', () => {
    const merged = mergeFeeds([{ feedUrl: 'https://a/1', label: 'YouTube' }], [
      { feedUrl: 'https://a/1/', label: 'dupe' }, // trailing slash only — same feed
      { feedUrl: 'https://b/2', label: 'Member feed' },
    ])
    expect(merged.map((f) => f.label)).toEqual(['YouTube', 'Member feed'])
  })

  it('treats the query string as significant — a member feed’s token lives there', () => {
    expect(sameFeed('https://a/f?token=one', 'https://a/f?token=two')).toBe(false)
    expect(sameFeed('https://A/f/', 'https://a/f')).toBe(true)
  })
})

// The merge is a UNION, not a pick: the paid feed brings the audio, the article
// feed the full text, YouTube the watch link. That's what makes one pooled
// episode better material than any single source.
describe('poolEpisodes', () => {
  const ep = (over: Partial<Episode> & { id: string; title: string }): Episode => ({
    podcastId: 'stratechery',
    publishedAt: '2026-07-20T00:00:00.000Z',
    durationSec: 0,
    status: 'detected',
    signal: 'normal',
    blurb: '',
    entities: { people: [], companies: [], themes: [] },
    ...over,
  })

  const youtube = [
    ep({
      id: 'live-stratechery-yt1',
      title: 'Who’s Afraid of Chinese Models? | Stratechery by Ben Thompson',
      publishedAt: '2026-07-29T20:00:00.000Z',
      sourceUrl: 'https://www.youtube.com/watch?v=75XNXOSPaJ8',
      notes: 'Short video description.',
      blurb: 'Short video description.',
    }),
    ep({ id: 'live-stratechery-yt2', title: 'A Script for Mark Zuckerberg | Stratechery by Ben Thompson', publishedAt: '2026-07-16T20:00:00.000Z' }),
  ]
  const member = [
    ep({
      id: 'live-stratechery-m1',
      title: 'Who’s Afraid of Chinese Models?',
      publishedAt: '2026-07-20T11:00:00.000Z',
      durationSec: 1244,
      audioUrl: 'https://cdn.example.com/2026-7-20.mp3?access_token=abc',
      sourceUrl: 'https://stratechery.com/?p=19673',
      notes: 'Teaser only.',
    }),
  ]
  const articles = [
    ep({
      id: 'live-stratechery-a1',
      title: 'Who’s Afraid of Chinese Models?',
      publishedAt: '2026-07-20T11:00:08.000Z',
      notes: 'The full written article. '.repeat(40),
      sourceUrl: 'https://stratechery.com/2026/chinese-models/',
    }),
  ]

  const pooled = poolEpisodes([youtube, member, articles], { labels: ['YouTube', 'Member feed', 'Articles'] })

  it('collapses the same instalment across sources into one episode', () => {
    expect(pooled).toHaveLength(2) // 4 raw items → the shared one merged, plus the YouTube-only one
    expect(pooled.filter((e) => e.title.includes('Chinese Models'))).toHaveLength(1)
  })

  it('keeps the FIRST source’s id, so adding a feed later never re-keys an episode', () => {
    expect(pooled.find((e) => e.title.includes('Chinese Models'))!.id).toBe('live-stratechery-yt1')
  })

  it('takes the audio from the paid feed and the longest text from the article feed', () => {
    const merged = pooled.find((e) => e.title.includes('Chinese Models'))!
    expect(merged.audioUrl).toBe('https://cdn.example.com/2026-7-20.mp3?access_token=abc')
    expect(merged.notes!.length).toBeGreaterThan(500) // the article body, not the teaser
    expect(merged.durationSec).toBe(1244) // YouTube reports none
  })

  it('prefers the YouTube watch link, which plays in app and opens for everyone', () => {
    expect(pooled.find((e) => e.title.includes('Chinese Models'))!.sourceUrl).toBe('https://www.youtube.com/watch?v=75XNXOSPaJ8')
  })

  it('drops the platform brand from the title and dates the episode from its first publication', () => {
    const merged = pooled.find((e) => e.title.includes('Chinese Models'))!
    expect(merged.title).toBe('Who’s Afraid of Chinese Models?')
    expect(merged.publishedAt).toBe('2026-07-20T11:00:00.000Z') // the audio drop, not the later video
  })

  it('strips the channel brand from a single-source episode too, so the list reads as one show', () => {
    // This instalment is only on YouTube, but it sits in a pooled list — a mix of
    // platform title conventions would look like a mix of shows.
    expect(pooled.find((e) => e.title.includes('Zuckerberg'))!.title).toBe('A Script for Mark Zuckerberg')
  })

  it('discloses which sources carried it, and says nothing when only one did', () => {
    expect(pooled.find((e) => e.title.includes('Chinese Models'))!.sources).toEqual(['YouTube', 'Member feed', 'Articles'])
    expect(pooled.find((e) => e.title.includes('Zuckerberg'))!.sources).toBeUndefined()
  })

  it('returns newest first', () => {
    expect(pooled.map((e) => e.publishedAt)).toEqual([...pooled.map((e) => e.publishedAt)].sort().reverse())
  })

  it('never merges two items from the SAME feed, however alike the titles', () => {
    const twice = [
      ep({ id: 'a', title: 'Weekly Update', publishedAt: '2026-07-01T00:00:00.000Z' }),
      ep({ id: 'b', title: 'Weekly Update', publishedAt: '2026-07-08T00:00:00.000Z' }),
    ]
    expect(poolEpisodes([twice, [ep({ id: 'c', title: 'Something Else' })]])).toHaveLength(3)
  })

  it('keeps a reused title from a different year apart', () => {
    const old = [ep({ id: 'x', title: 'Year in Review', publishedAt: '2024-12-20T00:00:00.000Z' })]
    const recent = [ep({ id: 'y', title: 'Year in Review', publishedAt: '2026-12-20T00:00:00.000Z' })]
    expect(poolEpisodes([old, recent])).toHaveLength(2)
  })

  it('leaves a single-source show exactly as it was — same ids, same fields', () => {
    expect(poolEpisodes([youtube], { labels: ['YouTube'] })).toEqual(youtube)
    expect(poolEpisodes([[], member])).toEqual(member)
    expect(poolEpisodes([])).toEqual([])
  })

  it('carries a summary through from whichever copy already has one', () => {
    const ready = ep({ id: 'r', title: 'Who’s Afraid of Chinese Models?', status: 'ready', summary: { synthesis: ['x'], highlights: [], qa: [] } })
    const merged = poolEpisodes([youtube, [ready]])
    const hit = merged.find((e) => e.title.includes('Chinese Models'))!
    expect(hit.status).toBe('ready')
    expect(hit.summary?.synthesis).toEqual(['x'])
  })
})

// MEMBER_FEEDS is the only route for paid episodes into the cron digest, which has
// no user session. It's deployment config, so bad input must degrade, not throw.
describe('parseMemberFeeds', () => {
  it('reads one or more "<showId>=<url>" entries', () => {
    expect(parseMemberFeeds('stratechery=https://x.passport.online/feed/podcast/TOK')).toEqual({
      stratechery: ['https://x.passport.online/feed/podcast/TOK'],
    })
    expect(parseMemberFeeds('a=https://one/f,\n b=https://two/f ')).toEqual({ a: ['https://one/f'], b: ['https://two/f'] })
  })

  it('drops entries with no id, no "=", or an unsafe URL', () => {
    expect(parseMemberFeeds('=https://x/f')).toEqual({})
    expect(parseMemberFeeds('https://x/f')).toEqual({})
    expect(parseMemberFeeds('a=http://127.0.0.1/f')).toEqual({}) // SSRF guard
    expect(parseMemberFeeds('a=file:///etc/passwd')).toEqual({})
  })

  it('is empty when unset', () => {
    expect(parseMemberFeeds(undefined)).toEqual({})
    expect(parseMemberFeeds('')).toEqual({})
  })
})
