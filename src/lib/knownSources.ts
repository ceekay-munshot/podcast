import { mergeFeeds } from './pool'
import type { FeedAccess, PodcastFeed, PodcastSearchResult, SourceKind } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Known paywalled shows + the sources we CAN actually ingest for them.
//
// Why a registry exists at all: a directory search can't tell you a show is
// paywalled. Searching "Stratechery" in Apple returns Sharp Tech, Exponent and
// Acquired — everything EXCEPT the show you asked for, because Stratechery
// publishes no public podcast feed. That's worse than useless: the user is left
// to guess whether the show is missing, broken, or simply not supported.
//
// So for the handful of shows the customer actually subscribes to, we record —
// by hand, each URL verified — what is paid, what is free, and where the member
// feed comes from. Every entry answers three questions honestly:
//   • which of the show's sources is behind a paywall (→ never presented as
//     something we can summarize),
//   • which we can fetch today (→ pooled into ONE trackable show),
//   • where the subscriber copies their OWN private feed from, since that is the
//     only way the paid episodes become reachable.
//
// One show, one card, one episode list. The show ships the same instalment as
// members-only audio, a free video and a written post; Discover offers a single
// pooled entry and the feeds are merged with duplicates removed (src/lib/pool.ts),
// rather than making the user track three lookalike shows and read three summaries
// of one thing.
//
// This registry deliberately does NOT try to guess at arbitrary shows. It exists
// to stop us from mislabelling the ones we know, in either direction: a paid show
// is never presented as fetchable, and a free show is never written off as paid.
//
// Shared by the browser and the server on purpose (client fast-path search in
// src/lib/api.ts, resolvers in server/search.ts + server/spotify.ts, seed feeds in
// server/feeds.ts) so every path produces the same show with the same id.
// ─────────────────────────────────────────────────────────────────────────────

export interface KnownShow {
  /** Canonical lowercase key. Also the show's id, so the seed catalog entry, the
   *  search card and a pasted member feed all resolve to ONE show. */
  key: string
  /** Lowercase search terms that should surface this show. */
  aliases: readonly string[]
  title: string
  author: string
  category: string
  description: string
  /** The dominant medium of the pooled show, for the cover glyph. */
  source: SourceKind
  artworkUrl?: string
  /** Access state of the pool as configured — 'partial' while the paid feed is
   *  missing (the free sources work, the paid instalments arrive as teasers). */
  access: FeedAccess
  accessNote: string
  /** The paywalled home of the show — a link, never a feed. */
  webUrl?: string
  /** One line about what is behind the paywall, for the Discover notice. */
  paidNote: string
  /** Feeds we can fetch, in priority order. Pooled into one episode list. */
  feeds: readonly PodcastFeed[]
  /** Spotify show id, when the paid show is distributed there. */
  spotifyShowId?: string
  /** Host serving this publisher's personal member feeds — how a pasted member
   *  URL is recognized as belonging to this show. */
  memberFeedHost?: string
  /** Where a subscriber copies their own private feed URL from. */
  memberFeedPage?: string
}

const STRATECHERY_ART = 'https://stratechery.com/wp-content/uploads/2020/05/Stratechery-Podcast-Artwork.png'
const STRATECHERY_YT_CHANNEL = 'UC9AHywQeW9BOcOl7dg-YMqA'

