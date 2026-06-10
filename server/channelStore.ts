import type { Podcast } from '../src/lib/types'
import type { KVNamespace } from './summaryStore'

// ─────────────────────────────────────────────────────────────────────────────
// Durable channel roster — the single source of truth for which shows are
// tracked, shared by every browser/device and unaffected by deploys.
//
// One KV value (no TTL → permanent) holding an array of Podcast entries:
//   • user-added shows (from Discover/search), stored in full with tracked:true;
//   • seed-show overrides — a curated show the user picked or untracked is stored
//     with its tracked flag, overriding the seed default on every client.
// Untracking a NON-seed show deletes its entry (forget the add); untracking a
// seed keeps an entry with tracked:false (the override IS the data).
//
//   • Production (Pages Function /api/channels): Workers KV → `kvChannelStore`.
//   • Local dev (Vite middleware):               one JSON file → channelStore.node.ts.
//
// Single-household app, so last-write-wins on the whole list is acceptable; the
// client also mirrors the list into localStorage as an offline fallback.
// ─────────────────────────────────────────────────────────────────────────────

export const CHANNELS_KEY = 'channels:v1'
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
 *  the client's localStorage mirror covers the propagation window. */
export function kvChannelStore(kv: KVNamespace): ChannelStore {
  return {
    async get() {
      try {
        const v = await kv.get(CHANNELS_KEY, 'json')
        if (v === null || v === undefined) return []
        return Array.isArray(v) ? (v as Podcast[]) : null
      } catch {
        return null
      }
    },
    async put(list) {
      try {
        await kv.put(CHANNELS_KEY, JSON.stringify(list))
      } catch {
        // Quota/transient failure — the client's local mirror still has the data
        // and re-pushes on its next mutation or boot migration.
      }
    },
  }
}

const str = (v: unknown, max: number, fallback = ''): string =>
  typeof v === 'string' && v ? v.slice(0, max) : fallback

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
  const feedUrl = str(x.feedUrl, 600)
  if (artworkUrl) channel.artworkUrl = artworkUrl
  if (feedUrl) channel.feedUrl = feedUrl
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
  // Migrated entries are older knowledge than what's already stored → append.
  return { next: [...list, ...fresh].slice(0, MAX_CHANNELS), added: fresh.length }
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
