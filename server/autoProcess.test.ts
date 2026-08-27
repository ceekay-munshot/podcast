import { describe, it, expect } from 'vitest'
import type { Episode, Podcast } from '../src/lib/types'
import { collectTrackedChannels, listRosterKeys, selectTrackedChannels, CHANNELS_KEY } from './channelStore'
import type { KVNamespace } from './summaryStore'
import { episodesForChannels } from './feeds'

// ─────────────────────────────────────────────────────────────────────────────
// Auto-processing coverage — the bug these guard against:
//
// The cron's auto-processor only ever walked the hardcoded seed SOURCES, so a
// channel added from Discover was invisible to it. Its episodes stayed "detected"
// no matter how many ticks ran, and the ONLY way to summarise them was the in-app
// "Process all" button. These tests pin the two halves of the fix: finding the
// user-added channels across every stored roster, and fetching their feeds.
// ─────────────────────────────────────────────────────────────────────────────

const SEEDS: ReadonlySet<string> = new Set(['allin', 'bg2'])

function channel(over: Partial<Podcast> = {}): Podcast {
  return {
    id: 'sourcery',
    title: "Sourcery with Molly O'Shea",
    author: "Molly O'Shea",
    category: 'Technology',
    description: 'Space and hardware.',
    cadence: 'Weekly',
    episodeCount: 40,
    source: 'podcast',
    color: '#b45309',
    monogram: 'SW',
    feedUrl: 'https://example.com/sourcery.xml',
    tracked: true,
    ...over,
  }
}

/** Minimal in-memory KV with the `list` the roster scan needs. */
function fakeKv(entries: Record<string, unknown>, opts: { canList?: boolean } = {}): KVNamespace {
  const kv: KVNamespace = {
    get: (async (key: string, type?: string) => {
      const v = entries[key]
      if (v === undefined) return null
      return type === 'json' ? v : JSON.stringify(v)
    }) as KVNamespace['get'],
    put: async () => {},
  }
  if (opts.canList !== false) {
    kv.list = async ({ prefix = '', cursor } = {}) => {
      void cursor
      return { keys: Object.keys(entries).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }
    }
  }
  return kv
}

describe('listRosterKeys', () => {
  it('finds the anonymous roster plus every per-user one', async () => {
    const kv = fakeKv({
      [CHANNELS_KEY]: [],
      'u:alice:channels:v1': [],
      'u:bob:channels:v1': [],
      'u:alice:processed:v1': [], // a different per-user namespace — must not be picked up
      'sum:ep1': {},
    })
    expect(await listRosterKeys(kv)).toEqual([CHANNELS_KEY, 'u:alice:channels:v1', 'u:bob:channels:v1'])
  })

  it('degrades to nothing when the binding cannot enumerate', async () => {
    // The dev file mirror has no list() — the cron must fall back to seeds-only
    // rather than throwing and killing the whole tick.
    expect(await listRosterKeys(fakeKv({}, { canList: false }))).toEqual([])
  })

  it('keeps whatever it collected when list() throws mid-scan', async () => {
    const kv = fakeKv({ [CHANNELS_KEY]: [] })
    kv.list = async () => {
      throw new Error('kv down')
    }
    expect(await listRosterKeys(kv)).toEqual([CHANNELS_KEY])
  })
})

