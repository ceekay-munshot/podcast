import type { FeedAccess, Podcast, PodcastFeed } from '../src/lib/types'
import type { KVNamespace } from './summaryStore'

// ─────────────────────────────────────────────────────────────────────────────
// Durable channel roster — the source of truth for which shows are tracked,
// unaffected by deploys. One roster PER USER: requests carrying a Munshot
// identity (see server/identity.ts) read/write `u:<uid>:channels:v1`, while
// anonymous requests (standalone visits, local dev, curl) keep the legacy
// global `channels:v1` — byte-for-byte today's behavior.
//
// One KV value per roster (no TTL → permanent) holding an array of Podcast
// entries:
//   • user-added shows (from Discover/search), stored in full with tracked:true;
//   • seed-show overrides — a curated show the user picked or untracked is stored
//     with its tracked flag, overriding the seed default on every client.
// Untracking a NON-seed show deletes its entry (forget the add); untracking a
// seed keeps an entry with tracked:false (the override IS the data). An empty
// per-user roster is exactly the fresh-start default: all seeds tracked.
//
//   • Production (Pages Function /api/channels): Workers KV → `kvChannelStore`.
//   • Local dev (Vite middleware):       one JSON file per roster → channelStore.node.ts.
//
// Last-write-wins on the whole list is acceptable: every write is scoped to one
// user's own roster (or the anonymous one), so a race only ever drops that same
// user's concurrent edit — and the client's localStorage mirror re-pushes it.
// ─────────────────────────────────────────────────────────────────────────────

export const CHANNELS_KEY = 'channels:v1'

/** Per-user roster key; null uid (anonymous) → the legacy global key. The
 *  `u:<uid>:` prefix groups all of one user's keys (future list/cleanup) and
 *  cannot collide with the `sum:`/`channels:` namespaces. */
export const channelsKeyFor = (uid: string | null): string => (uid ? `u:${uid}:channels:v1` : CHANNELS_KEY)
const MAX_CHANNELS = 300 // roster cap — guards the KV value from unbounded growth
const MERGE_CAP = 200 // most entries accepted in one bulk migration

export interface ChannelStore {
  /** The stored roster; [] when none yet; null when the read FAILED (callers
   *  must not write a list rebuilt from null — that would clobber the roster). */
  get(): Promise<Podcast[] | null>
  /** Persists the roster. Best-effort — a lost write self-heals on the next one. */
  put(list: Podcast[]): Promise<void>
}

/** Cloudflare Workers KV backend (production). Eventually consistent (~60s);
 *  the client's localStorage mirror covers the propagation window. `key` picks
 *  the roster — per-user via channelsKeyFor(uid), legacy global by default. */
export function kvChannelStore(kv: KVNamespace, key: string = CHANNELS_KEY): ChannelStore {
  return {
    async get() {
      try {
        const v = await kv.get(key, 'json')
        if (v === null || v === undefined) return []
        return Array.isArray(v) ? (v as Podcast[]) : null
      } catch {
        return null
      }
    },
    async put(list) {
      try {
        await kv.put(key, JSON.stringify(list))
      } catch {
        // Quota/transient failure — the client's local mirror still has the data
        // and re-pushes on its next mutation or boot migration.
      }
    },
  }
}

const str = (v: unknown, max: number, fallback = ''): string =>
  typeof v === 'string' && v ? v.slice(0, max) : fallback

const ACCESS: readonly FeedAccess[] = ['open', 'partial', 'private', 'paid', 'closed']
const MAX_FEEDS = 6 // a pooled show's feed list — matches MAX_POOLED_FEEDS server-side

/** The `feeds` of a pooled show, coerced from an untrusted payload. Each entry
 *  needs a URL; access/label are optional garnish and are dropped when unusable. */
function sanitizeFeeds(raw: unknown): PodcastFeed[] {
  if (!Array.isArray(raw)) return []
  const out: PodcastFeed[] = []
  for (const item of raw.slice(0, MAX_FEEDS)) {
    if (!item || typeof item !== 'object') continue
    const x = item as Record<string, unknown>
    const feedUrl = str(x.feedUrl, 600)
    if (!feedUrl || out.some((f) => f.feedUrl === feedUrl)) continue
    const feed: PodcastFeed = { feedUrl }
    const access = str(x.access, 20)
    const label = str(x.label, 40)
    if ((ACCESS as readonly string[]).includes(access)) feed.access = access as FeedAccess
    if (label) feed.label = label
    out.push(feed)
  }
  return out
}

