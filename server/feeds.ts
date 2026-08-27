import type { Episode, Podcast, PodcastFeed } from '../src/lib/types'
import { EPISODES, PODCASTS } from '../src/lib/mock-data'
import { KNOWN_SHOWS, MEMBER_FEED_LABEL } from '../src/lib/knownSources'
import { feedsOf, mergeFeeds, poolEpisodes } from '../src/lib/pool'
import { sharedSummaryKey, type SummaryStore } from './summaryStore'
import { isPublicHttpUrl, safeFetch } from './safeUrl'

// ─────────────────────────────────────────────────────────────────────────────
// Live feed fetching — runtime-agnostic (runs in the Vite dev middleware AND in
// the Cloudflare Pages Function). Pulls each show's real podcast RSS, parses the
// latest episodes, and maps them to the app's Episode shape. Keyless.
//
// Shows with no clean public feed (Stratechery is subscriber-only; "Access" has
// no resolvable feed) fall back to that show's seeded episodes, so the dashboard
// is always populated. A feed that errors or times out also falls back per-source.
// Discover offers those shows' free/member sources instead — src/lib/knownSources.ts.
// ─────────────────────────────────────────────────────────────────────────────

interface Source {
  id: string // matches a Podcast.id in mock-data
  feedUrl: string | null // verified real RSS feed; null → seed fallback
  /** For a show published in several places: every feed, pooled into one
   *  de-duplicated episode list. Takes precedence over `feedUrl`. */
  feeds?: PodcastFeed[]
}

// Feed URLs resolved + verified via the iTunes Search API.
const SOURCES: Source[] = [
  // Pooled: the free YouTube video + the article feed, and the subscriber's own
  // member feed when one is configured (see memberFeedsFor below). The paid podcast
  // itself has no public feed — server/spotify.ts explains that side.
  { id: 'stratechery', feedUrl: null, feeds: [...(KNOWN_SHOWS.find((s) => s.key === 'stratechery')?.feeds ?? [])] },
  { id: 'iltb', feedUrl: 'https://feeds.megaphone.fm/CLS2859450455' },
  { id: 'allin', feedUrl: 'https://rss.libsyn.com/shows/254861/destinations/1928300.xml' },
  { id: 'oddlots', feedUrl: 'https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/8a94442e-5a74-4fa2-8b8d-ae27003a8d6b/982f5071-765c-403d-969d-ae27003a8d83/podcast.rss' },
  { id: 'aidaily', feedUrl: 'https://anchor.fm/s/f7cac464/podcast/rss' },
  { id: 'ingoodcompany', feedUrl: 'https://feeds.acast.com/public/shows/622618c7057f3400120d15db' },
  { id: 'acquired', feedUrl: 'https://feeds.transistor.fm/acquired' },
  { id: 'cheekypint', feedUrl: 'https://feeds.transistor.fm/cheeky-pint-with-john-collison' },
  // Substack: one feed carries both the written dispatches and the occasional
  // audio drop. Written items enclose a hero IMAGE, not audio — see audioEnclosure().
  { id: 'sources', feedUrl: 'https://sources.news/feed' },
  { id: 'access', feedUrl: null }, // no resolvable public feed
  { id: 'bg2', feedUrl: 'https://anchor.fm/s/f06c2370/podcast/rss' },
  { id: 'lennys', feedUrl: 'https://api.substack.com/feed/podcast/10845.rss' },
  { id: 'benmarc', feedUrl: 'https://feeds.simplecast.com/mAT9rqvu' },
]

/** Ids of the curated seed shows. The channel roster (server/channelStore.ts)
 *  needs them: untracking a seed stores a tracked:false override, while
 *  untracking a user-added show deletes its entry outright. */
export const SEED_IDS: ReadonlySet<string> = new Set(SOURCES.map((s) => s.id))

const PER_SOURCE = 4 // recent episodes to surface per show
// A pooled show reads MORE per feed, then trims after merging. Its feeds publish on
// their own schedules — the video edit of an instalment can land a week after the
// audio drop — so taking only the newest few from each would leave the windows
// barely overlapping and the duplicates never meeting to be removed.
const POOL_PER_FEED = 10
const POOLED_MAX = 12 // episodes kept after merging — the pooled list stays a list

