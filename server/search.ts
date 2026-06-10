import type { SourceKind } from '../src/lib/types'
import { isPublicHttpUrl, safeFetch } from './safeUrl'
import { attrOf, decodeEntities, fetchFeedHead, hashKey, innerTag, plainText, unwrapCdata } from './feeds'

// ─────────────────────────────────────────────────────────────────────────────
// Keyless podcast directory search. Runtime-agnostic (Vite dev middleware AND
// Cloudflare Pages Function), never throws — returns [] on any failure.
//
//   plain text  → Apple/iTunes Search API (free, no key)
//   apple URL   → iTunes lookup by collection id (…/id123456)
//   youtube URL → resolve the channel to its videos.xml RSS feed
//   rss URL     → accept the feed and read its channel metadata
//
// Every user-supplied URL (and the feedUrl a result carries) is validated by the
// SSRF guard before we fetch or return it. Fixed Apple hosts aren't user-
// controlled, so those calls use plain fetch.
// ─────────────────────────────────────────────────────────────────────────────

export interface PodcastSearchResult {
  id: string // itunes-<collectionId> | feed-<hashKey(feedUrl)> | yt-<channelId>
  title: string
  author: string
  category: string
  description: string
  artworkUrl?: string
  feedUrl: string // canonical RSS / YouTube videos.xml
  source: SourceKind
}

const UA = 'MunshotPodcasts/1.0 (+https://munshot.io)'
const LIMIT = 12

// Server-local — do NOT import the UI helper from src/lib/source.ts.
function isYouTubeHost(hostname: string): boolean {
  const h = hostname.replace(/^www\./, '').toLowerCase()
  return h === 'youtube.com' || h === 'youtu.be' || h.endsWith('.youtube.com')
}

// ── iTunes ───────────────────────────────────────────────────────────────────

interface ItunesPodcast {
  collectionId?: number
  collectionName?: string
  artistName?: string
  feedUrl?: string
  artworkUrl600?: string
  primaryGenreName?: string
}

function mapItunes(r: ItunesPodcast): PodcastSearchResult | null {
  const feedUrl = (r.feedUrl || '').trim()
  const title = (r.collectionName || '').trim()
  // Drop entries with no feed (can't ingest) or an unsafe feed URL.
  if (!title || !feedUrl || !isPublicHttpUrl(feedUrl)) return null
  return {
    id: `itunes-${r.collectionId ?? hashKey(feedUrl)}`,
    title,
    author: (r.artistName || '').trim(),
    category: (r.primaryGenreName || 'Podcast').trim(),
    description: '', // the Search/lookup API carries none — the card line-clamps an empty string fine
    artworkUrl: r.artworkUrl600 || undefined,
    feedUrl,
    source: 'podcast',
  }
}