/** Coerce an untrusted wire object into a storable Podcast (or null). Strings are
 *  length-capped so one hostile/buggy payload can't bloat the shared roster. */
export function sanitizeChannel(raw: unknown): Podcast | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  const id = str(x.id, 200)
  const title = str(x.title, 300)
  if (!id || !title) return null
  const channel: Podcast = {
    id,
    title,
    author: str(x.author, 200),
    category: str(x.category, 100, 'Podcast'),
    description: str(x.description, 600),
    cadence: str(x.cadence, 60, 'Weekly'),
    episodeCount:
      typeof x.episodeCount === 'number' && Number.isFinite(x.episodeCount) ? Math.max(0, Math.floor(x.episodeCount)) : 0,
    source: x.source === 'youtube' ? 'youtube' : 'podcast',
    color: str(x.color, 60, '#6366f1'),
    monogram: str(x.monogram, 8, title.slice(0, 2).toUpperCase()),
    tracked: x.tracked !== false,
  }
  const artworkUrl = str(x.artworkUrl, 600)
  const feeds = sanitizeFeeds(x.feeds)
  // A pooled show's primary feed is the first of its list, so the roster stays
  // readable by anything that only knows `feedUrl`.
  const feedUrl = str(x.feedUrl, 600) || feeds[0]?.feedUrl || ''
  if (artworkUrl) channel.artworkUrl = artworkUrl
  if (feedUrl) channel.feedUrl = feedUrl
  if (feeds.length > 1) channel.feeds = feeds
  return channel
}

/** Upsert one channel into the roster (newest first). Returns null on invalid
 *  input. Untracking a non-seed show removes it; a seed keeps a tracked:false
 *  override so the default never resurfaces it. */
export function applyUpsert(list: Podcast[], raw: unknown, seedIds: ReadonlySet<string>): Podcast[] | null {
  const ch = sanitizeChannel(raw)
  if (!ch) return null
  const rest = list.filter((p) => p && p.id !== ch.id)
  if (!ch.tracked && !seedIds.has(ch.id)) return rest
  return [ch, ...rest].slice(0, MAX_CHANNELS)
}

/** Bulk-merge (one-time client migration): adds only ids the roster doesn't
 *  already have — the server copy always wins over a stale local cache. */
export function applyMerge(list: Podcast[], rawList: unknown): { next: Podcast[]; added: number } {
  const incoming = Array.isArray(rawList) ? rawList.slice(0, MERGE_CAP) : []
  const have = new Set(list.map((p) => p?.id))
  const fresh: Podcast[] = []
  for (const raw of incoming) {
    const ch = sanitizeChannel(raw)
    if (ch && ch.tracked && !have.has(ch.id)) {
      have.add(ch.id)
      fresh.push(ch)
    }
  }
  // Migrated entries are older knowledge than what's already stored → append, then
  // cap from the front. Derive `added` from what actually SURVIVED the cap, so we
  // never tell the client (or skip a needed write because) entries were added that
  // the slice silently dropped at MAX_CHANNELS.
  const next = [...list, ...fresh].slice(0, MAX_CHANNELS)
  return { next, added: next.length - list.length }
}

/** The whole /api/channels endpoint, runtime-agnostic — the Pages Function and
 *  the Vite dev middleware are thin wrappers around this one implementation. */