// Stream only the head of a feed — items are newest-first, so the first ~800 KB
// (or first `maxItems` closed <item>/<entry>s) covers the recent episodes without
// downloading multi-megabyte archives. A pooled show asks for more items, since it
// has to reach back far enough for its feeds' publish windows to overlap.
// Goes through safeFetch so redirects are followed manually and every hop is
// re-validated against the SSRF guard.
export async function fetchFeedHead(url: string, maxBytes = 800_000, timeoutMs = 9000, maxItems = 8): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'MunshotPodcasts/1.0 (+https://munshot.io)',
        accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    })
    if (!res || !res.ok || !res.body) return ''
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let text = ''
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (received >= maxBytes || (text.match(/<\/(?:item|entry)>/gi)?.length ?? 0) >= maxItems) {
        await reader.cancel().catch(() => {})
        break
      }
    }
    return text
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

export function innerTag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1] : ''
}

export function attrOf(block: string, tag: string, attr: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m ? m[1] : ''
}

// Best publisher-provided transcript URL in an item (Podcasting 2.0 tag): prefer SRT, then VTT.
function transcriptUrlFrom(block: string): string {
  const tags = block.match(/<podcast:transcript\b[^>]*>/gi) || []
  if (!tags.length) return ''
  const urlOf = (tag: string) => (tag.match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1] || '').replace(/&amp;/g, '&')
  const srt = tags.find((t) => /application\/srt|format=SubRip/i.test(t))
  const vtt = tags.find((t) => /text\/vtt|format=WebVTT/i.test(t))
  return urlOf(srt || vtt || tags[0] || '')
}

// The item's AUDIO enclosure, or '' when it has none. `<enclosure>` is not
// audio-only — Substack-hosted feeds enclose a hero image on every written post —
// so an untyped read would hand a JPEG to Whisper (a real download + upload, then
// a guaranteed failure). Trust the declared MIME type, falling back to the file
// extension for the feeds that leave `type` off.
export function audioEnclosure(block: string): string {
  for (const tag of block.match(/<enclosure\b[^>]*>/gi) || []) {
    const url = (tag.match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1] || '').trim()
    if (!url) continue
    const type = tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || ''
    if (type ? /^audio\//i.test(type) : /\.(mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i.test(url)) return url
  }
  return ''
}

export function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

export function decodeEntities(s: string): string {
  // Astral-safe: fromCodePoint (not fromCharCode) so emoji / rare CJK survive; an
  // out-of-range code point decodes to nothing rather than throwing RangeError.
  const cp = (n: number) => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '')
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => cp(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    // `&amp;` LAST: an already-escaped sequence like `&amp;lt;` (the literal text
    // "&lt;") must decode exactly once to "&lt;", not collapse all the way to "<".
    .replace(/&amp;/g, '&')
}

