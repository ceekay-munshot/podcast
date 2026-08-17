import { stableHash } from './hash'
import type { FeedAccess, PodcastSearchResult, SourceKind } from './types'

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
//   • which source is behind a paywall (→ rendered as a locked card, never as
//     something we can summarize),
//   • which sources we can fetch today (→ trackable straight from Discover),
//   • where the subscriber copies their OWN private feed from, since that is the
//     only way the paid episodes become reachable.
//
// This registry deliberately does NOT try to guess at arbitrary shows. It exists
// to stop us from mislabelling the ones we know, in either direction: a paid show
// is never presented as fetchable, and a free show is never written off as paid.
//
// Shared by the browser and the server on purpose (client fast-path search in
// src/lib/api.ts, resolvers in server/search.ts + server/spotify.ts) so both
// paths surface the same cards with the same ids.
// ─────────────────────────────────────────────────────────────────────────────

/** A concrete source for a show, ready to render as a Discover card. */
export interface KnownSourceSeed {
  /** MUST match the id the server's resolver derives for the same URL
   *  (`yt-<channelId>`, `feed-<hash>`, `spotify-<showId>`), so a pasted URL and
   *  this entry dedupe to ONE card instead of two near-identical ones. */
  id: string
  title: string
  author: string
  category: string
  description: string
  source: SourceKind
  access: FeedAccess
  accessNote: string
  /** '' for a source with nothing to fetch (a paywalled platform). */
  feedUrl: string
  /** The human page behind the source — the only link a paywalled card can offer. */
  webUrl?: string
  artworkUrl?: string
}

export interface KnownShow {
  /** Canonical lowercase key. */
  key: string
  /** Lowercase search terms that should surface this show. */
  aliases: readonly string[]
  /** Spotify show id, when the paid show is distributed there. */
  spotifyShowId?: string
  /** The paywalled source itself — a locked card, never trackable. */
  paid: KnownSourceSeed
  /** Sources whose episodes we can genuinely fetch today. */
  fetchable: readonly KnownSourceSeed[]
  /** Host serving this publisher's personal member feeds — how a pasted member
   *  URL is recognized as this show's private feed. */
  memberFeedHost?: string
  /** Where a subscriber copies their own private feed URL from. */
  memberFeedPage?: string
}

const STRATECHERY_ART = 'https://stratechery.com/wp-content/uploads/2020/05/Stratechery-Podcast-Artwork.png'
const STRATECHERY_YT_CHANNEL = 'UC9AHywQeW9BOcOl7dg-YMqA'

// Stratechery — Ben Thompson. The paid podcast (Daily Updates + Interviews +
// Sharp Tech/China crossovers) is distributed to subscribers via Spotify and a
// personal Passport feed; neither is fetchable without the subscriber's own
// credentials. The YouTube channel and the site's article feed are free.
const STRATECHERY: KnownShow = {
  key: 'stratechery',
  aliases: ['stratechery', 'stratechery by ben thompson', 'stratechery podcast', 'ben thompson'],
  spotifyShowId: '1jRACH7L8EQCYKc5uW7aPk',
  memberFeedHost: 'stratechery.passport.online',
  memberFeedPage: 'https://stratechery.passport.online/member/account/delivery',
  paid: {
    id: 'spotify-1jRACH7L8EQCYKc5uW7aPk',
    title: 'Stratechery',
    author: 'Ben Thompson',
    category: 'Tech Strategy',
    description: `Ben Thompson's daily analysis of the strategy and business behind technology and media.`,
    source: 'podcast',
    access: 'paid',
    accessNote: `Subscriber-only on Spotify — no public feed, so paid episodes can't be fetched.`,
    feedUrl: '',
    webUrl: 'https://open.spotify.com/show/1jRACH7L8EQCYKc5uW7aPk',
    artworkUrl: STRATECHERY_ART,
  },
  fetchable: [
    {
      id: `yt-${STRATECHERY_YT_CHANNEL}`,
      title: 'Stratechery on YouTube',
      author: 'Ben Thompson',
      category: 'Tech Strategy',
      description: `The free Stratechery video — Ben Thompson's weekly article, read and illustrated on YouTube.`,
      source: 'youtube',
      access: 'open',
      accessNote: 'Free on YouTube — fetched and summarized in full.',
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${STRATECHERY_YT_CHANNEL}`,
      webUrl: 'https://www.youtube.com/@Stratechery',
      artworkUrl: STRATECHERY_ART,
    },
    {
      id: `feed-${stableHash('https://stratechery.com/feed/')}`,
      title: 'Stratechery Articles',
      author: 'Ben Thompson',
      category: 'Tech Strategy',
      description: `The written Stratechery — free weekly articles plus the paid Daily Updates.`,
      source: 'podcast',
      access: 'partial',
      accessNote: `Free weekly articles in full; the paid Daily Updates arrive as a teaser only.`,
      feedUrl: 'https://stratechery.com/feed/',
      webUrl: 'https://stratechery.com',
      artworkUrl: STRATECHERY_ART,
    },
  ],
}

export const KNOWN_SHOWS: readonly KnownShow[] = [STRATECHERY]

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

function toResult(seed: KnownSourceSeed, memberFeedPage?: string): PodcastSearchResult {
  return {
    id: seed.id,
    title: seed.title,
    author: seed.author,
    category: seed.category,
    description: seed.description,
    artworkUrl: seed.artworkUrl,
    feedUrl: seed.feedUrl,
    source: seed.source,
    access: seed.access,
    accessNote: seed.accessNote,
    webUrl: seed.webUrl,
    // Only a paywalled card needs the "where do I get my feed" pointer; a free
    // source carrying it would imply you need a subscription to use it.
    memberFeedPage: seed.access === 'paid' ? memberFeedPage : undefined,
  }
}

/** Every source we know for a show, paywalled one first — the paid reality is the
 *  headline, and the free alternatives read as the answer to it. */
export function knownShowResults(show: KnownShow): PodcastSearchResult[] {
  return [toResult(show.paid, show.memberFeedPage), ...show.fetchable.map((s) => toResult(s, show.memberFeedPage))]
}

/** Known-show cards for a plain-text query, or [] when the query names none. */
export function knownResultsForQuery(term: string): PodcastSearchResult[] {
  const show = knownShowByTerm(term)
  return show ? knownShowResults(show) : []
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
  const who = show ? show.paid.title : 'this publisher'
  return {
    access: 'private',
    note: `Unlocks your paid ${who} episodes. Keep the URL secret — it carries your subscription.`,
    show,
  }
}