export async function handleChannels(
  store: ChannelStore | null,
  method: string,
  rawBody: string,
  seedIds: ReadonlySet<string>,
): Promise<{ status: number; body: unknown }> {
  if (method === 'GET') {
    // No store / failed read degrades to [] — the client falls back to its
    // local mirror; only mutations must hard-fail to avoid clobbering data.
    const list = store ? await store.get() : []
    return { status: 200, body: list ?? [] }
  }
  if (method !== 'POST' && method !== 'PUT') return { status: 405, body: { error: 'method_not_allowed' } }
  if (!store) return { status: 503, body: { error: 'no_channel_store' } }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody || '{}') as Record<string, unknown>
  } catch {
    return { status: 400, body: { error: 'bad_json' } }
  }

  const current = await store.get()
  if (current === null) return { status: 503, body: { error: 'store_unreachable' } }

  if (method === 'POST') {
    const next = applyUpsert(current, parsed.podcast, seedIds)
    if (!next) return { status: 400, body: { error: 'invalid_podcast' } }
    await store.put(next)
    return { status: 200, body: { ok: true } }
  }
  const { next, added } = applyMerge(current, parsed.podcasts)
  if (added > 0) await store.put(next)
  return { status: 200, body: { ok: true, added } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Roster enumeration — how the cron learns about USER-ADDED channels.
//
// The auto-processor (server/weeklyDigest.ts) used to see only the curated seed
// shows hardcoded in server/feeds.ts, because that is all getLiveEpisodes walks.
// Every channel a user added from Discover was therefore invisible to it: its
// episodes stayed "detected" forever and only the in-app "Process all" button
// could summarise them. These helpers give the cron the missing half — the union
// of every roster's user-added shows — so auto-processing covers what people
// actually selected, not just the built-in list.
// ─────────────────────────────────────────────────────────────────────────────

/** Roster keys stored in KV: the legacy global one plus every per-user
 *  `u:<uid>:channels:v1`. Returns [] when the binding can't enumerate (the dev
 *  file mirror, or a `list` failure) — callers then simply see no extra rosters,
 *  which is exactly the old seed-only behavior. */
export async function listRosterKeys(kv: KVNamespace, maxRosters = 500): Promise<string[]> {
  if (typeof kv.list !== 'function') return []
  const keys: string[] = []
  let cursor: string | undefined
  try {
    // Page through the `u:` namespace. Every per-user key lives under it, so one
    // prefixed scan covers all of them without walking the summary cache.
    do {
      const page = await kv.list({ prefix: 'u:', cursor, limit: 1000 })
      for (const k of page.keys) if (k.name.endsWith(':channels:v1')) keys.push(k.name)
      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor && keys.length < maxRosters)
  } catch {
    // A partial scan is still useful — keep whatever we already collected.
  }
  return [CHANNELS_KEY, ...keys].slice(0, maxRosters)
}

/** Every user-added show across the given rosters, de-duplicated by id — the shows
 *  the cron must fetch feeds for on top of the seed sources. A null roster is a
 *  FAILED read and contributes nothing (never mistaken for "this user has none").
 *
 *  Seed shows are excluded: SOURCES already covers them, and a roster's seed entry
 *  is only a tracked:true/false override with no feed of its own. Entries with no
 *  feed URL are dropped (nothing to fetch), as are untracked ones — a show somebody
 *  deselected should not cost an LLM call.
 *
 *  Pure, so both backends (KV and the dev files) share one definition of "the
 *  channels to auto-process" and it can be tested without a store. */
export function selectTrackedChannels(
  rosters: (Podcast[] | null)[],
  seedIds: ReadonlySet<string>,
  maxChannels = 200,
): Podcast[] {
  const byId = new Map<string, Podcast>()
  for (const roster of rosters) {
    if (!roster) continue // a failed read contributes nothing
    for (const ch of roster) {
      if (!ch || typeof ch.id !== 'string') continue
      if (seedIds.has(ch.id)) continue // already covered by the seed sources
      if (ch.tracked === false) continue
      if (!ch.feedUrl && !ch.feeds?.length) continue // nothing to fetch
      if (!byId.has(ch.id)) byId.set(ch.id, ch)
    }
  }
  // Stable order (by id) so the rotation window in server/feeds.ts advances over a
  // fixed list rather than reshuffling between ticks.
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, maxChannels)
}

/** `selectTrackedChannels` over every roster in a KV namespace (production). */
export async function collectTrackedChannels(
  kv: KVNamespace,
  seedIds: ReadonlySet<string>,
  maxChannels = 200,
): Promise<Podcast[]> {
  const keys = await listRosterKeys(kv)
  if (!keys.length) return []
  const settled = await Promise.allSettled(keys.map((key) => kvChannelStore(kv, key).get()))
  return selectTrackedChannels(
    settled.map((r) => (r.status === 'fulfilled' ? r.value : null)),
    seedIds,
    maxChannels,
  )
}

/** `selectTrackedChannels` over an explicit set of stores — the dev middleware's
 *  path, where each roster is a file rather than a KV key. */
export async function collectTrackedChannelsFrom(
  stores: ChannelStore[],
  seedIds: ReadonlySet<string>,
  maxChannels = 200,
): Promise<Podcast[]> {
  const settled = await Promise.allSettled(stores.map((s) => s.get()))
  return selectTrackedChannels(
    settled.map((r) => (r.status === 'fulfilled' ? r.value : null)),
    seedIds,
    maxChannels,
  )
}