export function plainText(s: string): string {
  return decodeEntities(unwrapCdata(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

function parseDuration(raw: string): number {
  const s = unwrapCdata(raw).trim()
  if (!s) return 0
  if (s.includes(':')) {
    return s.split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0)
  }
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function mockFor(podcastId: string): Episode[] {
  // Shallow-clone each match: overlaySummaries mutates status/summary in place, and
  // these are references into the module-level EPISODES singleton — mutating them
  // would leak one request's overlaid summary into every later request on a warm isolate.
  return EPISODES.filter((e) => e.podcastId === podcastId).map((e) => ({ ...e }))
}

// Tiny, dependency-free, stable string hash → short base36 token. Used to build a
// stable episode id from the feed's own identifiers, so it survives reordering.
export function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function parseEpisodes(xml: string, podcastId: string, limit = PER_SOURCE): Episode[] {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0])
  const out: Episode[] = []
  for (const block of blocks) {
    if (out.length >= limit) break // take the first `limit` *valid* items, not raw items
    const title = decodeEntities(unwrapCdata(innerTag(block, 'title'))).trim()
    if (!title) continue
    const pub = unwrapCdata(innerTag(block, 'pubDate')).trim()
    const parsed = pub ? new Date(pub) : null
    const publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
    // Decode entities on the URLs too — RSS routinely XML-escapes query separators
    // (`?a=1&amp;b=2`), and a literal "&amp;" in audioUrl makes the Whisper fetch 404.
    const audioUrl = decodeEntities(audioEnclosure(block))
    const link = decodeEntities(unwrapCdata(innerTag(block, 'link')).trim()) || audioUrl
    const guid = plainText(innerTag(block, 'guid'))
    // Two fields, two jobs. Podcast feeds put the show notes in <description> and
    // little or nothing in <content:encoded>; Substack inverts that — a one-line
    // editor's subtitle in <description>, the written piece in <content:encoded>.
    // So the teaser takes <description> when there is one (it's the hand-written
    // précis) and the AI's material takes whichever field is actually longer.
    const teaser = plainText(innerTag(block, 'description'))
    const body = plainText(innerTag(block, 'content:encoded'))
    const notes = body.length > teaser.length ? body : teaser
    // Stable id from the feed's own identifiers (guid → link → title+date) rather
    // than the item's position. The old positional index shifted every time a new
    // episode published, which would re-point a saved summary at the wrong episode.
    const identity = guid || link || `${title}|${publishedAt}`
    out.push({
      id: `live-${podcastId}-${hashKey(identity)}`,
      podcastId,
      title,
      publishedAt,
      durationSec: parseDuration(innerTag(block, 'itunes:duration')),
      status: 'detected', // real episode found on the feed; AI summary not yet generated
      signal: 'normal',
      blurb: truncate(teaser || notes, 200) || 'New episode — open the source to listen.',
      sourceUrl: link || undefined,
      notes: notes ? notes.slice(0, 2500) : undefined, // fallback material for the AI summary
      transcriptUrl: transcriptUrlFrom(block) || undefined, // free publisher transcript, when present
      audioUrl: audioUrl || undefined, // for Whisper providers
      entities: { people: [], companies: [], themes: [] },
    })
  }
  return out
}

// YouTube channel feeds are Atom (<entry>), not RSS (<item>). Map each entry to
// the app's Episode shape. No audio enclosure / transcript / duration exists in
// a YouTube feed, so those stay undefined and durationSec is 0.
export function parseAtomEntries(xml: string, podcastId: string, limit = PER_SOURCE): Episode[] {
  const blocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0])
  const out: Episode[] = []
  for (const block of blocks) {
    if (out.length >= limit) break // first `limit` *valid* entries, not raw entries
    const title = decodeEntities(unwrapCdata(innerTag(block, 'title'))).trim()
    if (!title) continue
    const pub = unwrapCdata(innerTag(block, 'published')).trim() || unwrapCdata(innerTag(block, 'updated')).trim()
    const parsed = pub ? new Date(pub) : null
    const publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
    const link = decodeEntities((block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i)?.[1] || attrOf(block, 'link', 'href')).trim())
    const videoId = plainText(innerTag(block, 'yt:videoId')) || plainText(innerTag(block, 'id'))
    const notes = plainText(innerTag(block, 'media:description'))
    const identity = videoId || link || `${title}|${publishedAt}`
    out.push({
      id: `live-${podcastId}-${hashKey(identity)}`,
      podcastId,
      title,
      publishedAt,
      durationSec: 0,
      status: 'detected',
      signal: 'normal',
      blurb: truncate(notes, 200) || 'New video — open the source to watch.',
      sourceUrl: link || undefined,
      notes: notes ? notes.slice(0, 2500) : undefined,
      entities: { people: [], companies: [], themes: [] },
    })
  }
  return out
}

// Overlay summaries already in the shared store: an episode processed by ANY
// user flips to READY with its summary attached. Summary only — the bulky
// transcript is lazy-loaded on the detail page from the same store (a store hit
// there costs no LLM/transcription), keeping list responses lean.
async function overlaySummaries(episodes: Episode[], store?: SummaryStore): Promise<Episode[]> {
  if (!store) return episodes
  await Promise.all(
    episodes.map(async (e) => {
      const hit = await store.get(sharedSummaryKey(e.id)).catch(() => null)
      if (hit?.summary) {
        e.status = 'ready'
        e.summary = hit.summary
      }
    }),
  )
  return episodes
}

// Recent episodes for a SINGLE feed URL — the dynamic path used by user-added
// podcasts (and reused by the seed shows below). Validates the URL against the
// SSRF guard, picks the parser by sniffing RSS (<item>) vs Atom (<entry>), and
// returns the parsed episodes or []. NEVER falls back to mock data: a user feed
// that errors must show an empty list, not someone else's seeded content.
// Pass the shared summary store to overlay already-processed episodes as READY;
// the seed path (episodesForSource) deliberately does NOT pass it — seeds are
// overlaid once, in getLiveEpisodes, never twice.
export async function episodesForFeed(feedUrl: string, podcastId: string, store?: SummaryStore, limit = PER_SOURCE): Promise<Episode[]> {
  if (!isPublicHttpUrl(feedUrl)) return []
  // Reading deeper into a pooled feed needs more of the document than the default
  // head — otherwise the extra items simply aren't in the text we parsed. The +2 is
  // slack for items that turn out unusable (no title), so a deep read still yields
  // `limit` valid episodes.
  const deep = limit > PER_SOURCE
  const xml = await fetchFeedHead(feedUrl, deep ? 1_600_000 : undefined, deep ? 12_000 : undefined, deep ? limit + 2 : undefined)
  if (!xml) return []
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml)
  const episodes = isAtom ? parseAtomEntries(xml, podcastId, limit) : parseEpisodes(xml, podcastId, limit)
  return store ? overlaySummaries(episodes, store) : episodes
}