async function itunesResults(url: string): Promise<PodcastSearchResult[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 9000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': UA } })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: ItunesPodcast[] }
    const rows = Array.isArray(data.results) ? data.results : []
    const seen = new Set<string>()
    const out: PodcastSearchResult[] = []
    for (const row of rows) {
      const mapped = mapItunes(row)
      if (!mapped || seen.has(mapped.id)) continue
      seen.add(mapped.id)
      out.push(mapped)
    }
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

const searchItunes = (term: string) =>
  itunesResults(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=${LIMIT}&term=${encodeURIComponent(term)}`)

const resolveAppleId = (id: string) =>
  itunesResults(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcast`)

// ── Raw RSS feed URL ──────────────────────────────────────────────────────────

// The channel-level <title> etc. — read AFTER stripping <item> blocks so an
// episode's title isn't mistaken for the show title.
async function resolveRssFeed(url: string): Promise<PodcastSearchResult[]> {
  if (!isPublicHttpUrl(url)) return []
  const xml = await fetchFeedHead(url, 200_000)
  if (!xml) return []
  const head = xml.replace(/<item\b[\s\S]*?<\/item>/gi, '')
  const title = decodeEntities(unwrapCdata(innerTag(head, 'title'))).trim()
  if (!title) return []
  const author =
    decodeEntities(unwrapCdata(innerTag(head, 'itunes:author'))).trim() ||
    decodeEntities(unwrapCdata(innerTag(head, 'managingEditor'))).trim()
  const category = attrOf(head, 'itunes:category', 'text').trim() || decodeEntities(unwrapCdata(innerTag(head, 'category'))).trim()
  const artworkUrl = attrOf(head, 'itunes:image', 'href').trim() || plainText(innerTag(innerTag(head, 'image'), 'url')).trim()
  return [
    {
      id: `feed-${hashKey(url)}`,
      title,
      author,
      category: category || 'Podcast',
      description: plainText(innerTag(head, 'description')).slice(0, 300),
      artworkUrl: artworkUrl || undefined,
      feedUrl: url,
      source: 'podcast',
    },
  ]
}

// ── YouTube channel URL → videos.xml RSS ──────────────────────────────────────

function youtubeHandleName(u: URL): string {
  const seg = u.pathname.split('/').filter(Boolean)
  const first = seg[0] || ''
  if (first.startsWith('@')) return first.slice(1)
  if ((first === 'c' || first === 'user') && seg[1]) return seg[1]
  return 'YouTube channel'
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (received >= maxBytes) {
        await reader.cancel().catch(() => {})
        break
      }
    }
  } catch {
    /* return whatever we managed to read */
  }
  return text
}

async function resolveYouTubeChannelId(rawUrl: string): Promise<string | null> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  const direct = u.pathname.match(/\/channel\/(UC[\w-]+)/i)
  if (direct) return direct[1]
  const param = u.searchParams.get('channel_id')
  if (param && /^UC[\w-]+$/.test(param)) return param
  // /@handle, /c/Name, /user/Name → scrape the channel page for the id.
  const res = await safeFetch(rawUrl, { headers: { 'user-agent': UA, accept: 'text/html,*/*' } })
  if (!res || !res.ok) return null
  const html = await readCapped(res, 300_000)
  const m =
    html.match(/"channelId":"(UC[\w-]+)"/) ||
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/channel\/(UC[\w-]+)/i) ||
    html.match(/\/channel\/(UC[\w-]+)/)
  return m ? m[1] : null
}

async function resolveYouTubeFeed(rawUrl: string): Promise<PodcastSearchResult[]> {
  if (!isPublicHttpUrl(rawUrl)) return []
  const channelId = await resolveYouTubeChannelId(rawUrl)
  if (!channelId) return []
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  const xml = await fetchFeedHead(feedUrl, 200_000)
  const head = xml.replace(/<entry\b[\s\S]*?<\/entry>/gi, '') // channel-level fields only
  let fallback = 'YouTube channel'
  try {
    fallback = youtubeHandleName(new URL(rawUrl))
  } catch {
    /* keep default */
  }
  const title = decodeEntities(unwrapCdata(innerTag(head, 'title'))).trim() || fallback
  const author = decodeEntities(unwrapCdata(innerTag(innerTag(head, 'author'), 'name'))).trim() || title
  return [{ id: `yt-${channelId}`, title, author, category: 'YouTube', description: '', feedUrl, source: 'youtube' }]
}

// ── Entry point ────────────────────────────────────────────────────────────────

export async function searchPodcasts(rawQuery: string): Promise<PodcastSearchResult[]> {
  const q = (rawQuery || '').trim()
  if (!q) return []
  if (/^https?:\/\//i.test(q)) {
    if (!isPublicHttpUrl(q)) return []
    let u: URL
    try {
      u = new URL(q)
    } catch {
      return []
    }
    const host = u.hostname.toLowerCase()
    if (host === 'apple.com' || host.endsWith('.apple.com')) {
      const id = u.pathname.match(/\/id(\d+)/)?.[1]
      return id ? resolveAppleId(id) : []
    }
    if (isYouTubeHost(host)) return resolveYouTubeFeed(q)
    return resolveRssFeed(q)
  }
  return searchItunes(q)
}