// Stratechery — Ben Thompson. The paid podcast (Daily Updates, Interviews, the
// Sharp Tech/China crossovers) reaches subscribers via Spotify and a personal
// Passport feed; neither is fetchable without the subscriber's own credentials.
// The YouTube channel and the site's article feed are free, and both carry the
// same instalments the paid feed does — so pooled, the show works without a
// subscription and gets complete (audio included) with one.
const STRATECHERY: KnownShow = {
  key: 'stratechery',
  aliases: ['stratechery', 'stratechery by ben thompson', 'stratechery podcast', 'ben thompson'],
  title: 'Stratechery',
  author: 'Ben Thompson',
  category: 'Tech Strategy',
  description: `Ben Thompson's analysis of the strategy and business behind technology and media — pooled from the video, the articles, and your member feed.`,
  source: 'podcast',
  artworkUrl: STRATECHERY_ART,
  access: 'partial',
  accessNote: `Free video + articles, pooled. Connect your member feed to add the paid Daily Updates.`,
  webUrl: 'https://open.spotify.com/show/1jRACH7L8EQCYKc5uW7aPk',
  paidNote: `The Stratechery podcast (Daily Updates and Interviews) is subscriber-only on Spotify — there's no public feed for it, so those episodes can't be fetched from there.`,
  spotifyShowId: '1jRACH7L8EQCYKc5uW7aPk',
  memberFeedHost: 'stratechery.passport.online',
  memberFeedPage: 'https://stratechery.passport.online/member/account/delivery',
  feeds: [
    // YouTube first: it's free, carries the full weekly video, and its watch link
    // is what the in-app player uses.
    { feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${STRATECHERY_YT_CHANNEL}`, access: 'open', label: 'YouTube' },
    // The site feed carries free articles in full; the paid Updates appear here
    // too, but truncated to a teaser — which is exactly what 'partial' means.
    { feedUrl: 'https://stratechery.com/feed/', access: 'partial', label: 'Articles' },
  ],
}

export const KNOWN_SHOWS: readonly KnownShow[] = [STRATECHERY]

/** The label a pasted member feed gets in a pooled show's feed list. */
export const MEMBER_FEED_LABEL = 'Member feed'

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')

/** The known show a plain-text search term (or a resolved show title) refers to. */
export function knownShowByTerm(term: string): KnownShow | null {
  const q = norm(term)
  if (!q) return null
  for (const show of KNOWN_SHOWS) {
    if (show.aliases.some((a) => norm(a) === q)) return show
  }
  return null
}

/** The known show behind a Spotify show id. */
export function knownShowBySpotifyId(id: string): KnownShow | null {
  const wanted = (id || '').trim()
  return wanted ? (KNOWN_SHOWS.find((s) => s.spotifyShowId === wanted) ?? null) : null
}

/** The known show whose member feeds are served by `host` (case-insensitive). */
export function knownShowByMemberHost(host: string): KnownShow | null {
  const h = (host || '').toLowerCase().replace(/^www\./, '')
  return h ? (KNOWN_SHOWS.find((s) => s.memberFeedHost === h) ?? null) : null
}

/** The show as ONE pooled Discover result. `extraFeeds` appends feeds the caller
 *  has in hand — a member feed the user just pasted — which upgrades the pool from
 *  'partial' (free sources only) to 'private' (the paid episodes are in too). */
export function knownShowResult(show: KnownShow, extraFeeds: PodcastFeed[] = []): PodcastSearchResult {
  const feeds = mergeFeeds([...show.feeds], extraFeeds)
  const unlocked = feeds.some((f) => f.access === 'private')
  return {
    id: show.key,
    title: show.title,
    author: show.author,
    category: show.category,
    description: show.description,
    artworkUrl: show.artworkUrl,
    feedUrl: feeds[0]?.feedUrl ?? '',
    feeds,
    source: show.source,
    access: unlocked ? 'private' : show.access,
    // Precise, not triumphant: the pool now carries everything the member feed
    // publishes, which is not necessarily everything the subscription includes —
    // publishers routinely leave some content out of their feeds.
    accessNote: unlocked
      ? `${feeds.length} sources pooled, including everything your member feed carries. Keep that URL secret — it carries your subscription.`
      : show.accessNote,
    webUrl: show.webUrl,
    // The pointer to "where do I get my feed" is only useful while the pool is
    // still missing it.
    memberFeedPage: unlocked ? undefined : show.memberFeedPage,
    paidNote: unlocked ? undefined : show.paidNote,
  }
}

/** The known-show card for a plain-text query, or [] when the query names none. */
export function knownResultsForQuery(term: string): PodcastSearchResult[] {
  const show = knownShowByTerm(term)
  return show ? [knownShowResult(show)] : []
}

// ── Private member feeds ─────────────────────────────────────────────────────
// A member feed is a personal, credential-bearing URL: it unlocks exactly the
// paid episodes that subscription includes. We want it tracked (it's the only
// way those episodes are reachable) AND flagged, because the URL is a secret —
// anyone holding it reads the subscription.

/** Hosts that serve personal member feeds. Membership platforms only: a host that
 *  also serves public feeds can't be matched this way — api.substack.com carries
 *  both a private podcast feed and Lenny's fully public one, so Substack member
 *  feeds are recognized (when at all) by their token param, not their host. */
const MEMBER_FEED_HOSTS = [
  'passport.online', // Passport (Stratechery, Defector, Aftermath…)
  'supercast.com',
  'supportingcast.fm',
  'memberful.com',
  'patreon.com',
  'glow.fm',
  'steadyhq.com',
]

/** Query params that carry a credential. Deliberately narrow: `feedId`-style
 *  opaque ids appear in plenty of PUBLIC feeds (acast, anchor, megaphone), so
 *  only names that mean "this proves who you are" count. */
const TOKEN_PARAMS = ['token', 'access_token', 'auth', 'auth_token', 'authtoken', 'api_key', 'apikey', 'secret', 'password']

export interface MemberFeedInfo {
  access: Extract<FeedAccess, 'private'>
  note: string
  /** The known show this feed belongs to, when the host identifies one. */
  show: KnownShow | null
}

/** Is this feed URL a personal member feed? Best-effort by design: recognizing
 *  one earns it a "private" badge and a keep-this-secret warning, and failing to
 *  recognize one costs nothing — it's still fetched and tracked as an ordinary
 *  feed. Never throws. */
export function memberFeedInfo(rawUrl: string): MemberFeedInfo | null {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const show = knownShowByMemberHost(host)
  const platform = MEMBER_FEED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  const tokenParam = TOKEN_PARAMS.some((p) => (u.searchParams.get(p) || '').length >= 8)
  if (!show && !platform && !tokenParam) return null
  const who = show ? show.title : 'this publisher'
  return {
    access: 'private',
    note: `Unlocks your paid ${who} episodes. Keep the URL secret — it carries your subscription.`,
    show,
  }
}

/** A pasted member feed, resolved as the known show it belongs to: the pooled show
 *  with this feed added, so it lands in ONE list with the free sources instead of
 *  becoming a second near-identical show. Null when no known show claims the host. */
export function pooledResultForMemberFeed(rawUrl: string): PodcastSearchResult | null {
  const info = memberFeedInfo(rawUrl)
  if (!info?.show) return null
  return knownShowResult(info.show, [{ feedUrl: rawUrl, access: 'private', label: MEMBER_FEED_LABEL }])
}