/** Most feeds one show may pool — bounds the work a single request can trigger. */
export const MAX_POOLED_FEEDS = 6

/** Recent episodes for a show published to SEVERAL feeds: fetch them all, then
 *  merge into one list with the same instalment appearing once (src/lib/pool.ts).
 *  A feed that fails contributes nothing and the rest still pool — a dead member
 *  feed must not empty the show. */
export async function episodesForFeeds(
  feeds: (PodcastFeed | string)[],
  podcastId: string,
  store?: SummaryStore,
  show?: { title?: string; author?: string },
): Promise<Episode[]> {
  const list = feeds
    .map((f) => (typeof f === 'string' ? { feedUrl: f } : f))
    .filter((f) => !!f?.feedUrl)
    .slice(0, MAX_POOLED_FEEDS)
  if (!list.length) return []
  if (list.length === 1) return episodesForFeed(list[0].feedUrl, podcastId, store)
  const settled = await Promise.allSettled(list.map((f) => episodesForFeed(f.feedUrl, podcastId, undefined, POOL_PER_FEED)))
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []))
  const pooled = poolEpisodes(lists, { labels: list.map((f) => f.label), show }).slice(0, POOLED_MAX)
  // Overlay AFTER pooling: the shared cache is keyed by the pooled episode's id,
  // which is the id the app will ask about.
  return store ? overlaySummaries(pooled, store) : pooled
}

async function episodesForSource(src: Source, memberFeeds?: MemberFeeds): Promise<Episode[]> {
  const feeds = mergeFeeds(src.feeds ?? (src.feedUrl ? [{ feedUrl: src.feedUrl }] : []), memberFeedsFor(src.id, memberFeeds))
  // No feed at all → locked show. Never serve its seed episodes: a fabricated
  // summary/transcript must not reach users. The UI renders it as a locked show.
  if (!feeds.length) return []
  const show = PODCASTS.find((p) => p.id === src.id)
  const episodes = await episodesForFeeds(feeds, src.id, undefined, show)
  // Seed shows may fall back to their seeded episodes if a live fetch comes back
  // empty (transient feed error) — this is the ONLY place that fallback lives.
  return episodes.length ? episodes : mockFor(src.id)
}

// ── Server-side member feeds (optional) ──────────────────────────────────────
// A member feed pasted in the app is stored per user, so it only reaches code
// paths that have a user: the browser session, and anything reading that user's
// roster. The Monday digest cron has NEITHER — it builds one shared edition from
// the seed sources below — so paid episodes can't reach the emailed brief unless
// the server itself holds the feed.
//
// MEMBER_FEEDS supplies exactly that, as ordinary deployment config:
//
//   MEMBER_FEEDS="stratechery=https://<publisher>.passport.online/feed/podcast/<token>"
//
// (comma- or newline-separated for several shows; the key is a seed show id.)
//
// Set it ONLY on a single-tenant deployment. The seed episode list is shared by
// everyone using the space, so a member feed here puts one subscriber's paid audio
// URLs in front of every visitor — fine for an internal/one-customer install,
// wrong for a multi-customer one, and a redistribution of content the publisher
// sold to one person. Unset (the default), everything below is inert.

export type MemberFeeds = Record<string, string[]>

/** Parse the MEMBER_FEEDS env value. Unparseable entries and unsafe URLs are
 *  dropped rather than failing the request; never throws. */
export function parseMemberFeeds(raw: string | undefined): MemberFeeds {
  const out: MemberFeeds = {}
  for (const entry of (raw || '').split(/[\n,]+/)) {
    const at = entry.indexOf('=')
    if (at <= 0) continue
    const id = entry.slice(0, at).trim()
    const url = entry.slice(at + 1).trim()
    if (!id || !isPublicHttpUrl(url)) continue
    ;(out[id] ??= []).push(url)
  }
  return out
}