describe('selectTrackedChannels', () => {
  it('returns user-added shows across rosters, de-duplicated by id', () => {
    const out = selectTrackedChannels(
      [[channel()], [channel(), channel({ id: 'mib', title: 'Masters in Business' })]],
      SEEDS,
    )
    expect(out.map((c) => c.id)).toEqual(['mib', 'sourcery'])
  })

  it('excludes seed shows — SOURCES already covers them', () => {
    const out = selectTrackedChannels([[channel({ id: 'allin', title: 'All-In' }), channel()]], SEEDS)
    expect(out.map((c) => c.id)).toEqual(['sourcery'])
  })

  it('excludes untracked shows — a deselected channel must not cost a call', () => {
    expect(selectTrackedChannels([[channel({ tracked: false })]], SEEDS)).toEqual([])
  })

  it('excludes entries with no feed to fetch', () => {
    expect(selectTrackedChannels([[channel({ feedUrl: undefined, feeds: undefined })]], SEEDS)).toEqual([])
  })

  it('treats a null roster as a FAILED read, not an empty one', () => {
    const out = selectTrackedChannels([null, [channel()]], SEEDS)
    expect(out.map((c) => c.id)).toEqual(['sourcery'])
  })

  it('caps the roster so one tick can never fan out unbounded', () => {
    const many = Array.from({ length: 50 }, (_, i) => channel({ id: `show-${i}` }))
    expect(selectTrackedChannels([many], SEEDS, 10)).toHaveLength(10)
  })

  it('keeps a pooled show that has `feeds` but no primary feedUrl', () => {
    const pooled = channel({ feedUrl: undefined, feeds: [{ feedUrl: 'https://example.com/a.xml' }] })
    expect(selectTrackedChannels([[pooled]], SEEDS).map((c) => c.id)).toEqual(['sourcery'])
  })
})

describe('collectTrackedChannels (KV)', () => {
  it('unions the rosters of every user', async () => {
    const kv = fakeKv({
      [CHANNELS_KEY]: [channel({ id: 'anon-add' })],
      'u:alice:channels:v1': [channel(), channel({ id: 'allin', tracked: false })],
      'u:bob:channels:v1': [channel({ id: 'mib' })],
    })
    const out = await collectTrackedChannels(kv, SEEDS)
    expect(out.map((c) => c.id)).toEqual(['anon-add', 'mib', 'sourcery'])
  })

  it('is empty when no roster can be enumerated', async () => {
    expect(await collectTrackedChannels(fakeKv({}, { canList: false }), SEEDS)).toEqual([])
  })
})

describe('episodesForChannels', () => {
  const ep = (id: string, podcastId: string, publishedAt: string): Episode => ({
    id,
    podcastId,
    title: id,
    publishedAt,
    durationSec: 60,
    status: 'detected',
    signal: 'normal',
    blurb: '',
    entities: { people: [], companies: [], themes: [] },
  })

  it('skips channels with no usable feed instead of calling out', async () => {
    expect(await episodesForChannels([channel({ feedUrl: undefined, feeds: undefined })])).toEqual([])
    expect(await episodesForChannels([])).toEqual([])
  })

  it('rotates the window so a long roster is covered across ticks', async () => {
    // Four channels, two per tick: consecutive offsets must read disjoint pairs,
    // and the window must wrap rather than run off the end.
    const seen: string[][] = []
    const channels = ['a', 'b', 'c', 'd'].map((id) => channel({ id }))
    const fetcher = async (c: Podcast): Promise<Episode[]> => [ep(`${c.id}-1`, c.id, '2026-08-27T00:00:00Z')]
    for (const offset of [0, 2, 4]) {
      const out = await episodesForChannels(channels, undefined, { limit: 2, offset, fetchEpisodes: fetcher })
      seen.push(out.map((e) => e.podcastId))
    }
    expect(seen[0]).toEqual(['a', 'b'])
    expect(seen[1]).toEqual(['c', 'd'])
    expect(seen[2]).toEqual(['a', 'b']) // wrapped back round
  })

  it('isolates a failing feed — the rest of the roster still lands', async () => {
    const channels = [channel({ id: 'good' }), channel({ id: 'bad' })]
    const fetcher = async (c: Podcast): Promise<Episode[]> => {
      if (c.id === 'bad') throw new Error('feed down')
      return [ep('good-1', 'good', '2026-08-27T00:00:00Z')]
    }
    const out = await episodesForChannels(channels, undefined, { fetchEpisodes: fetcher })
    expect(out.map((e) => e.podcastId)).toEqual(['good'])
  })

  it('returns newest first', async () => {
    const channels = [channel({ id: 'a' }), channel({ id: 'b' })]
    const fetcher = async (c: Podcast): Promise<Episode[]> => [
      ep(`${c.id}-1`, c.id, c.id === 'a' ? '2026-08-20T00:00:00Z' : '2026-08-26T00:00:00Z'),
    ]
    const out = await episodesForChannels(channels, undefined, { fetchEpisodes: fetcher })
    expect(out.map((e) => e.id)).toEqual(['b-1', 'a-1'])
  })
})
