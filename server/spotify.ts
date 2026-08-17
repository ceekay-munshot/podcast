import type { PodcastSearchResult } from '../src/lib/types'
import { knownShowBySpotifyId, knownShowByTerm, knownShowResults } from '../src/lib/knownSources'

// ─────────────────────────────────────────────────────────────────────────────
// Spotify show URLs in Discover — keyless, no Spotify app credentials.
//
// The hard constraint: Spotify publishes NO feed. Not for free shows, not for
// paid ones. So a pasted show URL can never become the thing we ingest; it can
// only tell us WHICH show is meant and whether Spotify would even let anyone
// stream it. From there:
//
//   free show   → find its real public RSS in the directory (by exact title) and
//                 hand back THAT — the feed is what gets fetched, not Spotify.
//   paid show   → a locked "paid" card plus every free source we know for the
//                 show, so the user leaves with something trackable instead of a
//                 dead end.
//   no feed and
//   free anyway → a locked "closed" card. Honest: a platform exclusive is not a
//                 paywall, and must not be labelled as one.
//
// Both signals come from Spotify's own embed page, which is public HTML with a
// __NEXT_DATA__ blob: `isPlayable: true / playabilityReason: "PLAYABLE"` for a
// show anyone can stream, `isPlayable: false / "UNAVAILABLE"` for a
// subscriber-only one. oEmbed is the fallback for artwork + name.
//
// open.spotify.com is a fixed host (never user-controlled once the id is parsed
// out), so these calls use plain fetch — same as the iTunes calls in search.ts.
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'MunshotPodcasts/1.0 (+https://munshot.io)'
const TIMEOUT_MS = 9000

/** Spotify ids are 22-char base62. */
const SHOW_ID = /^[A-Za-z0-9]{22}$/

function isSpotifyHost(hostname: string): boolean {
  const h = hostname.replace(/^www\./, '').toLowerCase()
  return h === 'open.spotify.com' || h === 'play.spotify.com'
}

/** True for any URL/URI this module can resolve — the routing test in search.ts. */
export function isSpotifyShowUrl(raw: string): boolean {
  return spotifyShowId(raw) !== null
}

/** The show id in a Spotify link: web URLs (`/show/<id>`, locale-prefixed
 *  `/intl-de/show/<id>`, `/embed/show/<id>`) and the `spotify:show:<id>` URI.
 *  Null for episode/album/playlist links, other hosts, and anything malformed. */
export function spotifyShowId(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  const uri = s.match(/^spotify:show:([A-Za-z0-9]{22})$/i)
  if (uri) return uri[1]
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (!isSpotifyHost(u.hostname)) return null
  // …/show/<id>, with an optional /intl-xx and/or /embed prefix before it.
  const seg = u.pathname.split('/').filter(Boolean)
  const at = seg.lastIndexOf('show')
  if (at < 0) return null
  const id = seg[at + 1] || ''
  return SHOW_ID.test(id) ? id : null
}

export interface SpotifyShowMeta {
  /** The show's name (not the episode's). */
  name: string
  /** Publisher, when the page carries one. */
  author?: string
  artworkUrl?: string
  /** True when Spotify would let anyone stream it; false for subscriber-only. */
  playable: boolean
  /** Spotify's own word for why not — 'UNAVAILABLE' on a paid show. */
  reason?: string
}

interface EmbedEntity {
  type?: string
  name?: string
  subtitle?: string
  isPlayable?: boolean
  playabilityReason?: string
  coverArt?: { sources?: { url?: string; width?: number; height?: number }[] }
  relatedEntityCoverArt?: { url?: string; maxWidth?: number; maxHeight?: number }[]
}

function bestArt(entity: EmbedEntity): string | undefined {
  // Prefer the largest image at or below 640px — the size the cards render at.
  const candidates = [
    ...(entity.coverArt?.sources ?? []).map((s) => ({ url: s.url, w: s.width ?? 0 })),
    ...(entity.relatedEntityCoverArt ?? []).map((s) => ({ url: s.url, w: s.maxWidth ?? 0 })),
  ].filter((c): c is { url: string; w: number } => typeof c.url === 'string' && /^https:\/\//.test(c.url))
  if (!candidates.length) return undefined
  const within = candidates.filter((c) => c.w <= 640)
  const pick = (within.length ? within : candidates).reduce((a, b) => (b.w > a.w ? b : a))
  return pick.url
}

/** Pull the show metadata out of an embed page's __NEXT_DATA__ blob. Pure, so the
 *  paid/free discrimination is unit-tested without touching the network.
 *
 *  The embed for a SHOW resolves to its newest episode, where the show's own name
 *  is the `subtitle` — reading `name` there would title the card with an episode. */
export function parseSpotifyEmbed(html: string): SpotifyShowMeta | null {
  const blob = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1]
  if (!blob) return null
  let entity: EmbedEntity
  try {
    const data = JSON.parse(blob) as { props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } } }
    entity = data.props?.pageProps?.state?.data?.entity ?? {}
  } catch {
    return null
  }
  // A dead/unknown id still renders a page, just with an empty entity.
  const isEpisode = entity.type === 'episode'
  const name = ((isEpisode ? entity.subtitle : entity.name) || '').trim()
  if (!name) return null
  return {
    name,
    author: isEpisode ? undefined : (entity.subtitle || '').trim() || undefined,
    artworkUrl: bestArt(entity),
    // Absent field → assume streamable rather than inventing a paywall.
    playable: entity.isPlayable !== false,
    reason: (entity.playabilityReason || '').trim() || undefined,
  }
}

interface Oembed {
  title?: string
  thumbnail_url?: string
}