function memberFeedsFor(showId: string, configured?: MemberFeeds): PodcastFeed[] {
  return (configured?.[showId] ?? []).map((feedUrl) => ({ feedUrl, access: 'private' as const, label: MEMBER_FEED_LABEL }))
}

/** Most user-added channels one cron tick fetches feeds for. Bounds the work a
 *  single tick can trigger; `episodesForChannels` rotates the window so a roster
 *  larger than this is still covered completely, just across several ticks. */
export const CHANNELS_PER_TICK = 40
const CHANNEL_CONCURRENCY = 6 // parallel feed fetches — polite to publishers, still quick

/** Recent episodes for user-added channels (a roster slice from
 *  channelStore.collectTrackedChannels), pooled per show and summary-overlaid
 *  exactly like the seed sources.
 *
 *  This is the auto-processor's second half: without it the cron only ever sees
 *  the curated SOURCES above, so anything added from Discover never gets picked
 *  up. Best-effort throughout — one dead feed contributes nothing and the rest
 *  still land.
 *
 *  `offset` rotates which slice of a long roster this tick reads (the cron passes
 *  a tick index), so every channel comes round rather than the first N starving
 *  the tail forever. */
export interface ChannelFetchOptions {
  /** Channels to read this call (default CHANNELS_PER_TICK). */
  limit?: number
  /** Where in the roster this call's window starts — the cron passes a tick index. */
  offset?: number
  /** Fetches one channel's episodes. Injected so tests don't hit the wire; production
   *  leaves it unset and gets the real pooled feed read. */
  fetchEpisodes?: (channel: Podcast, store?: SummaryStore) => Promise<Episode[]>
}

export async function episodesForChannels(
  channels: Podcast[],
  store?: SummaryStore,
  opts: ChannelFetchOptions = {},
): Promise<Episode[]> {
  const usable = channels.filter((c) => feedsOf(c).length > 0)
  if (!usable.length) return []
  const limit = Math.max(1, opts.limit ?? CHANNELS_PER_TICK)
  const fetchEpisodes =
    opts.fetchEpisodes ?? ((c: Podcast, s?: SummaryStore) => episodesForFeeds(feedsOf(c), c.id, s, { title: c.title, author: c.author }))
  // Rotate: start at `offset` and wrap, so consecutive ticks read consecutive
  // windows of the roster instead of re-reading the same head every time.
  const start = (((opts.offset ?? 0) % usable.length) + usable.length) % usable.length
  const window = Array.from({ length: Math.min(limit, usable.length) }, (_, i) => usable[(start + i) % usable.length])

  const out: Episode[] = []
  for (let i = 0; i < window.length; i += CHANNEL_CONCURRENCY) {
    const settled = await Promise.allSettled(window.slice(i, i + CHANNEL_CONCURRENCY).map((c) => fetchEpisodes(c, store)))
    for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value)
  }
  return out.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
}

/** Seed sources + the given user-added channels, as one de-duplicated episode
 *  list (an episode present in both keeps the seed copy). The episode universe
 *  the cron's auto-processor works over. */
export async function getAllEpisodes(
  store?: SummaryStore,
  memberFeeds?: MemberFeeds,
  channels: Podcast[] = [],
  opts: ChannelFetchOptions = {},
): Promise<Episode[]> {
  const [seeds, extra] = await Promise.all([
    getLiveEpisodes(store, memberFeeds),
    episodesForChannels(channels, store, opts).catch(() => [] as Episode[]),
  ])
  const byId = new Map<string, Episode>()
  for (const e of [...extra, ...seeds]) byId.set(e.id, e) // seeds last → seed copy wins
  return [...byId.values()].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
}

// All shows' recent episodes, newest first. Never throws — each source degrades
// to its seeded episodes independently. When a shared summary store is provided,
// episodes already processed by ANY user are overlaid as READY (with their tone),
// so the dashboard reflects shared state for everyone.
export async function getLiveEpisodes(store?: SummaryStore, memberFeeds?: MemberFeeds): Promise<Episode[]> {
  const settled = await Promise.allSettled(SOURCES.map((src) => episodesForSource(src, memberFeeds)))
  const episodes = settled.flatMap((r, i) => (r.status === 'fulfilled' ? r.value : mockFor(SOURCES[i].id)))
  await overlaySummaries(episodes, store)
  return episodes.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
}