/** oEmbed fallback: enough to name and illustrate the card when the embed page
 *  changes shape. Its `title` is the newest EPISODE, so it can only fill in for a
 *  missing name — never override the embed's. */
export function parseSpotifyOembed(json: unknown): { title?: string; artworkUrl?: string } {
  const o = (json ?? {}) as Oembed
  const art = typeof o.thumbnail_url === 'string' && /^https:\/\//.test(o.thumbnail_url) ? o.thumbnail_url : undefined
  return { title: typeof o.title === 'string' ? o.title.trim() || undefined : undefined, artworkUrl: art }
}

async function getText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*', 'accept-language': 'en' },
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/** Live show metadata for an id, or null when Spotify knows no such show. */
export async function fetchSpotifyShowMeta(id: string): Promise<SpotifyShowMeta | null> {
  if (!SHOW_ID.test(id)) return null
  const showUrl = `https://open.spotify.com/show/${id}`
  const [embedHtml, oembedRaw] = await Promise.all([
    getText(`https://open.spotify.com/embed/show/${id}`),
    getText(`https://open.spotify.com/oembed?url=${encodeURIComponent(showUrl)}`),
  ])
  let oembed: { title?: string; artworkUrl?: string } = {}
  if (oembedRaw) {
    try {
      oembed = parseSpotifyOembed(JSON.parse(oembedRaw))
    } catch {
      /* not JSON — the embed page is the primary source anyway */
    }
  }
  const meta = embedHtml ? parseSpotifyEmbed(embedHtml) : null
  if (meta) return { ...meta, artworkUrl: meta.artworkUrl ?? oembed.artworkUrl }
  // No usable embed. oEmbed alone can't tell free from paid, and guessing either
  // way would mislabel the show — so only claim what a 200 proves: it exists.
  if (!oembed.title) return null
  return { name: oembed.title, artworkUrl: oembed.artworkUrl, playable: true }
}

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')

/** Directory hits that are plausibly the SAME show as `name`. Strict on purpose:
 *  "Stratechery" loosely matched would hand back Sharp Tech and Exponent — real
 *  shows, wrong answer, and tracked under the name the user asked for. */
export function titleMatches(name: string, results: PodcastSearchResult[]): PodcastSearchResult[] {
  const want = norm(name)
  if (!want) return []
  return results.filter((r) => {
    const got = norm(r.title)
    return got === want || got.startsWith(`${want} `) || want.startsWith(`${got} `)
  })
}

export interface SpotifyResolveOpts {
  /** Plain-text directory search (Apple → fyyd), injected by server/search.ts so
   *  this module doesn't import back into it. */
  directory: (term: string, limit: number) => Promise<PodcastSearchResult[]>
  limit?: number
}

/** A pasted Spotify show URL → the cards Discover should show for it. [] when the
 *  URL isn't a Spotify show or the show can't be resolved at all. */
export async function resolveSpotifyShow(rawUrl: string, opts: SpotifyResolveOpts): Promise<PodcastSearchResult[]> {
  const id = spotifyShowId(rawUrl)
  if (!id) return []
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 50))
  const meta = await fetchSpotifyShowMeta(id)
  const known = knownShowBySpotifyId(id) ?? (meta ? knownShowByTerm(meta.name) : null)
  // Spotify unreachable (bot wall, outage) but the show is one we know: the
  // registry already holds everything the live lookup would have told us.
  if (!meta) return known ? knownShowResults(known) : []

  const showUrl = `https://open.spotify.com/show/${id}`
  // Whatever Spotify says, the ingestible thing is a public RSS feed — look for
  // one under the show's real name.
  const feeds = titleMatches(meta.name, await opts.directory(meta.name, limit))

  if (known) {
    // Curated, hand-verified sources win over a directory guess; anything the
    // directory found that the registry doesn't already cover rides along.
    const cards = knownShowResults(known)
    const seen = new Set(cards.map((c) => c.id))
    return [...cards, ...feeds.filter((f) => !seen.has(f.id))]
  }

  if (meta.playable) {
    // Free to stream. The feed IS the answer when we found one; when we didn't,
    // it's a Spotify exclusive — no feed anywhere, and not a paywall.
    if (feeds.length) return feeds
    return [
      spotifyCard(id, meta, showUrl, {
        access: 'closed',
        note: `Only on Spotify — the show publishes no feed, so episodes can't be fetched.`,
      }),
    ]
  }

  return [
    spotifyCard(id, meta, showUrl, {
      access: 'paid',
      note:
        meta.reason === 'UNAVAILABLE'
          ? `Subscriber-only on Spotify — no public feed, so paid episodes can't be fetched.`
          : `Spotify won't stream this show to us${meta.reason ? ` (${meta.reason.toLowerCase()})` : ''} and publishes no feed for it.`,
    }),
    ...feeds,
  ]
}

// A show the registry doesn't cover: we can say it's paywalled (Spotify told us),
// but not where its member feed comes from — so no `memberFeedPage`. The Discover
// callout falls back to generic "find it in your account settings" wording.
function spotifyCard(
  id: string,
  meta: SpotifyShowMeta,
  showUrl: string,
  access: { access: 'paid' | 'closed'; note: string },
): PodcastSearchResult {
  return {
    id: `spotify-${id}`,
    title: meta.name,
    author: meta.author ?? '',
    category: 'Podcast',
    description: '',
    artworkUrl: meta.artworkUrl,
    feedUrl: '', // nothing to fetch — the card renders locked
    source: 'podcast',
    access: access.access,
    accessNote: access.note,
    webUrl: showUrl,
  }
}
